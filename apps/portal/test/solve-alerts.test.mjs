import assert from "node:assert/strict";
import test from "node:test";

import { rowMovement, verifiedSolveCount } from "../app/leaderboard/solve-alerts.mjs";

test("a first solve is reported as a debut, not as holding position", () => {
  // An unranked row has rank null, so there is no prior rank to subtract. This
  // is the kickoff case: it must not render as "scored, held position".
  assert.deepEqual(
    rowMovement({ row: { rank: 1, points: 3_240, solveCount: 1 }, priorRank: null, priorPoints: 0, priorSolveCount: 0 }),
    { delta: 0, gained: true, debut: true },
  );
});

test("rank movement is positive when a row climbs", () => {
  assert.deepEqual(
    rowMovement({ row: { rank: 1, points: 2_610, solveCount: 3 }, priorRank: 4, priorPoints: 870, priorSolveCount: 2 }),
    { delta: 3, gained: true, debut: false },
  );
  assert.deepEqual(
    rowMovement({ row: { rank: 2, points: 1_740, solveCount: 1 }, priorRank: 1, priorPoints: 1_870, priorSolveCount: 1 }),
    { delta: -1, gained: false, debut: false },
  );
});

test("a row that scores without changing rank still reports the gain", () => {
  assert.deepEqual(
    rowMovement({ row: { rank: 1, points: 2_000 }, priorRank: 1, priorPoints: 1_000 }),
    { delta: 0, gained: true, debut: false },
  );
});

test("a verified solve is still a gain when dynamic repricing lowers net points", () => {
  assert.deepEqual(
    rowMovement({
      row: { rank: 2, points: 2_980, solveCount: 4 },
      priorRank: 2,
      priorPoints: 3_010,
      priorSolveCount: 3,
    }),
    { delta: 0, gained: true, debut: false },
  );
});

test("an unchanged row reports no movement", () => {
  assert.equal(rowMovement({ row: { rank: 3, points: 500 }, priorRank: 3, priorPoints: 500 }), null);
  assert.equal(rowMovement({ row: { rank: null, points: 0 }, priorRank: null, priorPoints: 0 }), null);
});

test("the first comparison after mount does not mark every ranked row as new", () => {
  // On mount with no seeded history every row would otherwise look like a debut.
  assert.equal(
    rowMovement({ row: { rank: 1, points: 900 }, priorRank: undefined, priorPoints: undefined, firstComparison: true }),
    null,
  );
  // Once a comparison has happened, a genuinely new arrival is a debut.
  assert.deepEqual(
    rowMovement({ row: { rank: 1, points: 900 }, priorRank: undefined, priorPoints: undefined, firstComparison: false }),
    { delta: 0, gained: false, debut: true },
  );
});

test("a retroactive score drop from other solves is not a gain", () => {
  // Challenge values fall as more people solve, so points can decrease without
  // the participant doing anything. That must not flash the row as a solve.
  assert.deepEqual(
    rowMovement({ row: { rank: 2, points: 2_980 }, priorRank: 1, priorPoints: 3_240 }),
    { delta: -1, gained: false, debut: false },
  );
});

test("verified solve count totals challenge completions without using score changes", () => {
  assert.equal(verifiedSolveCount({
    challengeValues: {
      imprint: { solveCount: 3, points: 700 },
      signet: { solveCount: 2, points: 800 },
      "reward-sniper": { solveCount: 0, points: 1_000 },
    },
  }), 5);
});

test("verified solve count safely ignores missing and malformed values", () => {
  assert.equal(verifiedSolveCount(null), 0);
  assert.equal(verifiedSolveCount({
    challengeValues: {
      imprint: { solveCount: -1 },
      signet: { solveCount: "two" },
      drift: {},
    },
  }), 0);
});
