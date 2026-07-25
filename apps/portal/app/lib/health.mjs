import crypto from "node:crypto";

import { CHALLENGES, challengeDestination } from "./challenges.mjs";
import { leaderboardRedisCommand } from "./leaderboard-redis.mjs";
import { leaderboardConfig } from "./leaderboard-config.mjs";
import { resolveLeaderboardConfig } from "./leaderboard-lifecycle.mjs";
import { createLeaderboardStore } from "./leaderboard-store.mjs";
import { participantRoster } from "./registration.mjs";
import { challengeTicketSecret } from "./tickets.js";
import { fastSolveReviewSeconds } from "./fast-solve.mjs";
import { organizerConfiguration } from "./organizers.mjs";

const sharedHealthCache = { value: null, expiresAt: 0, inFlight: null };

const HEALTH_PATHS = Object.freeze({
  "reward-sniper": "/api/health",
  imprint: "/api/health",
  signet: "/api/health",
  drift: "/health",
  "last-stop": "/health",
  "after-hours": "/health",
  "player-two": "/health",
  "the-broadcast": "/health",
  "evidence-room": "/health",
  "second-key": "/health",
  "the-chamber": "/health",
});

const COMPLETION_CHALLENGES = new Set([
  "signet",
  "drift",
  "last-stop",
  "after-hours",
  "player-two",
  "the-broadcast",
  "evidence-room",
  "second-key",
  "the-chamber",
]);

const READINESS_PARTICIPANT_ID = "portal-readiness";
const TRANSIENT_HEALTH_RETRY_DELAY_MS = 150;

function required(value, name, minimum = 1) {
  if (typeof value !== "string" || Buffer.byteLength(value) < minimum) {
    throw new Error(`${name} is not configured`);
  }
  return value;
}

function productionUrl(value, name) {
  const url = new URL(required(value, name));
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new Error(`${name} must be a credential-free HTTPS URL`);
  }
  return url;
}

function timeoutMs(env) {
  const value = Number(env.PORTAL_DEPENDENCY_TIMEOUT_MS || 4_000);
  if (!Number.isSafeInteger(value) || value < 500 || value > 10_000) {
    throw new Error("PORTAL_DEPENDENCY_TIMEOUT_MS must be an integer between 500 and 10000");
  }
  return value;
}

