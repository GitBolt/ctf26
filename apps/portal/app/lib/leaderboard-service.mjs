import crypto from "node:crypto";

import { calculateLeaderboard } from "@ctf26/leaderboard";

import { resolveLeaderboardConfig } from "./leaderboard-lifecycle.mjs";
import { createLeaderboardStore } from "./leaderboard-store.mjs";

function rewardScoreboardUrl(env) {
  const configured = String(env.REWARD_SNIPER_ADMIN_URL || env.REWARD_SNIPER_URL || "").trim();
  if (!configured) return null;
  const base = new URL(configured);
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password) {
    throw new Error("Reward Sniper URL is invalid");
  }
  return new URL("/api/scoreboard", base);
}

function normalizePerformance(rows) {
  if (!Array.isArray(rows)) throw new Error("Reward Sniper scoreboard is invalid");
  const seen = new Set();
  return rows.map((row) => {
    const participantId = String(row?.participantId || "");
    const score = Number(row?.score);
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(participantId)) {
      throw new Error("Reward Sniper scoreboard contains an invalid participant ID");
    }
    if (seen.has(participantId)) throw new Error("Reward Sniper scoreboard contains a duplicate participant");
    if (!Number.isFinite(score)) throw new Error("Reward Sniper scoreboard contains a non-finite score");
    seen.add(participantId);
    return {
      participantId,
      score: row.stage === "complete" && row.qualified !== true ? 0 : Math.max(0, score),
    };
  }).filter((row) => row.score > 0);
}

function isUnexpectedRegression(cached, payload, eventId, stage, scoringConfigHash) {
  if (!Array.isArray(cached?.rows) || cached.rows.length === 0) return false;
  if (cached.eventId && eventId && cached.eventId !== eventId) return true;
  if (cached.scoringConfigHash && scoringConfigHash && cached.scoringConfigHash !== scoringConfigHash) return true;
  const stageOrder = new Map([["practice", 0], ["live", 1], ["complete", 2]]);
  const previousStage = String(cached.stage || "");
  if (stageOrder.has(previousStage) && stageOrder.has(stage)) {
    if (stageOrder.get(stage) < stageOrder.get(previousStage)) return true;
    // Practice rewards are intentionally reset when the scored market opens.
    if (previousStage === "practice" && stage === "live") return false;
  }
  const rawByParticipant = new Map(payload.map((row) => [String(row?.participantId || ""), row]));
  return normalizePerformance(cached.rows).some((previous) => {
    const raw = rawByParticipant.get(previous.participantId);
    if (!raw) return true;
    if (stage === "complete" && raw.qualified !== true) return false;
    return Math.max(0, Number(raw.score) || 0) + Number.EPSILON < previous.score;
  });
}

