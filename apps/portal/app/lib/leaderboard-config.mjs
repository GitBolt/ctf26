import crypto from "node:crypto";

import {
  BINARY_CHALLENGE_KEYS,
  LEADERBOARD_SCORING_SCHEMA_VERSION,
  MAX_CHALLENGE_POINTS,
  MIN_CHALLENGE_POINTS,
  PRIZE_PLACES,
  TOP_TEN_PRIZE_BOOST,
} from "@ctf26/leaderboard";

import { participantRoster } from "./registration.mjs";
import { fastSolveReviewSeconds } from "./fast-solve.mjs";

function integerSetting(env, name, fallback, { minimum = 1, maximum = 10_000 } = {}) {
  const encoded = String(env[name] ?? "").trim();
  if (!encoded) return fallback;
  const value = Number(encoded);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
  return value;
}

function currencySetting(env, name, fallback) {
  const encoded = String(env[name] ?? "").trim();
  const value = encoded ? Number(encoded) : fallback;
  const cents = Math.round(value * 100);
  if (
    !Number.isFinite(value)
    || value < 0
    || value > 100_000_000
    || !Number.isSafeInteger(cents)
    || Math.abs(cents / 100 - value) > 1e-9
  ) {
    throw new Error(`${name} must be a non-negative dollar amount with at most two decimal places`);
  }
  return value;
}

function timestampSetting(env, name) {
  const encoded = String(env[name] || "").trim();
  if (!encoded) return null;
  const value = new Date(encoded);
  if (Number.isNaN(value.valueOf())) throw new Error(`${name} must be an ISO timestamp`);
  return value.toISOString();
}

function booleanSetting(env, name, fallback = false) {
  const encoded = String(env[name] ?? "").trim().toLowerCase();
  if (!encoded) return fallback;
  if (encoded !== "true" && encoded !== "false") throw new Error(`${name} must be true or false`);
  return encoded === "true";
}

function parseCheckedInOverride(env, roster) {
  const encoded = String(env.LEADERBOARD_CHECKED_IN_PARTICIPANT_IDS || "").trim();
  if (!encoded) return null;
  const rosterParticipants = roster ? new Set([...roster.values()].map((entry) => entry.participantId)) : null;
  let participants;
  try {
    const parsed = JSON.parse(encoded);
    if (!Array.isArray(parsed)) throw new Error("not an array");
    participants = parsed.map((value) => String(value));
  } catch {
    throw new Error("LEADERBOARD_CHECKED_IN_PARTICIPANT_IDS must be a JSON array of participant IDs");
  }
  if (new Set(participants).size !== participants.length || participants.some((participantId) => !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(participantId))) {
    throw new Error("LEADERBOARD_CHECKED_IN_PARTICIPANT_IDS contains an invalid or duplicate participant ID");
  }
  if (rosterParticipants && participants.some((participantId) => !rosterParticipants.has(participantId))) {
    throw new Error("LEADERBOARD_CHECKED_IN_PARTICIPANT_IDS contains a participant outside the roster");
  }
  return Object.freeze([...participants].sort());
}

/**
 * Field size and checked-in IDs come from roster members who accepted the current
 * rules (sign-in required to ack). Optional env list remains an emergency override.
 */
export async function presentField({
  store,
  env = process.env,
  rulesVersion,
} = {}) {
  const roster = participantRoster(env);
  const override = parseCheckedInOverride(env, roster);
  if (override) {
    return Object.freeze({
      checkedInParticipantIds: override,
      fieldSize: override.length,
      source: "env-override",
    });
  }

  const registeredCount = roster
    ? roster.size
    : integerSetting(env, "LEADERBOARD_REGISTERED_COUNT", 50);
  const fieldSizeOverride = String(env.LEADERBOARD_FIELD_SIZE ?? "").trim()
    ? integerSetting(env, "LEADERBOARD_FIELD_SIZE", 1, { minimum: 1, maximum: 500 })
    : null;

  if (store && typeof store.rulesAcknowledgments === "function") {
    const requiredVersion = String(rulesVersion || "").trim();
    if (!requiredVersion) {
      throw new Error("present field resolution requires the active rules version");
    }
    const rosterIds = roster
      ? new Set([...roster.values()].map((entry) => entry.participantId))
      : null;
    const acknowledgments = await store.rulesAcknowledgments();
    const present = [...new Set(
      acknowledgments
        .filter((entry) => String(entry?.rulesVersion || "") === requiredVersion)
        .map((entry) => String(entry?.participantId || ""))
        .filter((participantId) => /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(participantId))
        .filter((participantId) => !rosterIds || rosterIds.has(participantId)),
    )].sort();
    return Object.freeze({
      checkedInParticipantIds: Object.freeze(present),
      fieldSize: Math.min(registeredCount, present.length),
      source: "rules-acknowledgments",
    });
  }

  const fieldSize = Math.min(registeredCount, fieldSizeOverride || registeredCount);
  let checkedInParticipantIds = Object.freeze([]);
  if (roster && fieldSize === roster.size) {
    checkedInParticipantIds = Object.freeze(
      [...roster.values()].map((entry) => entry.participantId).sort(),
    );
  }
  return Object.freeze({
    checkedInParticipantIds,
    fieldSize,
    source: "config",
  });
}