async function within(promise, milliseconds, label) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out`)), milliseconds);
        timer.unref?.();
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function readJson(response, label) {
  if (!response?.ok) throw new Error(`${label} returned ${response?.status || "an invalid response"}`);
  const body = await response.json().catch(() => null);
  if (!body || typeof body !== "object") throw new Error(`${label} returned invalid JSON`);
  return body;
}

async function probeChallengeHealth(challenge, destination, fetchImpl, signal) {
  const url = new URL(HEALTH_PATHS[challenge.key], destination.url);
  const request = () => fetchImpl(url, {
      cache: "no-store",
      headers: { accept: "application/json" },
      signal,
    });
  let response = await request();
  if (response?.status >= 500 && response.status <= 599 && !signal?.aborted) {
    await new Promise((resolve) => setTimeout(resolve, TRANSIENT_HEALTH_RETRY_DELAY_MS));
    response = await request();
  }
  const body = await readJson(response, `${challenge.name} health`);
  if (body.ok !== true) throw new Error(`${challenge.name} is not ready`);
  return body;
}

async function probeCompletion(challenge, destination, secret, generation, fetchImpl, signal) {
  const url = new URL("/api/completion", destination.url);
  url.searchParams.set("participantId", READINESS_PARTICIPANT_ID);
  const response = await fetchImpl(url, {
    cache: "no-store",
    headers: {
      accept: "application/json",
      authorization: `Bearer ${secret}`,
    },
    signal,
  });
  const body = await readJson(response, `${challenge.name} completion`);
  if (typeof body.completed !== "boolean") throw new Error(`${challenge.name} completion contract is invalid`);
  if (String(body.eventGeneration || "") !== generation) {
    throw new Error(`${challenge.name} completion belongs to another event generation`);
  }
  return body;
}

async function probeRewardScoreboard(baseUrl, expectedEventId, expectedGeneration, expectedScoringConfigHash, expectedParticipantIds, expectedStartsAt, expectedEndsAt, fetchImpl, signal) {
  const response = await fetchImpl(new URL("/api/scoreboard", baseUrl), {
    cache: "no-store",
    headers: { accept: "application/json" },
    signal,
  });
  if (!response?.ok) throw new Error(`Reward Sniper scoreboard returned ${response?.status || "an invalid response"}`);
  const rows = await response.json().catch(() => null);
  if (!Array.isArray(rows)) throw new Error("Reward Sniper scoreboard returned invalid JSON");
  const eventId = String(response.headers?.get?.("x-reward-event-id") || "");
  const eventGeneration = String(response.headers?.get?.("x-reward-event-generation") || "");
  const eventStage = String(response.headers?.get?.("x-reward-event-stage") || "");
  const scoringConfigHash = String(response.headers?.get?.("x-reward-scoring-config") || "").toLowerCase();
  const eventStartsAt = String(response.headers?.get?.("x-reward-event-start-at") || "");
  const eventEndsAt = String(response.headers?.get?.("x-reward-event-end-at") || "");
  if (!eventId || (expectedEventId && eventId !== expectedEventId)) {
    throw new Error("Reward Sniper scoreboard belongs to another event");
  }
  if (eventGeneration !== expectedGeneration) {
    throw new Error("Reward Sniper scoreboard belongs to another event generation");
  }
  if (!/^[a-f0-9]{64}$/.test(scoringConfigHash) || (expectedScoringConfigHash && scoringConfigHash !== expectedScoringConfigHash)) {
    throw new Error("Reward Sniper scoreboard uses another scoring configuration");
  }
  if (!new Set(["practice", "live", "complete", "continuous"]).has(eventStage)) {
    throw new Error("Reward Sniper scoreboard stage is invalid");
  }
  if (expectedStartsAt && eventStartsAt !== expectedStartsAt) {
    throw new Error("Reward Sniper scoreboard starts on another event schedule");
  }
  if (expectedEndsAt && eventEndsAt !== expectedEndsAt) {
    throw new Error("Reward Sniper scoreboard ends on another event schedule");
  }
  const participants = new Set();
  for (const row of rows) {
    const participantId = String(row?.participantId || "");
    const score = Number(row?.score);
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(participantId) || !Number.isFinite(score) || participants.has(participantId)) {
      throw new Error("Reward Sniper scoreboard rows are invalid");
    }
    participants.add(participantId);
  }
  if (expectedParticipantIds) {
    const expected = [...expectedParticipantIds].sort();
    const actual = [...participants].sort();
    if (actual.length !== expected.length || actual.some((participantId, index) => participantId !== expected[index])) {
      throw new Error("Reward Sniper scoreboard does not match the checked-in individual field");
    }
  }
  return { eventId, eventGeneration, scoringConfigHash };
}

function expectedCapacityFor(challengeKey, body) {
  if (challengeKey === "evidence-room") return body?.chain?.maxParticipants;
  if (new Set(["after-hours", "player-two", "second-key", "signet", "the-chamber"]).has(challengeKey)) {
    return body?.capacity?.maxParticipants;
  }
  return null;
}

function assertOfficialFieldCoverage(scoring, dependencies, healthResults) {
  if (scoring.scoringMode === "staging") return;
  for (const [index, { challenge }] of dependencies.entries()) {
    const expected = expectedCapacityFor(challenge.key, healthResults[index]);
    if (expected === null) continue;
    if (!Number.isSafeInteger(expected) || expected < scoring.fieldSize) {
      throw new Error(`${challenge.name} capacity does not cover the checked-in individual field`);
    }
  }
  const imprintIndex = dependencies.findIndex(({ challenge }) => challenge.key === "imprint");
  const imprintParticipants = healthResults[imprintIndex]?.participantCount;
  if (!Number.isSafeInteger(imprintParticipants) || imprintParticipants !== scoring.fieldSize) {
    throw new Error("IMPRINT credential inventory does not match the checked-in individual field");
  }
  const signetIndex = dependencies.findIndex(({ challenge }) => challenge.key === "signet");
  const signetInventory = healthResults[signetIndex]?.targetInventory;
  const expectedSignetDigest = crypto.createHash("sha256")
    .update(JSON.stringify([...scoring.checkedInParticipantIds].sort()))
    .digest("hex");
  if (
    !Number.isSafeInteger(signetInventory?.count)
    || signetInventory.count !== scoring.fieldSize
    || signetInventory.participantIdsSha256 !== expectedSignetDigest
  ) {
    throw new Error("SIGNET target inventory does not match the checked-in individual field");
  }
}

function assertIndependentOnChainFunding(dependencies, healthResults) {
  const fundedPayers = new Map();
  for (const [index, { challenge }] of dependencies.entries()) {
    const body = healthResults[index];
    const payer = challenge.key === "evidence-room"
      ? body?.chain?.payer
      : challenge.key === "second-key"
        ? body?.payer
        : challenge.key === "player-two" || challenge.key === "signet" || challenge.key === "the-chamber"
          ? body?.funding?.payer
          : null;
    if (!payer) continue;
    const previous = fundedPayers.get(payer);
    if (previous) {
      throw new Error(`${previous} and ${challenge.name} share one on-chain funding payer`);
    }
    fundedPayers.set(payer, challenge.name);
  }
}

async function probeRewardIntegrity(env, expectedEventId, expectedGeneration, expectedScoringConfigHash, fetchImpl, signal) {
  const baseUrl = productionUrl(env.REWARD_SNIPER_ADMIN_URL, "REWARD_SNIPER_ADMIN_URL");
  const key = required(env.REWARD_SNIPER_ADMIN_KEY, "REWARD_SNIPER_ADMIN_KEY", 32);
  const response = await fetchImpl(new URL("/api/admin/integrity", baseUrl), {
    cache: "no-store",
    headers: {
      accept: "application/json",
      authorization: `Bearer ${key}`,
    },
    signal,
  });
  const body = await readJson(response, "Reward Sniper integrity administration");
  const eventId = String(body.event?.eventId || "");
  const eventGeneration = String(body.event?.eventGeneration || "");
  const scoringConfigHash = String(body.event?.scoringConfigHash || "").toLowerCase();
  if (!eventId || (expectedEventId && eventId !== expectedEventId)) {
    throw new Error("Reward Sniper integrity administration belongs to another event");
  }
  if (eventGeneration !== expectedGeneration) {
    throw new Error("Reward Sniper integrity administration belongs to another event generation");
  }
  if (!/^[a-f0-9]{64}$/.test(scoringConfigHash) || (expectedScoringConfigHash && scoringConfigHash !== expectedScoringConfigHash)) {
    throw new Error("Reward Sniper integrity administration uses another scoring configuration");
  }
  return { eventId, eventGeneration, scoringConfigHash };
}

export async function portalHealth(options = {}) {
  const env = options.env || process.env;
  const redisCommand = options.redisCommand || ((command) => leaderboardRedisCommand(command, { env }));
  const fetchImpl = options.fetchImpl || fetch;

  required(env.CENTRAL_SESSION_SECRET, "CENTRAL_SESSION_SECRET", 32);
  required(env.PARTICIPANT_ID_SECRET, "PARTICIPANT_ID_SECRET", 32);
  required(env.GOOGLE_CLIENT_ID, "GOOGLE_CLIENT_ID");
  required(env.GOOGLE_CLIENT_SECRET, "GOOGLE_CLIENT_SECRET", 24);
  productionUrl(env.CENTRAL_BASE_URL, "CENTRAL_BASE_URL");
  fastSolveReviewSeconds(env);

  const dependencies = CHALLENGES.map((challenge) => {
    const secret = challengeTicketSecret(challenge.audience, env);
    const destination = challengeDestination(challenge, env);
    if (!destination.ticketed || !destination.url) {
      throw new Error(`${challenge.key} has no hosted production destination`);
    }
    return { challenge, destination, secret };
  });

  const roster = participantRoster(env);
  if (!roster && env.NODE_ENV === "production" && env.ALLOW_OPEN_REGISTRATION !== "true") {
    throw new Error("production registration is closed without a participant roster");
  }

  const lifecycleStore = options.lifecycleStore
    || (options.redisCommand ? null : createLeaderboardStore({ env, command: redisCommand }));
  const scoring = lifecycleStore
    ? await resolveLeaderboardConfig({ env, store: lifecycleStore })
    : leaderboardConfig(env);
  const organizers = organizerConfiguration(env);
  if (scoring.scoringMode !== "staging" && !organizers.ready) {
    throw new Error("official readiness requires at least two distinct organizer emails");
  }
  const dependencyTimeout = timeoutMs(env);
  const signal = () => options.signal || AbortSignal.timeout(dependencyTimeout);
  const [pong, healthResults, completionResults, scoreboard, integrity] = await Promise.all([
    within(redisCommand(["PING"]), dependencyTimeout, "Redis health check"),
    Promise.all(dependencies.map(({ challenge, destination }) => (
      probeChallengeHealth(challenge, destination, fetchImpl, signal())
    ))),
    Promise.all(dependencies
      .filter(({ challenge }) => COMPLETION_CHALLENGES.has(challenge.key))
      .map(({ challenge, destination, secret }) => (
        probeCompletion(challenge, destination, secret, scoring.eventGeneration, fetchImpl, signal())
      ))),
    probeRewardScoreboard(
      dependencies.find(({ challenge }) => challenge.key === "reward-sniper").destination.url,
      scoring.rewardEventId,
      scoring.eventGeneration,
      scoring.rewardScoringConfigHash,
      scoring.scoringMode === "staging" ? null : scoring.checkedInParticipantIds,
      scoring.scoringMode === "staging" ? null : scoring.scoringStartAt,
      scoring.scoringMode === "staging" ? null : scoring.scoringEndAt,
      fetchImpl,
      signal(),
    ),
    probeRewardIntegrity(
      env,
      scoring.rewardEventId,
      scoring.eventGeneration,
      scoring.rewardScoringConfigHash,
      fetchImpl,
      signal(),
    ),
  ]);
  if (String(pong).toUpperCase() !== "PONG") throw new Error("Redis health check failed");
  assertIndependentOnChainFunding(dependencies, healthResults);
  assertOfficialFieldCoverage(scoring, dependencies, healthResults);

  const rewardHealth = healthResults[CHALLENGES.findIndex((challenge) => challenge.key === "reward-sniper")];
  const imprintHealth = healthResults[CHALLENGES.findIndex((challenge) => challenge.key === "imprint")];
  for (const [label, body] of [["Reward Sniper", rewardHealth], ["IMPRINT", imprintHealth]]) {
    if (String(body.eventGeneration || "") !== scoring.eventGeneration) {
      throw new Error(`${label} belongs to another event generation`);
    }
  }
  if (scoring.scoringMode !== "staging" && (
    String(rewardHealth.eventStartsAt || "") !== scoring.scoringStartAt
    || String(rewardHealth.eventEndsAt || "") !== scoring.scoringEndAt
  )) {
    throw new Error("Reward Sniper health uses another event schedule");
  }
  if (
    String(rewardHealth.eventId || "") !== scoreboard.eventId
    || scoreboard.eventId !== integrity.eventId
    || String(rewardHealth.scoringConfigHash || "").toLowerCase() !== scoreboard.scoringConfigHash
    || scoreboard.scoringConfigHash !== integrity.scoringConfigHash
  ) {
    throw new Error("Reward Sniper dependencies do not share one event");
  }

  return Object.freeze({
    ok: true,
    challenges: CHALLENGES.length,
    registration: roster ? "roster" : "open-staging",
    storage: "redis",
    scoring: scoring.scoringMode,
    checkedInParticipants: scoring.checkedInParticipantIds.length,
    organizers,
    dependencies: Object.freeze({
      health: healthResults.length,
      completions: completionResults.length,
      rewardScoreboard: "ready",
      rewardIntegrity: "ready",
    }),
  });
}

function healthCacheMs(env) {
  const value = Number(env.PORTAL_HEALTH_CACHE_MS || 15_000);
  if (!Number.isSafeInteger(value) || value < 5_000 || value > 60_000) {
    throw new Error("PORTAL_HEALTH_CACHE_MS must be an integer between 5000 and 60000");
  }
  return value;
}

export async function cachedPortalHealth(options = {}) {
  const env = options.env || process.env;
  const cache = options.cache || sharedHealthCache;
  const now = options.now ?? Date.now();
  if (cache.value && cache.expiresAt > now) return cache.value;
  if (cache.inFlight) return cache.inFlight;
  cache.inFlight = portalHealth(options).then((value) => {
    cache.value = value;
    cache.expiresAt = Date.now() + healthCacheMs(env);
    return value;
  }).finally(() => {
    cache.inFlight = null;
  });
  return cache.inFlight;
}

export function clearPortalHealthCache() {
  sharedHealthCache.value = null;
  sharedHealthCache.expiresAt = 0;
  sharedHealthCache.inFlight = null;
}