async function livePerformance({ env, fetchImpl, store, config }) {
  const url = rewardScoreboardUrl(env);
  if (url) {
    try {
      const response = await fetchImpl(url, {
        headers: { accept: "application/json" },
        cache: "no-store",
        signal: AbortSignal.timeout(3_000),
      });
      if (!response.ok) throw new Error(`Reward Sniper scoreboard returned ${response.status}`);
      const payload = await response.json();
      if (!Array.isArray(payload)) throw new Error("Reward Sniper scoreboard is invalid");
      const headerEventId = String(response.headers?.get?.("x-reward-event-id") || "");
      const headerStage = String(response.headers?.get?.("x-reward-event-stage") || "");
      const headerEventGeneration = String(response.headers?.get?.("x-reward-event-generation") || "");
      const headerScoringConfigHash = String(response.headers?.get?.("x-reward-scoring-config") || "").toLowerCase();
      const stages = new Set(payload.map((row) => String(row?.stage || "")).filter(Boolean));
      if (headerStage) stages.add(headerStage);
      if (stages.size > 1 || [...stages].some((stage) => !["practice", "live", "complete", "continuous"].includes(stage))) {
        throw new Error("Reward Sniper scoreboard stage is invalid");
      }
      const stage = stages.size === 1 ? [...stages][0] : "";
      if (config.rewardEventId && headerEventId !== config.rewardEventId) {
        throw new Error("Reward Sniper scoreboard belongs to another event");
      }
      if (config.rewardScoringConfigHash && headerScoringConfigHash !== config.rewardScoringConfigHash) {
        throw new Error("Reward Sniper scoreboard uses another scoring configuration");
      }
      if (headerEventGeneration !== config.eventGeneration) {
        throw new Error("Reward Sniper scoreboard belongs to another CTF event generation");
      }
      if (config.scoringMode !== "staging") {
        const payloadParticipants = [...new Set(payload.map((row) => String(row?.participantId || "")))].sort();
        const expectedParticipants = [...config.checkedInParticipantIds].sort();
        if (
          payloadParticipants.length !== expectedParticipants.length
          || payloadParticipants.some((participantId, index) => participantId !== expectedParticipants[index])
        ) {
          throw new Error("Reward Sniper scoreboard does not match the checked-in roster");
        }
      }
      const rows = normalizePerformance(payload);
      const cached = await store.cachedPerformance().catch(() => null);
      if (isUnexpectedRegression(cached, payload, headerEventId, stage, headerScoringConfigHash)) {
        throw new Error("Reward Sniper scoreboard regressed or returned a partial event");
      }
      const updatedAt = new Date().toISOString();
      await store.cachePerformance(rows, {
        eventId: headerEventId,
        eventGeneration: headerEventGeneration,
        scoringConfigHash: headerScoringConfigHash,
        stage,
      }).catch(() => null);
      return {
        rows,
        available: true,
        stale: false,
        updatedAt,
        eventId: headerEventId,
        eventGeneration: headerEventGeneration,
        scoringConfigHash: headerScoringConfigHash,
        stage,
      };
    } catch {
      // A short Reward Sniper outage should not blank the whole event board. Use the last good read.
    }
  }
  const candidate = await store.cachedPerformance();
  const cached = candidate
    && (!config.rewardEventId || candidate.eventId === config.rewardEventId)
    && (!config.rewardScoringConfigHash || candidate.scoringConfigHash === config.rewardScoringConfigHash)
    && candidate.eventGeneration === config.eventGeneration
    ? candidate
    : null;
  return {
    rows: Array.isArray(cached?.rows) ? normalizePerformance(cached.rows) : [],
    available: Boolean(cached),
    stale: Boolean(cached),
    updatedAt: cached?.updatedAt || null,
    eventId: cached?.eventId || "",
    eventGeneration: cached?.eventGeneration || "",
    scoringConfigHash: cached?.scoringConfigHash || "",
    stage: cached?.stage || "",
  };
}

async function calculateSnapshot({ env, store, fetchImpl, config }) {
  if (typeof store.assertEventConfig === "function") await store.assertEventConfig(config.configHash);
  const [profiles, solves, performance, eligibilityLedger] = await Promise.all([
    store.profiles(),
    store.solves(),
    livePerformance({ env, fetchImpl, store, config }),
    typeof store.eligibilityLedger === "function"
      ? store.eligibilityLedger()
      : Promise.resolve(typeof store.eligibilityDecisions === "function" ? store.eligibilityDecisions() : [])
        .then((decisions) => ({ revision: 0, frozen: false, freeze: null, decisions })),
  ]);
  const eligibilityDecisions = eligibilityLedger.decisions;
  const checkedIn = new Set(config.checkedInParticipantIds);
  const disqualified = new Set(eligibilityDecisions
    .filter((decision) => decision?.state === "approved" && decision?.status === "disqualified")
    .map((decision) => String(decision.participantId)));
  const officialScoring = config.scoringMode !== "staging";
  const eligibleProfiles = officialScoring
    ? profiles.filter((profile) => checkedIn.has(profile.participantId) && !disqualified.has(profile.participantId))
    : profiles.filter((profile) => !disqualified.has(profile.participantId));
  const eligibleSolves = officialScoring
    ? solves.filter((solve) => checkedIn.has(solve.participantId) && !disqualified.has(solve.participantId))
    : solves.filter((solve) => !disqualified.has(solve.participantId));
  const eligiblePerformance = officialScoring
    ? performance.rows.filter((row) => checkedIn.has(row.participantId) && !disqualified.has(row.participantId))
    : performance.rows.filter((row) => !disqualified.has(row.participantId));
  const observedScoringParticipants = new Set([
    ...eligibleSolves.map((solve) => solve.participantId),
    ...eligiblePerformance.map((row) => row.participantId),
  ]).size;
  const effectiveFieldSize = officialScoring
    ? config.fieldSize
    : Math.max(config.fieldSize, observedScoringParticipants);
  const calculated = calculateLeaderboard({
    profiles: eligibleProfiles,
    solves: eligibleSolves,
    performance: eligiblePerformance,
    fieldSize: effectiveFieldSize,
    prizePool: config.prizePool,
    minimumAward: config.minimumAward,
  });
  return Object.freeze({
    ...calculated,
    generatedAt: new Date().toISOString(),
    configuredFieldSize: config.fieldSize,
    registeredCount: config.registeredCount,
    prizePoolPublished: config.prizePoolPublished,
    currency: config.currency,
    scoringMode: config.scoringMode,
    scoringStartAt: config.scoringStartAt,
    scoringEndAt: config.scoringEndAt,
    eventGeneration: config.eventGeneration,
    configHash: config.configHash,
    scoringSchemaVersion: config.scoringSchemaVersion,
    eligibilityRevision: eligibilityLedger.revision,
    eligibility: Object.freeze({
      disqualifiedParticipantIds: Object.freeze([...disqualified].sort()),
      decisionCount: eligibilityDecisions.length,
      revision: eligibilityLedger.revision,
      frozen: eligibilityLedger.frozen === true,
      frozenAt: eligibilityLedger.freeze?.acquiredAt || null,
    }),
    performanceSource: Object.freeze({
      available: performance.available,
      stale: performance.stale,
      updatedAt: performance.updatedAt,
      eventId: performance.eventId,
      eventGeneration: performance.eventGeneration,
      scoringConfigHash: performance.scoringConfigHash,
      stage: performance.stage,
    }),
  });
}