export function scoringConfigHash(input) {
  return crypto.createHash("sha256").update(JSON.stringify({
    scoringSchemaVersion: LEADERBOARD_SCORING_SCHEMA_VERSION,
    scoringRules: {
      binaryChallenges: BINARY_CHALLENGE_KEYS,
      maximumChallengePoints: MAX_CHALLENGE_POINTS,
      minimumChallengePoints: MIN_CHALLENGE_POINTS,
      prizePlaces: PRIZE_PLACES,
      topTenPrizeBoost: TOP_TEN_PRIZE_BOOST,
    },
    eventGeneration: input.eventGeneration,
    scoringStartAt: input.scoringStartAt,
    scoringEndAt: input.scoringEndAt,
    recoveryMinutes: input.recoveryMinutes,
    prizePool: input.prizePool,
    minimumAward: input.minimumAward,
    rewardEventId: input.rewardEventId,
    rewardScoringConfigHash: input.rewardScoringConfigHash,
  })).digest("hex");
}

/**
 * When a scoring window is configured, the wall clock opens/closes live scoring.
 * Organizer freezing/frozen always wins. Recovery is automatic after the end until freeze.
 */
export function clockDerivedScoringMode(config, lifecyclePhase, now = new Date()) {
  const phase = String(lifecyclePhase || config.scoringMode || "staging");
  if (phase === "freezing" || phase === "frozen") return phase;
  // Durable recovery/freeze always wins over the wall clock.
  if (phase === "recovery") return "recovery";
  if (!config.scoringStartAt || !config.scoringEndAt) return phase;

  const start = new Date(config.scoringStartAt);
  const end = new Date(config.scoringEndAt);
  const current = new Date(now);
  if (Number.isNaN(current.valueOf())) return phase;

  // Timed events open and close from the clock without an organizer live flip.
  if (current < start) return phase;
  if (current <= end) return "live";
  return "recovery";
}

