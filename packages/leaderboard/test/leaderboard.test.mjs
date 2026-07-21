import assert from "node:assert/strict";
import test from "node:test";

import {
  BINARY_CHALLENGE_KEYS,
  MINIMUM_INDIVIDUAL_AWARD_USD,
  PRIZE_PLACES,
  TOP_TEN_PRIZE_BOOST,
  calculateLeaderboard,
  createSolveEvent,
  dynamicSolveValue,
  eventGeneration,
  reportSolveEvent,
  reportSolveEventBestEffort,
  signScoreEventBody,
  verifySolveEventRequest,
} from "../index.js";

test("event generations are explicit in production and deterministic in rehearsal", () => {
  assert.equal(eventGeneration({}), "rehearsal");
  assert.equal(eventGeneration({ CTF_EVENT_GENERATION: "ctf26-final_2" }), "ctf26-final_2");
  assert.throws(() => eventGeneration({ NODE_ENV: "production" }), /required in production/);
  assert.throws(() => eventGeneration({ CTF_EVENT_GENERATION: "invalid generation" }), /invalid/);
});

test("dynamic challenge values are field-relative, monotone, and bounded", () => {
  const values = Array.from({ length: 50 }, (_, index) => dynamicSolveValue({
    solveCount: index + 1,
    fieldSize: 50,
  }));
  assert.equal(values[0], 1_000);
  assert.equal(values[9], 560);
  assert.equal(values[49], 250);
  for (let index = 1; index < values.length; index += 1) {
    assert.ok(values[index] <= values[index - 1]);
  }
  assert.equal(dynamicSolveValue({
    solveCount: 50,
    fieldSize: 50,
    maximum: 999,
    minimum: 251,
    increment: 10,
  }), 251);
  assert.equal(dynamicSolveValue({
    solveCount: 0,
    fieldSize: 50,
    maximum: 999,
    minimum: 251,
    increment: 10,
  }), 999);
  for (let fieldSize = 2; fieldSize <= 500; fieldSize += 1) {
    let previous = Infinity;
    for (let solveCount = 0; solveCount <= fieldSize; solveCount += 1) {
      const value = dynamicSolveValue({ solveCount, fieldSize });
      assert.ok(value >= 250 && value <= 1_000);
      assert.ok(value <= previous);
      previous = value;
    }
  }
});

test("all solvers of the same binary challenge receive its current value", () => {
  const snapshot = calculateLeaderboard({
    fieldSize: 50,
    solves: ["alpha", "bravo", "charlie"].map((participantId) => ({
      challenge: "imprint",
      participantId,
    })),
  });
  const expected = snapshot.challengeValues.imprint.points;
  assert.equal(expected, 790);
  assert.deepEqual(snapshot.rows.map((row) => row.points), [expected, expected, expected]);
  assert.deepEqual(snapshot.rows.map((row) => row.rank), [1, 1, 1]);
});

test("performance points normalize directly to the live market leader", () => {
  const snapshot = calculateLeaderboard({
    fieldSize: 42,
    performance: [
      { participantId: "market-leader", score: 8 },
      { participantId: "market-second", score: 3 },
      { participantId: "market-zero", score: 0 },
    ],
  });
  assert.equal(snapshot.rows[0].points, 1_000);
  assert.equal(snapshot.rows[1].points, 375);
  assert.equal(snapshot.rows[2].points, 0);
  assert.equal(calculateLeaderboard({
    fieldSize: 50,
    performance: [
      { participantId: "leader", score: 1_000_000 },
      { participantId: "small-positive-score", score: 1 },
    ],
  }).rows[1].points, 1);
});

test("prize projections exhaust the pool and exact score ties receive equal shares", () => {
  const solves = ["alpha", "bravo", "charlie", "delta"].flatMap((participantId, index) => (
    BINARY_CHALLENGE_KEYS.slice(0, index < 2 ? 2 : 1).map((challenge) => ({
      challenge,
      participantId,
    }))
  ));
  const snapshot = calculateLeaderboard({ fieldSize: 50, prizePool: 4_000, solves });
  const distributed = snapshot.rows.reduce((sum, row) => sum + row.projectedPrizeCents, 0);
  assert.equal(distributed, 400_000);
  assert.equal(snapshot.rows[0].points, snapshot.rows[1].points);
  assert.equal(snapshot.rows[0].projectedPrize, snapshot.rows[1].projectedPrize);
  assert.equal(snapshot.rows[2].rank, snapshot.rows[3].rank);
  assert.equal(snapshot.rows[2].projectedPrize, snapshot.rows[3].projectedPrize);
});

