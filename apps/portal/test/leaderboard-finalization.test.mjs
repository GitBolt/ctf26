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

function eligibilityRedis() {
  const strings = new Map();
  const hashes = new Map();
  const hash = (key) => {
    if (!hashes.has(key)) hashes.set(key, new Map());
    return hashes.get(key);
  };
  const increment = (key) => {
    const next = Number(strings.get(key) || 0) + 1;
    strings.set(key, String(next));
    return next;
  };
  const command = async (parts) => {
    const [verb, key, field, value] = parts;
    if (verb === "GET") return strings.get(key) || null;
    if (verb === "SET") {
      if (parts.includes("NX") && strings.has(key)) return null;
      strings.set(key, field);
      return "OK";
    }
    if (verb === "DEL") return strings.delete(key) ? 1 : 0;
    if (verb === "HGETALL") return [...hash(key)].flatMap(([entryKey, encoded]) => [entryKey, encoded]);
    if (verb !== "EVAL") throw new Error(`unsupported fake Redis command ${verb}`);

    const script = parts[1];
    const keyCount = Number(parts[2]);
    const keys = parts.slice(3, 3 + keyCount);
    const args = parts.slice(3 + keyCount);
    if (script.includes("HSETNX',KEYS[2]")) {
      if (strings.has(keys[0])) return ["frozen"];
      if (strings.has(keys[5])) return ["finalizing"];
      if (hash(keys[1]).has(args[0])) return ["duplicate"];
      hash(keys[1]).set(args[0], args[1]);
      increment(keys[2]);
      strings.delete(keys[3]);
      strings.delete(keys[4]);
      return ["ok", args[1]];
    }
    if (script.includes("p.state='approved'")) {
      if (strings.has(keys[0])) return ["frozen"];
      if (strings.has(keys[7])) return ["finalizing"];
      const raw = hash(keys[1]).get(args[0]);
      if (!raw) return ["missing"];
      const proposal = JSON.parse(raw);
      if (proposal.state !== "proposed") return ["closed"];
      if (proposal.proposer === args[1]) return ["same-organizer"];
      Object.assign(proposal, { state: "approved", approver: args[1], approvedAt: args[2] });
      const encoded = JSON.stringify(proposal);
      hash(keys[1]).set(args[0], encoded);
      hash(keys[2]).set(proposal.participantId, encoded);
      increment(keys[4]);
      strings.delete(keys[5]);
      strings.delete(keys[6]);
      return ["ok", encoded];
    }
    if (script.includes("p.state='rejected'")) {
      if (strings.has(keys[0])) return ["frozen"];
      if (strings.has(keys[6])) return ["finalizing"];
      const raw = hash(keys[1]).get(args[0]);
      if (!raw) return ["missing"];
      const proposal = JSON.parse(raw);
      if (proposal.state !== "proposed") return ["closed"];
      if (proposal.proposer === args[1]) return ["same-organizer"];
      Object.assign(proposal, { state: "rejected", reviewer: args[1], reviewedAt: args[2] });
      const encoded = JSON.stringify(proposal);
      hash(keys[1]).set(args[0], encoded);
      increment(keys[3]);
      strings.delete(keys[4]);
      strings.delete(keys[5]);
      return ["ok", encoded];
    }
    if (script.includes("local result={redis.call")) {
      return [
        strings.get(keys[1]) || "0",
        strings.get(keys[2]) || "",
        ...hash(keys[0]).values(),
      ];
    }
    if (script.includes("local f={token=ARGV[1]")) {
      const existing = strings.get(keys[0]);
      if (existing) {
        const freeze = JSON.parse(existing);
        if (freeze.configHash !== args[1] || freeze.eventGeneration !== args[2] || freeze.rewardEventId !== args[3]) {
          return ["mismatch"];
        }
        return ["existing", existing];
      }
      if ([...hash(keys[1]).values()].map((encoded) => JSON.parse(encoded)).some((entry) => entry.state === "proposed")) return ["open-proposals"];
      if ([...hash(keys[2]).values()].map((encoded) => JSON.parse(encoded)).some((entry) => entry.state === "approved" && entry.status === "held")) return ["held"];
      const freeze = {
        token: args[0],
        configHash: args[1],
        eventGeneration: args[2],
        rewardEventId: args[3],
        organizer: args[4],
        acquiredAt: args[5],
        revision: Number(strings.get(keys[3]) || 0),
      };
      const encoded = JSON.stringify(freeze);
      strings.set(keys[0], encoded);
      return ["ok", encoded];
    }
    if (script.includes("f.token~=ARGV[1]")) {
      const raw = strings.get(keys[1]);
      if (!raw) return ["not-frozen"];
      const freeze = JSON.parse(raw);
      if (freeze.token !== args[0]) return ["wrong-freeze"];
      if (freeze.configHash !== args[2] || freeze.eventGeneration !== args[3] || freeze.rewardEventId !== args[4]) return ["mismatch"];
      if (Number(strings.get(keys[2]) || 0) !== Number(args[1]) || freeze.revision !== Number(args[1])) return ["stale"];
      if (strings.has(keys[0])) return ["existing", strings.get(keys[0])];
      strings.set(keys[0], args[5]);
      return ["ok", args[5]];
    }
    if (script.includes("tonumber(redis.call('GET',KEYS[1])")) {
      if (Number(strings.get(keys[0]) || 0) !== Number(args[0])) return 0;
      strings.set(keys[1], args[1]);
      strings.set(keys[2], args[1]);
      return 1;
    }
    throw new Error("unsupported fake Redis script");
  };
  return { command, strings };
}

