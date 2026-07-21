import {
  BINARY_CHALLENGE_KEYS,
  calculateLeaderboard,
} from "../index.js";

const POOL = 4_000;

function player(number) {
  return `player-${String(number).padStart(2, "0")}`;
}

function prefixSolves(counts) {
  return counts.flatMap((count, challengeIndex) => Array.from({ length: count }, (_, index) => ({
    challenge: BINARY_CHALLENGE_KEYS[challengeIndex],
    participantId: player(index + 1),
  })));
}

function solveSet(entries) {
  return entries.flatMap(([participantNumber, challengeIndexes]) => challengeIndexes.map((index) => ({
    challenge: BINARY_CHALLENGE_KEYS[index],
    participantId: player(participantNumber),
  })));
}

const scenarios = [
  {
    name: "opening hour",
    fieldSize: 48,
    solves: prefixSolves([1, 2, 3, 4, 5, 0, 0, 1, 2]),
    performance: [[1, 2.8], [2, 2.1], [7, 1.4], [10, 0.8]].map(([id, score]) => ({ participantId: player(id), score })),
  },
  {
    name: "balanced midpoint",
    fieldSize: 50,
    solves: prefixSolves([4, 8, 12, 17, 22, 26, 31, 6, 10]),
    performance: [[3, 5.2], [1, 4.5], [12, 3.6], [21, 2.9], [30, 1.1]].map(([id, score]) => ({ participantId: player(id), score })),
  },
  {
    name: "one common route",
    fieldSize: 50,
    solves: prefixSolves([2, 5, 9, 16, 24, 34, 41, 12, 20]),
    performance: [[18, 5], [2, 4.3], [8, 3.1], [31, 1.8]].map(([id, score]) => ({ participantId: player(id), score })),
  },
  {
    name: "rare-route specialist",
    fieldSize: 49,
    solves: [
      ...prefixSolves([1, 2, 15, 23, 29, 34, 39, 8, 18]),
      ...solveSet([[41, [0, 1, 5, 6, 7]]]),
    ],
    performance: [],
  },
  {
    name: "market specialist",
    fieldSize: 50,
    solves: prefixSolves([5, 8, 12, 16, 20, 25, 30, 7, 11]),
    performance: [[12, 9], [1, 5.4], [4, 4.8], [15, 3.6], [32, 1.8]].map(([id, score]) => ({ participantId: player(id), score })),
  },
  {
    name: "late full field",
    fieldSize: 50,
    solves: prefixSolves([7, 12, 18, 24, 30, 36, 42, 15, 27]),
    performance: Array.from({ length: 20 }, (_, index) => ({ participantId: player(index + 1), score: 20 - index })),
  },
];

for (const scenario of scenarios) {
  const snapshot = calculateLeaderboard({ ...scenario, prizePool: POOL });
  const values = BINARY_CHALLENGE_KEYS
    .map((key) => `${key}:${snapshot.challengeValues[key].points}`)
    .join("  ");
  console.log(`\n${scenario.name.toUpperCase()}  field=${scenario.fieldSize}  scoring=${snapshot.scoringEntrants}`);
  console.log(values);
  for (const row of snapshot.rows.slice(0, 6)) {
    console.log(`${String(row.rank).padStart(2)}  ${row.participantId}  ${String(row.points).padStart(4)} pts  ${row.activeChallengeCount} active  $${row.projectedPrize.toFixed(2)}`);
  }
  const distributedCents = snapshot.rows.reduce((sum, row) => sum + row.projectedPrizeCents, 0);
  if (distributedCents !== POOL * 100) throw new Error(`${scenario.name}: prize pool invariant failed`);
}

const sensitivity = [45, 50].map((fieldSize) => ({
  fieldSize,
  values: [1, 5, 10, 20, 35, 40].filter((count) => count <= fieldSize).map((solveCount) => (
    calculateLeaderboard({
      fieldSize,
      solves: Array.from({ length: solveCount }, (_, index) => ({
        challenge: "imprint",
        participantId: player(index + 1),
      })),
    }).challengeValues.imprint.points
  )),
}));
console.log("\nTURNOUT SENSITIVITY  solve counts=1,5,10,20,35,40");
for (const row of sensitivity) console.log(`${row.fieldSize} checked in  ${row.values.join("  ")}`);