test("every scoring entrant shares the pool and the top ten receive a small weight boost", () => {
  const snapshot = calculateLeaderboard({
    fieldSize: 50,
    prizePool: 4_000,
    minimumAward: 10,
    performance: Array.from({ length: 11 }, (_, index) => ({
      participantId: `player-${index + 1}`,
      score: 11 - index,
    })),
  });
  const distributed = snapshot.rows.reduce((sum, row) => sum + row.projectedPrizeCents, 0);
  assert.equal(PRIZE_PLACES, 10);
  assert.equal(TOP_TEN_PRIZE_BOOST, 0.1);
  assert.equal(distributed, 400_000);
  assert.ok(snapshot.rows[9].projectedPrize > 0);
  assert.equal(snapshot.rows[10].rank, 11);
  assert.ok(snapshot.rows[10].projectedPrize > 0);
  const floor = 10;
  assert.ok(Math.abs(
    (snapshot.rows[0].projectedPrize - floor) / (snapshot.rows[10].projectedPrize - floor)
      / (snapshot.rows[0].points / snapshot.rows[10].points)
      - 1.1,
  ) < 0.01);
});

test("an exact tie at the tenth-place cutoff gives the entire tie group the boost", () => {
  const snapshot = calculateLeaderboard({
    fieldSize: 50,
    prizePool: 4_000,
    performance: [10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 1].map((score, index) => ({
      participantId: `player-${index + 1}`,
      score,
    })),
  });
  const cutoff = snapshot.rows.filter((row) => row.rank === 10);
  assert.equal(cutoff.length, 2);
  assert.ok(cutoff.every((row) => row.projectedPrize > 0));
  assert.ok(Math.abs(cutoff[0].projectedPrizeCents - cutoff[1].projectedPrizeCents) <= 1);
  assert.equal(snapshot.rows.reduce((sum, row) => sum + row.projectedPrizeCents, 0), 400_000);
});

test("currency allocation is cent-exact and gives every scorer the published floor", () => {
  const performance = Array.from({ length: 11 }, (_, index) => ({
    participantId: `player-${index + 1}`,
    score: 11 - index,
  }));
  const snapshot = calculateLeaderboard({ fieldSize: 50, prizePool: 110, minimumAward: 10, performance });
  assert.equal(MINIMUM_INDIVIDUAL_AWARD_USD, 0);
  assert.equal(snapshot.rows.reduce((sum, row) => sum + row.projectedPrizeCents, 0), 11_000);
  assert.ok(snapshot.rows.every((row) => row.projectedPrizeCents >= 1_000));
  assert.ok(snapshot.rows.every((row) => row.projectedPrize === row.projectedPrizeCents / 100));
  assert.throws(
    () => calculateLeaderboard({ fieldSize: 50, prizePool: 109.99, minimumAward: 10, performance }),
    /minimum award/,
  );
  assert.throws(
    () => calculateLeaderboard({ fieldSize: 50, prizePool: 4_000.001, performance }),
    /two decimal places/,
  );

  const indivisibleTie = calculateLeaderboard({
    fieldSize: 50,
    prizePool: 100,
    performance: ["alpha", "bravo", "charlie"].map((participantId) => ({ participantId, score: 1 })),
  });
  const tiedCents = indivisibleTie.rows.map((row) => row.projectedPrizeCents);
  assert.equal(tiedCents.reduce((sum, cents) => sum + cents, 0), 10_000);
  assert.ok(Math.max(...tiedCents) - Math.min(...tiedCents) <= 1);
});

test("fifty-player adversarial fields preserve scoring, rank, and payout invariants", () => {
  let seed = 0x26c7f;
  const random = () => {
    seed = (seed * 1_664_525 + 1_013_904_223) >>> 0;
    return seed / 2 ** 32;
  };
  for (let run = 0; run < 50; run += 1) {
    const performance = Array.from({ length: 50 }, (_, index) => ({
      participantId: `player-${index + 1}`,
      score: random() < 0.2 ? 0 : Math.max(Number.MIN_VALUE, random() * 1_000_000),
    }));
    const solves = BINARY_CHALLENGE_KEYS.flatMap((challenge) => (
      performance.flatMap(({ participantId }) => random() < 0.45 ? [{ challenge, participantId }] : [])
    ));
    const snapshot = calculateLeaderboard({ fieldSize: 50, prizePool: 4_000, minimumAward: 10, solves, performance });
    assert.equal(snapshot.rows.reduce((sum, row) => sum + row.projectedPrizeCents, 0), 400_000);
    for (let index = 0; index < snapshot.rows.length; index += 1) {
      const row = snapshot.rows[index];
      assert.ok(Number.isSafeInteger(row.points) && row.points >= 0);
      assert.equal(row.projectedPrize, row.projectedPrizeCents / 100);
      if (row.points > 0) {
        assert.ok(row.rank && row.projectedPrizeCents >= 1_000);
      } else {
        assert.equal(row.rank, null);
        assert.equal(row.projectedPrizeCents, 0);
      }
      if (index > 0) assert.ok(snapshot.rows[index - 1].points >= row.points);
    }
    for (const value of Object.values(snapshot.challengeValues)) {
      assert.ok(value.points >= 250 && value.points <= 1_000);
    }
  }
});