const CONFIG_HASH = "a".repeat(64);
const GENERATION = "ctf26-final";
const REWARD_EVENT = "reward-event-final";

test("eligibility freeze is durable and prevents every later ledger mutation", async () => {
  const redis = eligibilityRedis();
  const store = createLeaderboardStore({ command: redis.command, env: { LEADERBOARD_EVENT_GENERATION: GENERATION } });
  const proposal = await store.proposeEligibilityDecision({
    participantId: "player-one",
    status: "disqualified",
    reason: "Confirmed event integrity ruling",
    organizer: "first@example.com",
  });
  await store.approveEligibilityDecision(proposal.id, "second@example.com");
  const before = await store.eligibilityLedger();
  assert.equal(before.revision, 2);
  assert.equal(before.decisions[0].status, "disqualified");

  const freeze = await store.acquireEligibilityFreeze({
    configHash: CONFIG_HASH,
    eventGeneration: GENERATION,
    rewardEventId: REWARD_EVENT,
    organizer: "finalizer@example.com",
  });
  assert.equal(freeze.revision, 2);
  assert.equal((await store.eligibilityLedger()).frozen, true);
  await assert.rejects(() => store.proposeEligibilityDecision({
    participantId: "player-two",
    status: "held",
    reason: "Requires a second organizer review",
    organizer: "first@example.com",
  }), /frozen/);
  await assert.rejects(() => store.approveEligibilityDecision(proposal.id, "third@example.com"), /frozen/);
});

test("eligibility mutations remain reviewable in freezing but stop atomically during final sealing", async () => {
  const redis = eligibilityRedis();
  const store = createLeaderboardStore({ command: redis.command, env: {
    LEADERBOARD_EVENT_GENERATION: GENERATION,
    LEADERBOARD_SCORING_MODE: "freezing",
  } });
  const proposal = await store.proposeEligibilityDecision({
    participantId: "player-one",
    status: "held",
    reason: "Requires a second organizer review",
    organizer: "first@example.com",
  });
  await store.acquireFinalizationLock("12345678-1234-1234-1234-123456789abc");
  await assert.rejects(() => store.proposeEligibilityDecision({
    participantId: "player-two",
    status: "held",
    reason: "Requires a second organizer review",
    organizer: "first@example.com",
  }), /sealing is in progress/);
  await assert.rejects(() => store.approveEligibilityDecision(proposal.id, "second@example.com"), /sealing is in progress/);
  await assert.rejects(() => store.rejectEligibilityProposal(proposal.id, "second@example.com"), /sealing is in progress/);
});

test("final seal rejects a snapshot from an earlier eligibility revision", async () => {
  const redis = eligibilityRedis();
  const store = createLeaderboardStore({ command: redis.command, env: { LEADERBOARD_EVENT_GENERATION: GENERATION } });
  const proposal = await store.proposeEligibilityDecision({
    participantId: "player-one",
    status: "eligible",
    reason: "Review found no scoring violation",
    organizer: "first@example.com",
  });
  const staleRevision = (await store.eligibilityLedger()).revision;
  await store.rejectEligibilityProposal(proposal.id, "second@example.com");
  const freeze = await store.acquireEligibilityFreeze({
    configHash: CONFIG_HASH,
    eventGeneration: GENERATION,
    rewardEventId: REWARD_EVENT,
    organizer: "finalizer@example.com",
  });
  const snapshot = {
    rows: [],
    configHash: CONFIG_HASH,
    eventGeneration: GENERATION,
    eligibilityRevision: staleRevision,
    performanceSource: { eventId: REWARD_EVENT },
  };
  await assert.rejects(() => store.sealFinalPublicSnapshot(snapshot, { freezeToken: freeze.token }), /changed before/);
  const sealed = await store.sealFinalPublicSnapshot({ ...snapshot, eligibilityRevision: freeze.revision }, { freezeToken: freeze.token });
  assert.equal(sealed.eligibilityRevision, freeze.revision);
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
  assert.throws(() => integrityReviewSeal(report, config), /resolve every active-event/);
  const seal = integrityReviewSeal(report, config, ["three"]);
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

test("integrity writes fail closed after an explicit eligibility freeze", async () => {
  await assert.rejects(() => assertIntegrityWriteAllowed({
    env: { LEADERBOARD_REGISTERED_COUNT: "2", LEADERBOARD_FIELD_SIZE: "2" },
    store: { eligibilityLedger: async () => ({ frozen: true }) },
  }), /frozen/);
});
