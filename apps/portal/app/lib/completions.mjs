import { createSolveEvent } from "@ctf26/leaderboard";

import { assertScoreEventAllowed, leaderboardConfig } from "./leaderboard-config.mjs";
import { evaluateFastSolveReview } from "./fast-solve-delivery.mjs";

const PARTICIPANT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

function requiredSecret(env, name, label) {
  const secret = String(env[name] || "");
  if (Buffer.byteLength(secret) < 32) {
    throw new Error(`${label} completion status is not configured`);
  }
  return secret;
}

function completionUrl(env, participantId, urlEnv) {
  const configured = String(env[urlEnv] || "").trim();
  if (!configured) throw new Error(`${urlEnv} is not configured`);
  const url = new URL("/api/completion", configured);
  url.searchParams.set("participantId", participantId);
  return url;
}

async function challengeCompletion(user, definition, options = {}) {
  const env = options.env || process.env;
  const fetchImpl = options.fetchImpl || fetch;
  const participantId = String(user?.participant_id || "");
  if (!PARTICIPANT_ID_PATTERN.test(participantId)) throw new Error("invalid participant ID");

  const response = await fetchImpl(completionUrl(env, participantId, definition.urlEnv), {
    cache: "no-store",
    headers: {
      accept: "application/json",
      authorization: `Bearer ${requiredSecret(env, definition.secretEnv, definition.label)}`,
    },
    signal: options.signal || AbortSignal.timeout(2_500),
  });
  if (!response.ok) throw new Error(`${definition.label} completion service returned ${response.status}`);
  const result = await response.json();
  if (result?.completed !== true) return null;
  return Object.freeze({
    challenge: definition.challenge,
    completedAt: String(result.completedAt || ""),
    eventGeneration: String(result.eventGeneration || ""),
  });
}

export function completionMatchesEvent(completion, eventGeneration) {
  const generation = String(eventGeneration || "");
  return Boolean(completion && generation && completion.eventGeneration === generation);
}

export function completedChallengeKeys({ completions = [], solves = [], participantId, eventGeneration }) {
  const generation = String(eventGeneration || "");
  const identity = String(participantId || "");
  if (!generation || !PARTICIPANT_ID_PATTERN.test(identity)) return new Set();
  const completed = new Set(solves
    .filter((solve) => solve?.participantId === identity && solve?.eventId === generation)
    .map((solve) => String(solve.challenge || ""))
    .filter(Boolean));
  for (const completion of completions) {
    if (completionMatchesEvent(completion, generation)) completed.add(completion.challenge);
  }
  return completed;
}

export function signetCompletion(user, options = {}) {
  return challengeCompletion(user, {
    challenge: "signet",
    label: "SIGNET",
    urlEnv: "SIGNET_URL",
    secretEnv: "CHALLENGE_TICKET_SECRET_SIGNET",
  }, options);
}

export function driftCompletion(user, options = {}) {
  return challengeCompletion(user, {
    challenge: "drift",
    label: "DRIFT",
    urlEnv: "DRIFT_URL",
    secretEnv: "CHALLENGE_TICKET_SECRET_DRIFT",
  }, options);
}

export function lastStopCompletion(user, options = {}) {
  return challengeCompletion(user, {
    challenge: "last-stop",
    label: "LAST STOP",
    urlEnv: "LAST_STOP_URL",
    secretEnv: "CHALLENGE_TICKET_SECRET_LAST_STOP",
  }, options);
}

export function broadcastCompletion(user, options = {}) {
  return challengeCompletion(user, {
    challenge: "the-broadcast",
    label: "THE BROADCAST",
    urlEnv: "THE_BROADCAST_URL",
    secretEnv: "CHALLENGE_TICKET_SECRET_THE_BROADCAST",
  }, options);
}

export function playerTwoCompletion(user, options = {}) {
  return challengeCompletion(user, {
    challenge: "player-two",
    label: "PLAYER TWO",
    urlEnv: "PLAYER_TWO_URL",
    secretEnv: "CHALLENGE_TICKET_SECRET_PLAYER_TWO",
  }, options);
}

export function afterHoursCompletion(user, options = {}) {
  return challengeCompletion(user, {
    challenge: "after-hours",
    label: "AFTER HOURS",
    urlEnv: "AFTER_HOURS_URL",
    secretEnv: "CHALLENGE_TICKET_SECRET_AFTER_HOURS",
  }, options);
}

export function evidenceRoomCompletion(user, options = {}) {
  return challengeCompletion(user, {
    challenge: "evidence-room",
    label: "EVIDENCE ROOM",
    urlEnv: "EVIDENCE_ROOM_URL",
    secretEnv: "CHALLENGE_TICKET_SECRET_EVIDENCE_ROOM",
  }, options);
}

export function secondKeyCompletion(user, options = {}) {
  return challengeCompletion(user, {
    challenge: "second-key",
    label: "SECOND KEY",
    urlEnv: "SECOND_KEY_URL",
    secretEnv: "CHALLENGE_TICKET_SECRET_SECOND_KEY",
  }, options);
}

export async function recoverLeaderboardCompletions(user, completions, store, options = {}) {
  const participantId = String(user?.participant_id || "");
  if (!PARTICIPANT_ID_PATTERN.test(participantId)) {
    throw new Error("invalid leaderboard recovery identity");
  }
  const recovered = [];
  const config = options.config || leaderboardConfig(options.env || process.env);
  if (typeof store.assertEventConfig === "function") await store.assertEventConfig(config.configHash);
  for (const completion of completions.filter(Boolean)) {
    if (!config.eventGeneration || completion.eventGeneration !== config.eventGeneration) continue;
    const completedAt = new Date(completion.completedAt);
    const event = createSolveEvent({
      challenge: completion.challenge,
      eventId: config.eventGeneration,
      participantId,
      sourceId: `completion-recovery:${completion.challenge}:${participantId}`,
      occurredAt: Number.isNaN(completedAt.valueOf()) ? new Date().toISOString() : completedAt.toISOString(),
    });
    try {
      assertScoreEventAllowed(event, options.env || process.env, options.receivedAt || new Date(), config);
    } catch {
      continue;
    }
    await evaluateFastSolveReview({
      store,
      event,
      eventGeneration: config.eventGeneration,
      env: options.env || process.env,
      fetchImpl: options.fetchImpl || fetch,
      logger: options.logger || console,
    });
    const created = await store.recordSolve(event);
    if (created) recovered.push(event.challenge);
  }
  return Object.freeze(recovered);
}
