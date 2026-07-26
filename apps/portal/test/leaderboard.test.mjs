import assert from "node:assert/strict";
import test from "node:test";

import { assertChallengeLaunchAllowed, assertScoreEventAllowed, leaderboardConfig } from "../app/lib/leaderboard-config.mjs";
import { leaderboardSnapshot } from "../app/lib/leaderboard-service.mjs";
import { createLeaderboardStore } from "../app/lib/leaderboard-store.mjs";
import { participantIdForEmail } from "../app/lib/registration.mjs";

const REWARD_CONFIG_HASH = "a".repeat(64);
const PARTICIPANT_ID_SECRET = "participant-id-test-secret-at-least-32-bytes";

function memoryRedis() {
  const hashes = new Map();
  const strings = new Map();
  return async (command) => {
    const [verb, key, field, value] = command;
    if (verb === "HSET") {
      const hash = hashes.get(key) || new Map();
      hash.set(field, value);
      hashes.set(key, hash);
      return 1;
    }
    if (verb === "HSETNX") {
      const hash = hashes.get(key) || new Map();
      hashes.set(key, hash);
      if (hash.has(field)) return 0;
      hash.set(field, value);
      return 1;
    }
    if (verb === "INCR") {
      const next = Number(strings.get(key) || 0) + 1;
      strings.set(key, String(next));
      return next;
    }
    if (verb === "EVAL" && String(command[1]).includes("local created=redis.call('HSETNX',KEYS[3]")) {
      const keys = command.slice(3, 8);
      const [participantId, encoded] = command.slice(8);
      if (keys.slice(0, 2).some((blockedKey) => strings.has(blockedKey))) return -1;
      const solveKey = keys[2];
      const hash = hashes.get(solveKey) || new Map();
      hashes.set(solveKey, hash);
      if (hash.has(participantId)) return 0;
      hash.set(participantId, encoded);
      const next = Number(strings.get(keys[3]) || 0) + 1;
      strings.set(keys[3], String(next));
      strings.delete(keys[4]);
      return 1;
    }
    if (verb === "EVAL" && String(command[1]).includes("return redis.call('HSETNX',KEYS[3]")) {
      const keys = command.slice(3, 6);
      const [fieldName, encoded] = command.slice(6);
      if (keys.slice(0, 2).some((blockedKey) => strings.has(blockedKey))) return -1;
      const hash = hashes.get(keys[2]) || new Map();
      hashes.set(keys[2], hash);
      if (hash.has(fieldName)) return 0;
      hash.set(fieldName, encoded);
      return 1;
    }
    if (verb === "EVAL" && String(command[1]).includes("redis.call('HSET',KEYS[1],ARGV[1],ARGV[2])")) {
      const keys = command.slice(3, 6);
      const [fieldName, encoded] = command.slice(6);
      const hash = hashes.get(keys[0]) || new Map();
      hash.set(fieldName, encoded);
      hashes.set(keys[0], hash);
      const next = Number(strings.get(keys[1]) || 0) + 1;
      strings.set(keys[1], String(next));
      strings.delete(keys[2]);
      return 1;
    }
    if (verb === "HGETALL") return [...(hashes.get(key) || new Map()).entries()].flat();
    if (verb === "SET") { strings.set(key, field); return "OK"; }
    if (verb === "GET") return strings.get(key) || null;
    if (verb === "DEL") return strings.delete(key) ? 1 : 0;
    throw new Error(`unsupported fake Redis command ${verb}`);
  };
}

function rewardHeaders({ eventId = "", stage = "", generation = "rehearsal", scoringConfigHash = "" } = {}) {
  const values = new Map([
    ["x-reward-event-id", eventId],
    ["x-reward-event-stage", stage],
    ["x-reward-event-generation", generation],
    ["x-reward-scoring-config", scoringConfigHash],
  ]);
  return { get: (name) => values.get(name) || "" };
}