export function leaderboardConfig(env = process.env) {
  const roster = participantRoster(env);
  const registeredCount = roster
    ? roster.size
    : integerSetting(env, "LEADERBOARD_REGISTERED_COUNT", 50);

  const override = parseCheckedInOverride(env, roster);
  const fieldSizeOverride = String(env.LEADERBOARD_FIELD_SIZE ?? "").trim()
    ? integerSetting(env, "LEADERBOARD_FIELD_SIZE", 1, { minimum: 1, maximum: 500 })
    : null;
  const fieldSize = override
    ? override.length
    : (fieldSizeOverride || registeredCount);
  if (fieldSize > registeredCount) {
    throw new Error("scoring field size must not exceed the registered participant count");
  }
  let checkedInParticipantIds = override || Object.freeze([]);
  if (!override && roster && fieldSize === roster.size) {
    checkedInParticipantIds = Object.freeze(
      [...roster.values()].map((entry) => entry.participantId).sort(),
    );
  }

  const prizePoolConfigured = String(env.LEADERBOARD_PRIZE_POOL_USD ?? "").trim() !== "";
  const minimumAwardConfigured = String(env.LEADERBOARD_MIN_INDIVIDUAL_AWARD_USD ?? "").trim() !== "";
  const prizePool = currencySetting(env, "LEADERBOARD_PRIZE_POOL_USD", 0);
  const minimumAward = currencySetting(env, "LEADERBOARD_MIN_INDIVIDUAL_AWARD_USD", 0);
  const rawScoringMode = String(env.LEADERBOARD_SCORING_MODE || "").trim().toLowerCase();
  if (env.NODE_ENV === "production" && !rawScoringMode && env.ALLOW_STAGING_SCORING !== "true") {
    throw new Error("production requires an explicit LEADERBOARD_SCORING_MODE");
  }
  const scoringMode = rawScoringMode || "staging";
  if (!["staging", "live", "recovery", "freezing", "frozen"].includes(scoringMode)) {
    throw new Error("LEADERBOARD_SCORING_MODE must be staging, live, recovery, freezing, or frozen");
  }
  if (env.NODE_ENV === "production" && scoringMode === "staging" && env.ALLOW_STAGING_SCORING !== "true") {
    throw new Error("production staging scoring requires ALLOW_STAGING_SCORING=true");
  }
  const launchPaused = booleanSetting(env, "LEADERBOARD_LAUNCH_PAUSED", false);
  const scoringStartAt = timestampSetting(env, "LEADERBOARD_SCORING_START_AT");
  const scoringEndAt = timestampSetting(env, "LEADERBOARD_SCORING_END_AT");
  if (Boolean(scoringStartAt) !== Boolean(scoringEndAt)) {
    throw new Error("LEADERBOARD_SCORING_START_AT and LEADERBOARD_SCORING_END_AT must be set together");
  }
  if (scoringStartAt && new Date(scoringEndAt) <= new Date(scoringStartAt)) {
    throw new Error("LEADERBOARD_SCORING_END_AT must be after LEADERBOARD_SCORING_START_AT");
  }
  if (
    env.NODE_ENV === "production"
    && !scoringStartAt
    && env.ALLOW_STAGING_SCORING !== "true"
  ) {
    throw new Error("production requires LEADERBOARD_SCORING_START_AT and LEADERBOARD_SCORING_END_AT");
  }

  const timedEvent = Boolean(scoringStartAt && scoringEndAt);
  // Timed windows open/close scoring from the clock. They do not by themselves
  // force the full official pin set (Reward event ID, etc.); that still follows
  // the durable/admin scoring mode.
  const officialScoring = scoringMode !== "staging";
  if (officialScoring && (!prizePoolConfigured || !minimumAwardConfigured)) {
    throw new Error("official scoring requires explicit LEADERBOARD_PRIZE_POOL_USD and LEADERBOARD_MIN_INDIVIDUAL_AWARD_USD values");
  }
  // A zero floor is a valid payout policy: every dollar is then distributed by
  // weighted points. It must still be set explicitly so it is never an omission.
  if (officialScoring && prizePool <= 0) {
    throw new Error("official scoring requires a positive prize pool");
  }
  // Funding check uses the whitelist upper bound so a growing live field cannot
  // invalidate a pool that was sized for the full roster.
  if (prizePool > 0 && Math.round(minimumAward * 100) * registeredCount > Math.round(prizePool * 100)) {
    throw new Error("LEADERBOARD_PRIZE_POOL_USD cannot fund the minimum award for every registered participant");
  }
  if (officialScoring && !roster) {
    throw new Error("official scoring requires a participant roster");
  }
  if (officialScoring && !scoringStartAt) {
    throw new Error("official scoring requires an explicit scoring window");
  }
  if (
    env.NODE_ENV === "production"
    && timedEvent
    && !roster
    && env.ALLOW_OPEN_REGISTRATION !== "true"
  ) {
    throw new Error("timed production scoring requires a participant roster");
  }
  const recoveryMinutes = integerSetting(env, "LEADERBOARD_RECOVERY_MINUTES", 30, { minimum: 1, maximum: 240 });
  const eventGeneration = String(env.LEADERBOARD_EVENT_GENERATION || (officialScoring ? "" : "rehearsal")).trim();
  const rewardEventId = String(env.REWARD_SNIPER_EVENT_ID || "").trim();
  const rewardScoringConfigHash = String(env.REWARD_SNIPER_SCORING_CONFIG_HASH || "").trim().toLowerCase();
  const fastSolveSeconds = fastSolveReviewSeconds(env);
  if (officialScoring && !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(eventGeneration)) {
    throw new Error("official scoring requires a stable LEADERBOARD_EVENT_GENERATION");
  }
  if (officialScoring && !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(rewardEventId)) {
    throw new Error("official scoring requires the pinned REWARD_SNIPER_EVENT_ID");
  }
  if (rewardScoringConfigHash && !/^[a-f0-9]{64}$/.test(rewardScoringConfigHash)) {
    throw new Error("REWARD_SNIPER_SCORING_CONFIG_HASH must be a 64-character SHA-256 hash");
  }
  if (officialScoring && !rewardScoringConfigHash) {
    throw new Error("official scoring requires the pinned REWARD_SNIPER_SCORING_CONFIG_HASH");
  }
  const configHash = scoringConfigHash({
    eventGeneration,
    scoringStartAt,
    scoringEndAt,
    recoveryMinutes,
    prizePool,
    minimumAward,
    rewardEventId,
    rewardScoringConfigHash,
  });

  return Object.freeze({
    eventId: "ctf26",
    scoringSchemaVersion: LEADERBOARD_SCORING_SCHEMA_VERSION,
    registeredCount,
    fieldSize,
    prizePool,
    minimumAward,
    prizePoolPublished: prizePool > 0,
    currency: "USD",
    scoringMode,
    launchPaused,
    scoringStartAt,
    scoringEndAt,
    recoveryMinutes,
    checkedInParticipantIds,
    timedEvent,
    eventGeneration,
    rewardEventId,
    rewardScoringConfigHash,
    fastSolveSeconds,
    configHash,
  });
}

