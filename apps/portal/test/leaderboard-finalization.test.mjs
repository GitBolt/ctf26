import assert from "node:assert/strict";
import test from "node:test";

import { assertIntegrityWriteAllowed } from "../app/lib/integrity-lifecycle.mjs";
import {
  activeIntegrityCases,
  assertIntegrityIngestFrozen,
  assertIntegrityReviewFrozen,
  integrityReviewSeal,
  missingRulesAcknowledgments,
} from "../app/lib/leaderboard-finalization.mjs";
import { createLeaderboardStore } from "../app/lib/leaderboard-store.mjs";

function finalizationRedis() {
  const strings = new Map();
  const command = async (parts) => {
    const [verb, key, field, value] = parts;
    if (verb === "GET") return strings.get(key) || null;
    if (verb === "SET") {
      if (parts.includes("NX") && strings.has(key)) return null;
      strings.set(key, field);
      return "OK";
    }
    if (verb === "DEL") return strings.delete(key) ? 1 : 0;
    if (verb !== "EVAL") throw new Error(`unsupported fake Redis command ${verb}`);

    const script = parts[1];
    const keyCount = Number(parts[2]);
    const keys = parts.slice(3, 3 + keyCount);
    const args = parts.slice(3 + keyCount);
    if (script.includes("local lock=redis.call('GET',KEYS[2])")) {
      const lock = strings.get(keys[1]);
      if (!lock) return ["not-finalizing"];
      if (lock !== args[0]) return ["wrong-lock"];
      if (Number(strings.get(keys[2]) || 0) !== Number(args[1])) return ["stale"];
      if (strings.has(keys[0])) return ["existing", strings.get(keys[0])];
      strings.set(keys[0], args[5]);
      return ["ok", args[5]];
    }
    throw new Error("unsupported fake Redis script");
  };
  return { command, strings };
}

const CONFIG_HASH = "a".repeat(64);
const GENERATION = "ctf26-final";
const REWARD_EVENT = "reward-event-final";

test("final seal rejects a snapshot from an earlier score revision", async () => {
  const redis = finalizationRedis();
  const store = createLeaderboardStore({ command: redis.command, env: { LEADERBOARD_EVENT_GENERATION: GENERATION } });
  const lockToken = "12345678-1234-1234-1234-123456789abc";
  await store.acquireFinalizationLock(lockToken);
  redis.strings.set(`ctf26:leaderboard:v2:${GENERATION}:snapshot-revision`, "1");
  const snapshot = {
    rows: [],
    configHash: CONFIG_HASH,
    eventGeneration: GENERATION,
    snapshotRevision: 0,
    performanceSource: { eventId: REWARD_EVENT },
  };
  await assert.rejects(() => store.sealFinalPublicSnapshot(snapshot, { finalizationToken: lockToken }), /changed before/);
  const sealed = await store.sealFinalPublicSnapshot({ ...snapshot, snapshotRevision: 1 }, { finalizationToken: lockToken });
  assert.equal(sealed.snapshotRevision, 1);
  assert.equal(sealed.scoringMode, "frozen");
});

test("integrity finalization selects only the active Reward event and portal generation", () => {
  const config = { rewardEventId: REWARD_EVENT, eventGeneration: GENERATION };
  const report = {
    generatedAt: Date.now(),
    event: { eventId: REWARD_EVENT, stage: "complete" },
    cases: [
      { id: "current-reward", challenge: "reward-sniper", eventId: REWARD_EVENT, participantId: "one", status: "cleared", updatedAt: 1 },
      { id: "old-reward", challenge: "reward-sniper", eventId: "old-event", participantId: "two", status: "open", updatedAt: 2 },
      { id: "current-portal", challenge: "imprint", eventId: GENERATION, participantId: "three", status: "confirmed", updatedAt: 3 },
      { id: "old-portal", challenge: "imprint", eventId: "old-generation", participantId: "four", status: "open", updatedAt: 4 },
    ],
  };
  assert.deepEqual(activeIntegrityCases(report, config).map((entry) => entry.id), ["current-reward", "current-portal"]);
  const seal = integrityReviewSeal(report, config);
  assert.equal(seal.activeCaseCount, 2);
  assert.match(seal.digest, /^[0-9a-f]{64}$/);
});

test("finalization accepts only a durable integrity freeze bound to the active configuration", () => {
  const config = {
    rewardEventId: REWARD_EVENT,
    eventGeneration: GENERATION,
    rewardScoringConfigHash: CONFIG_HASH,
  };
  const report = {
    event: {
      ingestFrozen: true,
      ingestFreeze: {
        eventId: REWARD_EVENT,
        eventGeneration: GENERATION,
        scoringConfigHash: CONFIG_HASH,
        frozenAt: Date.now(),
      },
    },
  };
  assert.equal(assertIntegrityIngestFrozen(report, config).eventId, REWARD_EVENT);
  assert.throws(() => assertIntegrityIngestFrozen({
    event: { ...report.event, ingestFreeze: { ...report.event.ingestFreeze, eventGeneration: "old" } },
  }, config), /not durably frozen/);
});

test("finalization binds the stable integrity review digest separately from ingest closure", () => {
  const config = {
    rewardEventId: REWARD_EVENT,
    eventGeneration: GENERATION,
    rewardScoringConfigHash: CONFIG_HASH,
  };
  const review = { digest: "b".repeat(64), activeCaseCount: 3 };
  const report = {
    event: {
      reviewFrozen: true,
      reviewFreeze: {
        eventId: REWARD_EVENT,
        eventGeneration: GENERATION,
        scoringConfigHash: CONFIG_HASH,
        digest: review.digest,
        activeCaseCount: 3,
        frozenAt: Date.now(),
      },
    },
  };
  assert.equal(assertIntegrityReviewFrozen(report, config, review).digest, review.digest);
  assert.throws(() => assertIntegrityReviewFrozen(report, config, {
    ...review,
    digest: "c".repeat(64),
  }), /not durably sealed/);
});

test("finalization requires the current rules from every checked-in participant", () => {
  const roster = new Map([
    ["one@example.com", { email: "one@example.com", participantId: "player-one" }],
    ["two@example.com", { email: "two@example.com", participantId: "player-two" }],
    ["other@example.com", { email: "other@example.com", participantId: "not-checked-in" }],
  ]);
  const missing = missingRulesAcknowledgments({
    roster,
    checkedInParticipantIds: ["player-one", "player-two"],
    acknowledgments: [
      { participantId: "player-one", rulesVersion: "v2" },
      { participantId: "player-two", rulesVersion: "v1" },
    ],
    rulesVersion: "v2",
  });
  assert.deepEqual(missing.map((entry) => entry.email), ["two@example.com"]);
});

test("passive integrity telemetry remains writable until freezing", async () => {
  await assert.doesNotReject(() => assertIntegrityWriteAllowed({
    env: { LEADERBOARD_REGISTERED_COUNT: "2", LEADERBOARD_FIELD_SIZE: "2" },
    store: {},
  }));
});