test("leaderboard configuration uses checked-in attendance without inventing an award policy", () => {
  const config = leaderboardConfig({
    LEADERBOARD_FIELD_SIZE: "43",
    LEADERBOARD_REGISTERED_COUNT: "50",
  });
  assert.equal(config.fieldSize, 43);
  assert.equal(config.registeredCount, 50);
  assert.equal(config.prizePool, 0);
  assert.equal(config.minimumAward, 0);
  assert.equal(config.prizePoolPublished, false);
  assert.equal(leaderboardConfig({ LEADERBOARD_REGISTERED_COUNT: "50" }).fieldSize, 50);
  assert.throws(() => leaderboardConfig({
    LEADERBOARD_FIELD_SIZE: "51",
    LEADERBOARD_REGISTERED_COUNT: "50",
  }), /must not exceed/);
  assert.throws(() => leaderboardConfig({
    LEADERBOARD_PRIZE_POOL_USD: "4000.001",
  }), /two decimal places/);
  assert.throws(() => leaderboardConfig({
    LEADERBOARD_REGISTERED_COUNT: "50",
    LEADERBOARD_PRIZE_POOL_USD: "499.99",
    LEADERBOARD_MIN_INDIVIDUAL_AWARD_USD: "10",
  }), /cannot fund/);
  const participantRoster = JSON.stringify([
    { email: "one@example.com", displayName: "One" },
    { email: "two@example.com", displayName: "Two" },
    { email: "three@example.com", displayName: "Three" },
  ]);
  assert.equal(leaderboardConfig({
    PARTICIPANT_ID_SECRET,
    PARTICIPANT_ROSTER_JSON: participantRoster,
    LEADERBOARD_FIELD_SIZE: "2",
  }).registeredCount, 3);
  assert.equal(leaderboardConfig({
    PARTICIPANT_ID_SECRET,
    PARTICIPANT_ROSTER_JSON: participantRoster,
    LEADERBOARD_FIELD_SIZE: "2",
  }).minimumAward, 0);
});

test("an explicit zero floor distributes the whole pool by weighted points", async () => {
  const env = {
    PARTICIPANT_ID_SECRET,
    PARTICIPANT_ROSTER_JSON: JSON.stringify([
      { email: "one@example.com", displayName: "One" },
      { email: "two@example.com", displayName: "Two" },
    ]),
    LEADERBOARD_FIELD_SIZE: "2",
    LEADERBOARD_SCORING_MODE: "live",
    LEADERBOARD_PRIZE_POOL_USD: "4000",
    LEADERBOARD_MIN_INDIVIDUAL_AWARD_USD: "0",
    LEADERBOARD_SCORING_START_AT: "2026-07-26T04:30:00.000Z",
    LEADERBOARD_SCORING_END_AT: "2026-07-26T10:30:00.000Z",
    LEADERBOARD_EVENT_GENERATION: "ctf26-final",
    REWARD_SNIPER_EVENT_ID: "reward-event-final",
    REWARD_SNIPER_SCORING_CONFIG_HASH: REWARD_CONFIG_HASH,
  };
  const config = leaderboardConfig(env);
  assert.equal(config.minimumAward, 0);
  assert.equal(config.prizePool, 4_000);
  assert.equal(config.prizePoolPublished, true);

  const leader = participantIdForEmail("one@example.com", env);
  const trailer = participantIdForEmail("two@example.com", env);
  const store = createLeaderboardStore({ command: memoryRedis() });
  await store.upsertProfile({ participant_id: leader, leaderboard_name: "One" });
  await store.upsertProfile({ participant_id: trailer, leaderboard_name: "Two" });
  await store.recordSolve({ challenge: "imprint", participantId: leader, sourceId: "tx-a", eventId: "ctf26-final", occurredAt: "2026-07-26T05:00:00.000Z" });
  await store.recordSolve({ challenge: "signet", participantId: leader, sourceId: "tx-b", eventId: "ctf26-final", occurredAt: "2026-07-26T05:10:00.000Z" });
  await store.recordSolve({ challenge: "drift", participantId: trailer, sourceId: "tx-c", eventId: "ctf26-final", occurredAt: "2026-07-26T05:20:00.000Z" });

  const snapshot = await leaderboardSnapshot({
    env,
    config,
    store,
    skipSharedCache: true,
    fetchImpl: async () => new Response("[]", { headers: rewardHeaders({ eventId: "reward-event-final", generation: "ctf26-final", scoringConfigHash: REWARD_CONFIG_HASH }) }),
  });
  // Nobody receives a flat participation payment, the pool is fully allocated,
  // and twice the points earns twice the award.
  assert.equal(snapshot.rows.reduce((sum, row) => sum + row.projectedPrizeCents, 0), 400_000);
  assert.equal(snapshot.rows[0].participantId, leader);
  // Twice the points earns twice the award, up to the single cent that exhausting
  // the pool leaves over.
  assert.ok(Math.abs(snapshot.rows[0].projectedPrizeCents - 2 * snapshot.rows[1].projectedPrizeCents) <= 1);
  assert.ok(snapshot.rows.every((row) => row.projectedPrizeCents > 0));
});