export function assertScoreEventAllowed(event, env = process.env, receivedAt = new Date(), activeConfig = null) {
  const config = activeConfig || leaderboardConfig(env);
  if (config.scoringMode === "freezing" || config.scoringMode === "frozen") {
    throw new Error("leaderboard scoring is frozen");
  }
  const timed = Boolean(config.scoringStartAt && config.scoringEndAt);
  if (config.scoringMode === "staging" && !timed) return config;

  if (!config.checkedInParticipantIds.includes(String(event?.participantId || ""))) {
    throw new Error("score event participant is not checked in");
  }
  const occurredAt = new Date(String(event?.occurredAt || ""));
  if (Number.isNaN(occurredAt.valueOf())) throw new Error("score event time is invalid");
  const received = new Date(receivedAt);
  if (Number.isNaN(received.valueOf())) throw new Error("score event receipt time is invalid");
  const start = new Date(config.scoringStartAt);
  const end = new Date(config.scoringEndAt);
  if (occurredAt < start || occurredAt > end) throw new Error("score event is outside the scoring window");
  if (received < new Date(start.valueOf() - 90_000) || occurredAt > new Date(received.valueOf() + 90_000)) {
    throw new Error("score event timing is inconsistent with the active scoring window");
  }
  const recoveryEnd = new Date(end.valueOf() + config.recoveryMinutes * 60_000);
  if (config.scoringMode === "live" && received > end) {
    throw new Error("live scoring has ended; switch explicitly to recovery for signed retries");
  }
  if (received > recoveryEnd) throw new Error("score event recovery window is closed");
  return config;
}

export class ChallengeLaunchError extends Error {
  constructor(status, message) {
    super(message);
    this.name = "ChallengeLaunchError";
    this.status = status;
  }
}

export function assertChallengeLaunchAllowed(participantId, env = process.env, receivedAt = new Date(), activeConfig = null) {
  const config = activeConfig || leaderboardConfig(env);
  if (config.launchPaused) {
    throw new ChallengeLaunchError(503, "Challenge launches are temporarily paused by the organizers.");
  }
  const timed = Boolean(config.scoringStartAt && config.scoringEndAt);
  if (config.scoringMode === "staging" && !timed) return config;
  if (config.scoringMode !== "live") {
    throw new ChallengeLaunchError(409, "New challenge sessions are closed outside live scoring.");
  }
  const identity = String(participantId || "");
  if (!config.checkedInParticipantIds.includes(identity)) {
    throw new ChallengeLaunchError(403, "This participant is not checked in for the active field.");
  }
  const received = new Date(receivedAt);
  if (Number.isNaN(received.valueOf())) throw new Error("challenge launch time is invalid");
  const start = new Date(config.scoringStartAt);
  const end = new Date(config.scoringEndAt);
  if (received < start || received > end) {
    throw new ChallengeLaunchError(409, "Challenge access opens only during the official scoring window.");
  }
  return config;
}

export function leaderboardIngestUrl(env = process.env) {
  const configured = String(env.LEADERBOARD_INGEST_URL || "").trim();
  if (!configured) return "";
  const url = new URL(configured);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error("LEADERBOARD_INGEST_URL must be an HTTP(S) URL without credentials");
  }
  return url.toString();
}