export async function leaderboardSnapshot(options = {}) {
  const env = options.env || process.env;
  const fetchImpl = options.fetchImpl || fetch;
  const store = options.store || createLeaderboardStore({ env, fetchImpl });
  const config = options.config || await resolveLeaderboardConfig({ env, store });
  const supportsSharedCache = !options.skipSharedCache
    && typeof store.freshPublicSnapshot === "function"
    && typeof store.latestPublicSnapshot === "function"
    && typeof store.acquirePublicSnapshotRefresh === "function"
    && typeof store.releasePublicSnapshotRefresh === "function"
    && typeof store.cachePublicSnapshot === "function"
    && typeof store.finalPublicSnapshot === "function"
    && typeof store.sealFinalPublicSnapshot === "function";
  if (!supportsSharedCache) return calculateSnapshot({ env, store, fetchImpl, config });

  if (config.scoringMode === "freezing" || config.scoringMode === "frozen") {
    const final = await store.finalPublicSnapshot();
    if (final) {
      if (final.configHash !== config.configHash || !Number.isSafeInteger(final.eligibilityRevision)) {
        throw new Error("final leaderboard configuration mismatch");
      }
      return final;
    }
    if (config.scoringMode === "freezing") {
      const latest = await store.latestPublicSnapshot();
      if (latest) {
        if (latest.configHash !== config.configHash || !Number.isSafeInteger(latest.eligibilityRevision)) {
          throw new Error("freezing leaderboard configuration mismatch");
        }
        return Object.freeze({ ...latest, scoringMode: "freezing", sharedCacheStale: true });
      }
      throw new Error("leaderboard is freezing and no stable snapshot is available");
    }
    throw new Error("final leaderboard snapshot has not been sealed by an organizer");
  }

  const fresh = await store.freshPublicSnapshot();
  if (fresh?.configHash === config.configHash && Number.isSafeInteger(fresh.eligibilityRevision)) return fresh;

  const lockToken = crypto.randomUUID();
  if (await store.acquirePublicSnapshotRefresh(lockToken)) {
    try {
      const snapshot = await calculateSnapshot({ env, store, fetchImpl, config });
      await store.cachePublicSnapshot(snapshot);
      return snapshot;
    } finally {
      await store.releasePublicSnapshotRefresh(lockToken).catch(() => null);
    }
  }

  for (let attempt = 0; attempt < 10; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    const retry = await store.freshPublicSnapshot();
    if (retry?.configHash === config.configHash && Number.isSafeInteger(retry.eligibilityRevision)) return retry;
  }
  const latest = await store.latestPublicSnapshot();
  if (latest?.configHash === config.configHash && Number.isSafeInteger(latest.eligibilityRevision)) {
    return Object.freeze({ ...latest, sharedCacheStale: true });
  }
  throw new Error("leaderboard snapshot refresh is already in progress");
}