test("live scoring is roster-bound, time-bound, and frozen explicitly", () => {
  const roster = JSON.stringify([
    { email: "one@example.com", displayName: "One" },
    { email: "two@example.com", displayName: "Two" },
  ]);
  const env = {
    PARTICIPANT_ID_SECRET,
    PARTICIPANT_ROSTER_JSON: roster,
    LEADERBOARD_FIELD_SIZE: "2",
    LEADERBOARD_SCORING_MODE: "live",
    LEADERBOARD_PRIZE_POOL_USD: "4000",
    LEADERBOARD_MIN_INDIVIDUAL_AWARD_USD: "10",
    LEADERBOARD_SCORING_START_AT: "2026-07-26T04:30:00.000Z",
    LEADERBOARD_SCORING_END_AT: "2026-07-26T10:30:00.000Z",
    LEADERBOARD_EVENT_GENERATION: "ctf26-final",
    REWARD_SNIPER_EVENT_ID: "reward-event-final",
    REWARD_SNIPER_SCORING_CONFIG_HASH: REWARD_CONFIG_HASH,
  };
  const participantOne = participantIdForEmail("one@example.com", env);
  const participantTwo = participantIdForEmail("two@example.com", env);
  assert.throws(() => leaderboardConfig({
    ...env,
    LEADERBOARD_PRIZE_POOL_USD: undefined,
  }), /requires explicit LEADERBOARD_PRIZE_POOL_USD/);
  assert.throws(() => leaderboardConfig({
    ...env,
    LEADERBOARD_MIN_INDIVIDUAL_AWARD_USD: undefined,
  }), /requires explicit LEADERBOARD_PRIZE_POOL_USD/);
  assert.throws(() => leaderboardConfig({
    ...env,
    LEADERBOARD_PRIZE_POOL_USD: "0",
  }), /requires a positive prize pool/);
  assert.deepEqual(leaderboardConfig(env).checkedInParticipantIds, [participantOne, participantTwo].sort());
  assert.doesNotThrow(() => assertScoreEventAllowed({
    participantId: participantOne,
    occurredAt: "2026-07-26T08:00:00.000Z",
  }, { ...env, LEADERBOARD_SCORING_MODE: "recovery" }, new Date("2026-07-26T10:40:00.000Z")));
  assert.throws(() => assertScoreEventAllowed({
    participantId: participantOne,
    occurredAt: "2026-07-26T08:00:00.000Z",
  }, env, new Date("2026-07-26T10:40:00.000Z")), /switch explicitly to recovery/);
  assert.throws(() => assertScoreEventAllowed({
    participantId: "not-checked-in",
    occurredAt: "2026-07-26T08:00:00.000Z",
  }, env, new Date("2026-07-26T08:00:01.000Z")), /not checked in/);
  assert.throws(() => assertScoreEventAllowed({
    participantId: participantOne,
    occurredAt: "2026-07-26T10:31:00.000Z",
  }, env, new Date("2026-07-26T10:31:01.000Z")), /outside the scoring window/);
  assert.throws(() => assertScoreEventAllowed({
    participantId: participantOne,
    occurredAt: "2026-07-26T08:00:00.000Z",
  }, { ...env, LEADERBOARD_SCORING_MODE: "frozen" }), /frozen/);
});