test("late solvers receive the same retroactive value instead of a speed penalty", () => {
  const early = calculateLeaderboard({
    fieldSize: 50,
    solves: [{ challenge: "signet", participantId: "alpha" }],
  });
  const later = calculateLeaderboard({
    fieldSize: 50,
    solves: ["alpha", "bravo"].map((participantId) => ({ challenge: "signet", participantId })),
  });
  assert.equal(early.rows[0].points, 1_000);
  assert.equal(later.rows[0].points, later.rows[1].points);
  assert.equal(later.rows[0].points, 870);
});

test("all nine binary challenges accept signed solve events", () => {
  assert.deepEqual(BINARY_CHALLENGE_KEYS, [
    "imprint",
    "signet",
    "drift",
    "last-stop",
    "after-hours",
    "player-two",
    "the-broadcast",
    "evidence-room",
    "second-key",
  ]);
  for (const challenge of BINARY_CHALLENGE_KEYS) {
    assert.equal(createSolveEvent({
      challenge,
      participantId: "player-1",
      sourceId: `${challenge}:player-1`,
    }).challenge, challenge);
  }
});

test("solve events are signed, verified, and replay-safe at the storage boundary", () => {
  const secret = "leaderboard-event-secret-at-least-thirty-two-bytes";
  const event = createSolveEvent({
    challenge: "drift",
    eventId: "event-a",
    participantId: "player-1",
    sourceId: "drift:player-1",
    occurredAt: "2026-07-16T08:00:00.000Z",
  });
  const body = JSON.stringify(event);
  const signature = signScoreEventBody(body, secret, 1_784_188_800);
  assert.deepEqual(verifySolveEventRequest({
    rawBody: body,
    timestamp: "1784188800",
    signature,
    secret,
    eventId: "event-a",
    now: 1_784_188_830,
  }), event);
  assert.throws(() => verifySolveEventRequest({
    rawBody: body,
    timestamp: "1784188800",
    signature,
    secret,
    eventId: "event-b",
    now: 1_784_188_830,
  }), /another event/);
  assert.throws(() => verifySolveEventRequest({
    rawBody: `${body} `,
    timestamp: "1784188800",
    signature,
    secret,
    now: 1_784_188_830,
  }), /signature is invalid/);
});

test("reporter sends the exact signed event envelope", async () => {
  const secret = "leaderboard-event-secret-at-least-thirty-two-bytes";
  let request;
  const result = await reportSolveEvent({
    url: "https://portal.example/api/leaderboard/events",
    secret,
    challenge: "last-stop",
    participantId: "player-2",
    sourceId: "last-stop:player-2",
    fetchImpl: async (url, options) => {
      request = { url: String(url), options };
      return { ok: true, status: 202 };
    },
  });
  assert.equal(result.reported, true);
  assert.equal(request.url, "https://portal.example/api/leaderboard/events");
  const event = verifySolveEventRequest({
    rawBody: request.options.body,
    timestamp: request.options.headers["x-ctf-timestamp"],
    signature: request.options.headers["x-ctf-signature"],
    secret,
    now: Number(request.options.headers["x-ctf-timestamp"]),
  });
  assert.equal(event.participantId, "player-2");
});

test("best-effort delivery retries transient failures without revoking the solve", async () => {
  let calls = 0;
  const result = await reportSolveEventBestEffort({
    url: "https://portal.example/api/leaderboard/events",
    secret: "leaderboard-event-secret-at-least-thirty-two-bytes",
    challenge: "after-hours",
    participantId: "player-3",
    sourceId: "transaction-3",
    fetchImpl: async () => {
      calls += 1;
      return { ok: calls === 3, status: calls === 3 ? 201 : 503 };
    },
    logger: { error() { throw new Error("should not log after a successful retry"); } },
  });
  assert.equal(calls, 3);
  assert.equal(result.reported, true);
});
