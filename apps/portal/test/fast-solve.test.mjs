import assert from "node:assert/strict";
import test from "node:test";

import { evaluateFastSolveReview } from "../app/lib/fast-solve-delivery.mjs";
import { fastSolveReviewCandidate, fastSolveReviewSeconds } from "../app/lib/fast-solve.mjs";
import { recordFastSolveReview } from "../app/lib/integrity.mjs";
import { createLeaderboardStore } from "../app/lib/leaderboard-store.mjs";

const launch = Object.freeze({
  challenge: "signet",
  participantId: "participant-1",
  email: "player@example.test",
  launchedAt: "2026-07-22T10:00:00.000Z",
});

function solve(seconds) {
  return Object.freeze({
    challenge: "signet",
    participantId: "participant-1",
    sourceId: "solve-transaction",
    occurredAt: new Date(new Date(launch.launchedAt).valueOf() + seconds * 1_000).toISOString(),
  });
}

test("fast-solve review uses a strict configurable launch-to-completion window", () => {
  assert.equal(fastSolveReviewSeconds({}), 300);
  assert.equal(fastSolveReviewCandidate({ launch, event: solve(299) }).elapsedSeconds, 299);
  assert.equal(fastSolveReviewCandidate({ launch, event: solve(300) }), null);
  assert.equal(fastSolveReviewCandidate({ launch: null, event: solve(1) }), null);
  assert.equal(fastSolveReviewCandidate({ launch, event: solve(-1) }), null);
  assert.equal(fastSolveReviewCandidate({ launch, event: solve(-30) }).timing, "before-launch");
  assert.equal(fastSolveReviewCandidate({ launch, event: solve(-30) }).elapsedSeconds, -30);
  assert.equal(fastSolveReviewCandidate({
    launch,
    event: solve(600),
    env: { FAST_SOLVE_REVIEW_SECONDS: "601" },
  }).thresholdSeconds, 601);
  assert.throws(() => fastSolveReviewSeconds({ FAST_SOLVE_REVIEW_SECONDS: "59" }), /between 60 and 3600/);
});

test("the first launch is durable and a reload cannot reset its clock", async () => {
  const hashes = new Map();
  const command = async ([verb, key, field, value]) => {
    const hash = hashes.get(key) || new Map();
    hashes.set(key, hash);
    if (verb === "HSETNX") {
      if (hash.has(field)) return 0;
      hash.set(field, value);
      return 1;
    }
    if (verb === "HGET") return hash.get(field) || null;
    throw new Error(`unsupported command ${verb}`);
  };
  const store = createLeaderboardStore({
    command,
    env: { LEADERBOARD_EVENT_GENERATION: "generation-one" },
  });
  const first = await store.recordChallengeLaunch(launch);
  const retry = await store.recordChallengeLaunch({ ...launch, launchedAt: "2026-07-22T10:04:00.000Z" });
  assert.equal(first.launchedAt, launch.launchedAt);
  assert.equal(retry.launchedAt, launch.launchedAt);
  assert.equal((await store.challengeLaunch("signet", "participant-1")).email, "player@example.test");
});

test("integrity ingest receives a review-only participant-bound fast-solve case", async () => {
  let request;
  const candidate = fastSolveReviewCandidate({ launch, event: solve(120) });
  const result = await recordFastSolveReview(candidate, "generation-one", {
    env: {
      REWARD_SNIPER_ADMIN_URL: "https://reward.example",
      INTEGRITY_INGEST_KEY: "shared-integrity-ingest-key-that-is-long-enough",
    },
    fetchImpl: async (url, options) => {
      request = { url, options };
      return { ok: true, status: 202, json: async () => ({ caseId: "rsic_abcdefghijk" }) };
    },
  });
  assert.equal(result.caseId, "rsic_abcdefghijk");
  assert.equal(request.url, "https://reward.example/api/internal/integrity/suspicion");
  const body = JSON.parse(request.options.body);
  assert.equal(body.reasonCode, "challenge-solved-unusually-fast");
  assert.equal(body.identity.participantId, "participant-1");
  assert.equal(body.evidence.details.elapsedSeconds, 120);
  assert.doesNotMatch(JSON.stringify(body), /disqualif|score adjustment/i);
});

test("failed integrity delivery keeps the durable outbox pending and never throws into scoring", async () => {
  const candidate = fastSolveReviewCandidate({ launch, event: solve(100) });
  let recorded = false;
  const store = {
    challengeLaunch: async () => launch,
    recordFastSolveReview: async (value) => {
      recorded = true;
      return { ...value, deliveryStatus: "pending" };
    },
    markFastSolveReviewDelivered: async () => assert.fail("delivery must remain pending"),
  };
  const result = await evaluateFastSolveReview({
    store,
    event: solve(100),
    eventGeneration: "generation-one",
    env: {
      REWARD_SNIPER_ADMIN_URL: "https://reward.example",
      INTEGRITY_INGEST_KEY: "shared-integrity-ingest-key-that-is-long-enough",
    },
    fetchImpl: async () => { throw new Error("service offline"); },
    logger: { error() {} },
  });
  assert.equal(recorded, true);
  assert.equal(result.review, true);
  assert.equal(result.deliveryStatus, "pending");
  assert.equal(candidate.elapsedSeconds, 100);
});