test("official challenge launches are checked-in, window-bound, and pauseable", () => {
  const roster = JSON.stringify([
    { email: "one@example.com", displayName: "One" },
    { email: "two@example.com", displayName: "Two" },
  ]);
  const base = {
    PARTICIPANT_ID_SECRET,
    PARTICIPANT_ROSTER_JSON: roster,
    LEADERBOARD_FIELD_SIZE: "2",
    LEADERBOARD_SCORING_MODE: "live",
    LEADERBOARD_PRIZE_POOL_USD: "100",
    LEADERBOARD_MIN_INDIVIDUAL_AWARD_USD: "1",
    LEADERBOARD_SCORING_START_AT: "2026-07-26T04:30:00.000Z",
    LEADERBOARD_SCORING_END_AT: "2026-07-26T10:30:00.000Z",
    LEADERBOARD_EVENT_GENERATION: "ctf26-final",
    REWARD_SNIPER_EVENT_ID: "reward-event-final",
    REWARD_SNIPER_SCORING_CONFIG_HASH: REWARD_CONFIG_HASH,
  };
  const participant = participantIdForEmail("one@example.com", base);
  assert.doesNotThrow(() => assertChallengeLaunchAllowed(participant, base, new Date("2026-07-26T08:00:00.000Z")));
  assert.throws(() => assertChallengeLaunchAllowed("not-checked-in", base, new Date("2026-07-26T08:00:00.000Z")), /not checked in/);
  assert.throws(() => assertChallengeLaunchAllowed(participant, base, new Date("2026-07-26T04:29:59.000Z")), /official scoring window/);
  assert.throws(() => assertChallengeLaunchAllowed(participant, { ...base, LEADERBOARD_SCORING_MODE: "recovery" }, new Date("2026-07-26T10:31:00.000Z")), /closed outside live/);
  assert.throws(() => assertChallengeLaunchAllowed(participant, { ...base, LEADERBOARD_LAUNCH_PAUSED: "true" }, new Date("2026-07-26T08:00:00.000Z")), /temporarily paused/);
  assert.doesNotThrow(() => assertChallengeLaunchAllowed("staging-player", {
    LEADERBOARD_REGISTERED_COUNT: "2",
    LEADERBOARD_FIELD_SIZE: "2",
  }));
});

test("solve storage is idempotent per challenge and participant", async () => {
  const store = createLeaderboardStore({ command: memoryRedis() });
  const event = {
    challenge: "imprint",
    participantId: "player-1",
    sourceId: "tx-1",
    occurredAt: "2026-07-16T08:00:00.000Z",
  };
  assert.equal(await store.recordSolve(event), true);
  assert.equal(await store.recordSolve({ ...event, sourceId: "tx-2" }), false);
  assert.equal((await store.solves()).length, 1);

  await store.upsertProfile({ participant_id: "player-1", leaderboard_name: "Packet Witch" });
  assert.deepEqual((await store.profiles()).map(({ participantId, displayName }) => ({ participantId, displayName })), [
    { participantId: "player-1", displayName: "Packet Witch" },
  ]);
});

test("solve storage closes atomically while finalization holds its lock", async () => {
  const command = memoryRedis();
  const store = createLeaderboardStore({ command });
  await command([
    "SET",
    "ctf26:leaderboard:v2:finalization-lock",
    "finalization",
  ]);
  await assert.rejects(() => store.recordSolve({
    challenge: "imprint",
    participantId: "late-player",
    sourceId: "late-proof",
    occurredAt: "2026-07-26T08:00:00.000Z",
  }), /score ingest is frozen/);
  assert.equal((await store.solves()).length, 0);
});

test("completion recovery backoff suppresses repeated downstream fanout", async () => {
  const store = createLeaderboardStore({ command: memoryRedis() });
  assert.equal(await store.completionRecoveryReady("second-key", "player-1"), true);
  await store.deferCompletionRecovery("second-key", "player-1", 30);
  assert.equal(await store.completionRecoveryReady("second-key", "player-1"), false);
  assert.equal(await store.completionRecoveryReady("second-key", "player-2"), true);
  await store.clearCompletionRecoveryBackoff("second-key", "player-1");
  assert.equal(await store.completionRecoveryReady("second-key", "player-1"), true);
});

test("rules acknowledgments retain every participant independently", async () => {
  const command = memoryRedis();
  const store = createLeaderboardStore({ command });
  await store.recordRulesAcknowledgment({ participant_id: "player-1" }, "v1");
  await store.recordRulesAcknowledgment({ participant_id: "player-2" }, "v1");
  assert.deepEqual((await store.rulesAcknowledgments()).map((entry) => entry.participantId).sort(), [
    "player-1",
    "player-2",
  ]);
});

test("malformed stored scoring data fails closed instead of silently changing points", async () => {
  const malformedHash = createLeaderboardStore({
    command: async (command) => command[0] === "HGETALL" ? ["player-1", "not-json"] : null,
  });
  await assert.rejects(() => malformedHash.solves(), /record is malformed/);

  const malformedCache = createLeaderboardStore({
    command: async (command) => command[0] === "GET" ? "not-json" : null,
  });
  await assert.rejects(() => malformedCache.cachedPerformance(), /snapshot is malformed/);
});

test("snapshot merges binary captures with Reward Sniper's authoritative market score", async () => {
  let cached;
  const store = {
    profiles: async () => [
      { participantId: "alpha", displayName: "Alpha" },
      { participantId: "bravo", displayName: "Bravo" },
    ],
    solves: async () => [
      { challenge: "imprint", participantId: "alpha" },
      { challenge: "imprint", participantId: "bravo" },
      { challenge: "signet", participantId: "alpha" },
    ],
    cachePerformance: async (rows) => { cached = { rows, updatedAt: "now" }; },
    cachedPerformance: async () => cached,
  };
  const snapshot = await leaderboardSnapshot({
    env: {
      LEADERBOARD_FIELD_SIZE: "50",
      LEADERBOARD_REGISTERED_COUNT: "50",
      LEADERBOARD_PRIZE_POOL_USD: "4000",
      REWARD_SNIPER_URL: "https://market.example/web/",
    },
    store,
    fetchImpl: async () => ({
      ok: true,
      headers: rewardHeaders(),
      json: async () => [
        { participantId: "bravo", score: 4, currentRoundShare: 0.8, qualified: false, stage: "live" },
        { participantId: "alpha", score: 2, currentRoundShare: 0.2, qualified: false, stage: "live" },
      ],
    }),
  });
  assert.equal(snapshot.rows[0].participantId, "alpha");
  assert.equal(snapshot.rows[0].points, 2_370);
  assert.equal(snapshot.rows[1].points, 1_870);
  assert.equal(snapshot.rows[0].breakdown["reward-sniper"].points, 500);
  assert.equal(snapshot.prizePoolPublished, true);
  assert.equal(snapshot.rows.reduce((sum, row) => sum + row.projectedPrizeCents, 0), 400_000);
  assert.equal(snapshot.performanceSource.available, true);
  assert.equal(snapshot.performanceSource.stale, false);
});

test("Reward Sniper may reset scores only at the intentional practice-to-live boundary", async () => {
  let cached = {
    rows: [{ participantId: "alpha", score: 0.9 }, { participantId: "bravo", score: 0.1 }],
    eventId: "event-one",
    eventGeneration: "rehearsal",
    stage: "practice",
    updatedAt: "2026-07-20T00:00:00.000Z",
  };
  const store = {
    profiles: async () => [],
    solves: async () => [],
    cachedPerformance: async () => cached,
    cachePerformance: async (rows, metadata) => {
      cached = { rows, ...metadata, updatedAt: "now" };
    },
  };
  const live = await leaderboardSnapshot({
    env: { LEADERBOARD_FIELD_SIZE: "50", REWARD_SNIPER_URL: "https://market.example/" },
    store,
    fetchImpl: async () => ({
      ok: true,
      headers: rewardHeaders({ eventId: "event-one", stage: "live" }),
      json: async () => [
        { participantId: "alpha", score: 0.1, stage: "live" },
        { participantId: "bravo", score: 0.05, stage: "live" },
      ],
    }),
  });
  assert.equal(live.performanceSource.stage, "live");
  assert.equal(live.performanceSource.stale, false);
  assert.equal(cached.stage, "live");

  const reverse = await leaderboardSnapshot({
    env: { LEADERBOARD_FIELD_SIZE: "50", REWARD_SNIPER_URL: "https://market.example/" },
    store,
    fetchImpl: async () => ({
      ok: true,
      headers: rewardHeaders({ eventId: "event-one", stage: "practice" }),
      json: async () => [{ participantId: "alpha", score: 1, stage: "practice" }],
    }),
  });
  assert.equal(reverse.performanceSource.stage, "live");
  assert.equal(reverse.performanceSource.stale, true);
});

test("a live market read remains authoritative when its cache write fails", async () => {
  const snapshot = await leaderboardSnapshot({
    env: {
      LEADERBOARD_FIELD_SIZE: "50",
      LEADERBOARD_REGISTERED_COUNT: "50",
      REWARD_SNIPER_URL: "https://market.example/",
    },
    store: {
      profiles: async () => [],
      solves: async () => [],
      cachePerformance: async () => { throw new Error("cache unavailable"); },
      cachedPerformance: async () => null,
    },
    fetchImpl: async () => ({
      ok: true,
      headers: rewardHeaders(),
      json: async () => [{ participantId: "alpha", score: 10, stage: "live" }],
    }),
  });
  assert.equal(snapshot.rows[0].points, 1_000);
  assert.equal(snapshot.performanceSource.available, true);
  assert.equal(snapshot.performanceSource.stale, false);
});

test("an upstream market outage uses the last good snapshot and marks it stale", async () => {
  const snapshot = await leaderboardSnapshot({
    env: {
      LEADERBOARD_FIELD_SIZE: "50",
      LEADERBOARD_REGISTERED_COUNT: "50",
      REWARD_SNIPER_URL: "https://market.example/",
    },
    store: {
      profiles: async () => [],
      solves: async () => [],
      cachePerformance: async () => {},
      cachedPerformance: async () => ({
        rows: [{ participantId: "alpha", score: 10, stage: "live" }],
        eventGeneration: "rehearsal",
        updatedAt: "2026-07-20T00:00:00.000Z",
      }),
    },
    fetchImpl: async () => { throw new Error("market unavailable"); },
  });
  assert.equal(snapshot.rows[0].points, 1_000);
  assert.equal(snapshot.performanceSource.available, true);
  assert.equal(snapshot.performanceSource.stale, true);
  assert.equal(snapshot.performanceSource.updatedAt, "2026-07-20T00:00:00.000Z");
});

test("duplicate or non-finite Reward Sniper rows are rejected in favor of the last good snapshot", async () => {
  for (const payload of [
    [
      { participantId: "alpha", score: 1, stage: "live" },
      { participantId: "alpha", score: 2, stage: "live" },
    ],
    [{ participantId: "alpha", score: Number.POSITIVE_INFINITY, stage: "live" }],
  ]) {
    let cacheWrites = 0;
    const snapshot = await leaderboardSnapshot({
      env: { LEADERBOARD_FIELD_SIZE: "50", REWARD_SNIPER_URL: "https://market.example/" },
      store: {
        profiles: async () => [],
        solves: async () => [],
        cachePerformance: async () => { cacheWrites += 1; },
        cachedPerformance: async () => ({
          rows: [{ participantId: "bravo", score: 3, stage: "live" }],
          eventId: "event-one",
          eventGeneration: "rehearsal",
          stage: "live",
          updatedAt: "2026-07-20T00:00:00.000Z",
        }),
      },
      fetchImpl: async () => ({
        ok: true,
        headers: rewardHeaders({ eventId: "event-one", stage: "live" }),
        json: async () => payload,
      }),
    });
    assert.equal(cacheWrites, 0);
    assert.equal(snapshot.performanceSource.stale, true);
    assert.deepEqual(snapshot.rows.map((row) => row.participantId), ["bravo"]);
  }
});

test("observed scoring participants expand a stale field size instead of taking the leaderboard down", async () => {
  const solves = Array.from({ length: 3 }, (_, index) => ({
    challenge: "imprint",
    participantId: `player-${index + 1}`,
  }));
  const snapshot = await leaderboardSnapshot({
    env: {
      LEADERBOARD_FIELD_SIZE: "2",
      LEADERBOARD_REGISTERED_COUNT: "3",
    },
    store: {
      profiles: async () => [],
      solves: async () => solves,
      cachedPerformance: async () => null,
    },
  });
  assert.equal(snapshot.configuredFieldSize, 2);
  assert.equal(snapshot.fieldSize, 3);
  assert.equal(snapshot.challengeValues.imprint.solveCount, 3);
});

test("all checked-in scorers remain in the ranking and share the configured pool", async () => {
  const snapshot = await leaderboardSnapshot({
    env: { LEADERBOARD_FIELD_SIZE: "2", LEADERBOARD_REGISTERED_COUNT: "2", LEADERBOARD_PRIZE_POOL_USD: "4000" },
    store: {
      profiles: async () => [
        { participantId: "alpha", displayName: "Alpha" },
        { participantId: "bravo", displayName: "Bravo" },
      ],
      solves: async () => [
        { challenge: "imprint", participantId: "alpha" },
        { challenge: "imprint", participantId: "bravo" },
      ],
      cachedPerformance: async () => null,
    },
  });
  assert.deepEqual(snapshot.rows.map((row) => row.participantId), ["alpha", "bravo"]);
  assert.deepEqual(snapshot.rows.map((row) => row.projectedPrizeCents), [200_000, 200_000]);
});
