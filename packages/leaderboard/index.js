import crypto from "node:crypto";

export const LEADERBOARD_EVENT_ID = "ctf26";
export const SCORE_EVENT_VERSION = 1;
export const MAX_CHALLENGE_POINTS = 1_000;
export const MIN_CHALLENGE_POINTS = 250;
export const PRIZE_PLACES = 10;
export const TOP_TEN_PRIZE_BOOST = 0.1;
export const MINIMUM_INDIVIDUAL_AWARD_USD = 0;
export const LEADERBOARD_SCORING_SCHEMA_VERSION = "ctf26-scoring-v4";
export const BINARY_CHALLENGE_KEYS = Object.freeze([
  "imprint",
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
export const PERFORMANCE_CHALLENGE_KEY = "reward-sniper";
export const ALL_CHALLENGE_KEYS = Object.freeze([
  PERFORMANCE_CHALLENGE_KEY,
  ...BINARY_CHALLENGE_KEYS,
]);

const CHALLENGE_SET = new Set(ALL_CHALLENGE_KEYS);
const BINARY_CHALLENGE_SET = new Set(BINARY_CHALLENGE_KEYS);
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const EVENT_GENERATION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const SOURCE_ID_PATTERN = /^[\x21-\x7e]{1,256}$/;
const MAX_CLOCK_SKEW_SECONDS = 90;

export class LeaderboardError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "LeaderboardError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new LeaderboardError(code, message);
}

/**
 * Names one isolated run of the event. Challenge services use the same value in
 * their persistent state keys and the portal uses it when recovering solves.
 */
export function eventGeneration(env = process.env) {
  const configured = String(env.CTF_EVENT_GENERATION || "").trim();
  if (!configured) {
    if (env.NODE_ENV === "production") {
      throw new Error("CTF_EVENT_GENERATION is required in production");
    }
    return "rehearsal";
  }
  if (!EVENT_GENERATION_PATTERN.test(configured)) {
    throw new Error("CTF_EVENT_GENERATION is invalid");
  }
  return configured;
}

function finiteNumber(value, field) {
  const number = Number(value);
  if (!Number.isFinite(number)) fail("invalid_value", `${field} must be a finite number`);
  return number;
}

function positiveInteger(value, field) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) {
    fail("invalid_value", `${field} must be a positive integer`);
  }
  return number;
}

function identifier(value, field) {
  const normalized = String(value || "");
  if (!ID_PATTERN.test(normalized)) fail("invalid_value", `${field} is invalid`);
  return normalized;
}

function challengeKey(value, binaryOnly = false) {
  const normalized = String(value || "");
  const allowed = binaryOnly ? BINARY_CHALLENGE_SET : CHALLENGE_SET;
  if (!allowed.has(normalized)) fail("invalid_challenge", "challenge is not part of this event");
  return normalized;
}

function hmacSecret(secret) {
  if ((typeof secret !== "string" && !Buffer.isBuffer(secret)) || Buffer.byteLength(secret) < 32) {
    fail("invalid_secret", "score event secret must contain at least 32 bytes");
  }
  return secret;
}

function timingSafeEqualText(left, right) {
  const leftBytes = Buffer.from(String(left || ""));
  const rightBytes = Buffer.from(String(right || ""));
  return leftBytes.length === rightBytes.length && crypto.timingSafeEqual(leftBytes, rightBytes);
}

function roundTo(value, increment) {
  return Math.round(value / increment) * increment;
}

function currencyCents(value, field) {
  const cents = Math.round(finiteNumber(value, field) * 100);
  if (!Number.isSafeInteger(cents) || Math.abs(cents / 100 - Number(value)) > 1e-9) {
    fail("invalid_value", `${field} must be a safe dollar amount with at most two decimal places`);
  }
  return cents;
}

/**
 * An information-content curve. A solve by one entrant is worth the cap, a solve by the
 * whole checked-in field is worth the floor, and every solver receives the same current value.
 */
export function dynamicSolveValue({
  solveCount,
  fieldSize,
  maximum = MAX_CHALLENGE_POINTS,
  minimum = MIN_CHALLENGE_POINTS,
  increment = 10,
}) {
  const field = positiveInteger(fieldSize, "field size");
  if (field < 2) fail("invalid_value", "field size must be at least 2");
  const solves = Number(solveCount);
  if (!Number.isSafeInteger(solves) || solves < 0 || solves > field) {
    fail("invalid_value", "solve count must be an integer within the field");
  }
  const max = finiteNumber(maximum, "maximum points");
  const min = finiteNumber(minimum, "minimum points");
  const step = positiveInteger(increment, "point increment");
  if (min < 0 || max <= min) fail("invalid_value", "point bounds are invalid");
  if (solves === 0) return max;

  const information = Math.log(field / solves) / Math.log(field);
  return Math.min(max, Math.max(min, roundTo(min + (max - min) * information, step)));
}

/** Reward Sniper already measures quality continuously, so it is normalized directly to the leader. */
export function relativePerformanceValue({
  score,
  leaderScore,
  maximum = MAX_CHALLENGE_POINTS,
}) {
  const performance = finiteNumber(score, "performance score");
  const leader = finiteNumber(leaderScore, "leader score");
  const max = finiteNumber(maximum, "maximum points");
  if (max <= 0) fail("invalid_value", "maximum points must be positive");
  if (performance <= 0 || leader <= 0) return 0;
  return Math.max(1, Math.round(max * Math.min(1, performance / leader)));
}

function canonicalParticipantId(record) {
  return identifier(record?.participantId ?? record?.participant_id, "participant ID");
}

function normalizeProfile(profile) {
  const participantId = canonicalParticipantId(profile, "profile");
  const displayName = String(profile.displayName || participantId).trim().slice(0, 80) || participantId;
  return Object.freeze({ participantId, displayName });
}

function normalizeSolve(solve) {
  return Object.freeze({
    challenge: challengeKey(solve.challenge, true),
    participantId: canonicalParticipantId(solve, "solve event"),
    solvedAt: String(solve.solvedAt || ""),
  });
}

function normalizePerformance(row) {
  return Object.freeze({
    participantId: canonicalParticipantId(row, "performance row"),
    score: Math.max(0, finiteNumber(row.score, "performance score")),
  });
}

function prizeWeights(
  rows,
  prizePool,
  prizePlaces = PRIZE_PLACES,
  minimumAward = MINIMUM_INDIVIDUAL_AWARD_USD,
) {
  const eligible = rows.filter((row) => row.points > 0);
  const poolCents = currencyCents(prizePool, "prize pool");
  const floorCents = currencyCents(minimumAward, "minimum individual award");
  if (floorCents < 0) fail("invalid_value", "minimum individual award must not be negative");
  if (eligible.length === 0 || poolCents === 0) return new Map();
  if (poolCents < eligible.length * floorCents) {
    fail("invalid_value", "prize pool cannot fund the minimum award for every scoring participant");
  }

  const weightedPoints = (row) => row.points * (
    row.rank && row.rank <= prizePlaces ? Math.round(10 * (1 + TOP_TEN_PRIZE_BOOST)) : 10
  );
  const denominator = BigInt(eligible.reduce((sum, row) => sum + weightedPoints(row), 0));
  const distributableCents = poolCents - eligible.length * floorCents;
  const allocations = eligible.map((row) => {
    const numerator = BigInt(distributableCents) * BigInt(weightedPoints(row));
    return {
      row,
      cents: floorCents + Number(numerator / denominator),
      remainder: numerator % denominator,
    };
  });
  let remaining = poolCents - allocations.reduce((sum, allocation) => sum + allocation.cents, 0);
  allocations.sort((left, right) => (
    left.remainder === right.remainder
      ? left.row.participantId.localeCompare(right.row.participantId)
      : left.remainder > right.remainder ? -1 : 1
  ));
  for (let index = 0; index < remaining; index += 1) allocations[index].cents += 1;

  const byParticipant = new Map();
  for (const allocation of allocations) byParticipant.set(allocation.row.participantId, allocation.cents);
  return byParticipant;
}

/**
 * Produces an auditable snapshot. Rank is based only on total points. Time is deliberately not a
 * tiebreaker. Every scoring entrant shares the pool by points, with a small top-ten boost.
 */
export function calculateLeaderboard({
  profiles = [],
  solves = [],
  performance = [],
  fieldSize,
  prizePool = 0,
  minimumAward = MINIMUM_INDIVIDUAL_AWARD_USD,
}) {
  const field = positiveInteger(fieldSize, "field size");
  const pool = finiteNumber(prizePool, "prize pool");
  if (pool < 0) fail("invalid_value", "prize pool must not be negative");
  currencyCents(pool, "prize pool");
  const minimum = finiteNumber(minimumAward, "minimum individual award");
  if (minimum < 0) fail("invalid_value", "minimum individual award must not be negative");
  currencyCents(minimum, "minimum individual award");

  const profileByParticipant = new Map(profiles.map((profile) => {
    const normalized = normalizeProfile(profile);
    return [normalized.participantId, normalized];
  }));

  const solveByChallenge = new Map(BINARY_CHALLENGE_KEYS.map((key) => [key, new Map()]));
  for (const rawSolve of solves) {
    const solve = normalizeSolve(rawSolve);
    solveByChallenge.get(solve.challenge).set(solve.participantId, solve);
  }

  const performanceByParticipant = new Map();
  for (const rawRow of performance) {
    const row = normalizePerformance(rawRow);
    performanceByParticipant.set(row.participantId, row.score);
  }
  const leaderScore = Math.max(0, ...performanceByParticipant.values());

  const challengeValues = Object.fromEntries(BINARY_CHALLENGE_KEYS.map((key) => {
    const solveCount = solveByChallenge.get(key).size;
    return [key, Object.freeze({
      solveCount,
      points: dynamicSolveValue({ solveCount, fieldSize: field }),
    })];
  }));

  const participantIds = new Set(profileByParticipant.keys());
  for (const challengeSolves of solveByChallenge.values()) {
    for (const participantId of challengeSolves.keys()) participantIds.add(participantId);
  }
  for (const participantId of performanceByParticipant.keys()) participantIds.add(participantId);

  const rows = [...participantIds].map((participantId) => {
    const breakdown = {};
    let binaryPoints = 0;
    let solveCount = 0;
    for (const key of BINARY_CHALLENGE_KEYS) {
      const solved = solveByChallenge.get(key).has(participantId);
      const points = solved ? challengeValues[key].points : 0;
      breakdown[key] = Object.freeze({ solved, points });
      if (solved) {
        solveCount += 1;
        binaryPoints += points;
      }
    }
    const marketScore = performanceByParticipant.get(participantId) || 0;
    const marketPoints = relativePerformanceValue({ score: marketScore, leaderScore });
    breakdown[PERFORMANCE_CHALLENGE_KEY] = Object.freeze({
      score: marketScore,
      points: marketPoints,
      relativeToLeader: leaderScore > 0 ? marketScore / leaderScore : 0,
    });
    const profile = profileByParticipant.get(participantId);
    return {
      participantId,
      displayName: profile?.displayName || participantId,
      points: binaryPoints + marketPoints,
      solveCount,
      activeChallengeCount: solveCount + (marketScore > 0 ? 1 : 0),
      breakdown: Object.freeze(breakdown),
      rank: null,
      projectedPrizeCents: 0,
      projectedPrize: 0,
    };
  }).sort((left, right) => (
    right.points - left.points ||
    left.displayName.localeCompare(right.displayName) ||
    left.participantId.localeCompare(right.participantId)
  ));

  let currentRank = 0;
  let previousPoints = null;
  for (let index = 0; index < rows.length; index += 1) {
    if (rows[index].points <= 0) continue;
    if (rows[index].points !== previousPoints) currentRank = index + 1;
    rows[index].rank = currentRank;
    previousPoints = rows[index].points;
  }

  const prizes = prizeWeights(rows, pool, PRIZE_PLACES, minimum);
  for (const row of rows) {
    row.projectedPrizeCents = prizes.get(row.participantId) || 0;
    row.projectedPrize = row.projectedPrizeCents / 100;
  }

  return Object.freeze({
    fieldSize: field,
    prizePool: pool,
    minimumAward: minimum,
    scoringEntrants: rows.filter((row) => row.points > 0).length,
    leaderPerformanceScore: leaderScore,
    challengeValues: Object.freeze(challengeValues),
    rows: Object.freeze(rows.map((row) => Object.freeze(row))),
  });
}

export function createSolveEvent({
  challenge,
  participantId,
  sourceId,
  occurredAt = new Date().toISOString(),
  eventId = LEADERBOARD_EVENT_ID,
}) {
  const timestamp = new Date(occurredAt);
  if (Number.isNaN(timestamp.valueOf())) fail("invalid_value", "occurredAt must be an ISO timestamp");
  const source = String(sourceId || "");
  if (!SOURCE_ID_PATTERN.test(source)) fail("invalid_value", "source ID is invalid");
  return Object.freeze({
    version: SCORE_EVENT_VERSION,
    eventId: identifier(eventId, "event ID"),
    kind: "solve",
    challenge: challengeKey(challenge, true),
    participantId: canonicalParticipantId({ participantId }),
    sourceId: source,
    occurredAt: timestamp.toISOString(),
  });
}

export function signScoreEventBody(rawBody, secret, timestamp = Math.floor(Date.now() / 1_000)) {
  if (!Number.isSafeInteger(timestamp) || timestamp < 0) fail("invalid_value", "signature timestamp is invalid");
  return crypto
    .createHmac("sha256", hmacSecret(secret))
    .update(`${timestamp}.${String(rawBody)}`)
    .digest("base64url");
}

export function verifySolveEventRequest({
  rawBody,
  timestamp,
  signature,
  secret,
  now = Math.floor(Date.now() / 1_000),
  eventId = LEADERBOARD_EVENT_ID,
}) {
  const signedAt = Number(timestamp);
  if (!Number.isSafeInteger(signedAt) || Math.abs(now - signedAt) > MAX_CLOCK_SKEW_SECONDS) {
    fail("stale_signature", "score event signature is outside the accepted clock window");
  }
  const expected = signScoreEventBody(rawBody, secret, signedAt);
  if (!timingSafeEqualText(signature, expected)) fail("bad_signature", "score event signature is invalid");

  let parsed;
  try {
    parsed = JSON.parse(String(rawBody));
  } catch {
    fail("malformed", "score event body is not valid JSON");
  }
  if (parsed?.version !== SCORE_EVENT_VERSION || parsed?.kind !== "solve") {
    fail("malformed", "score event version or kind is invalid");
  }
  if (parsed?.eventId !== eventId) fail("wrong_event", "score event belongs to another event");
  return createSolveEvent(parsed);
}

export async function reportSolveEvent({
  url,
  secret,
  fetchImpl = fetch,
  timeoutMs = 5_000,
  ...claims
}) {
  const endpoint = String(url || "").trim();
  if (!endpoint) return Object.freeze({ reported: false, reason: "not_configured" });
  const parsedUrl = new URL(endpoint);
  if (!['http:', 'https:'].includes(parsedUrl.protocol) || parsedUrl.username || parsedUrl.password) {
    fail("invalid_url", "leaderboard ingest URL must be an HTTP(S) URL without credentials");
  }
  const event = createSolveEvent(claims);
  const body = JSON.stringify(event);
  const timestamp = Math.floor(Date.now() / 1_000);
  const response = await fetchImpl(parsedUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-ctf-challenge": event.challenge,
      "x-ctf-timestamp": String(timestamp),
      "x-ctf-signature": signScoreEventBody(body, secret, timestamp),
    },
    body,
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) fail("report_failed", `leaderboard ingest returned ${response.status}`);
  return Object.freeze({ reported: true, status: response.status });
}

/** A verified solve must never be revoked just because the display service is briefly unavailable. */
export async function reportSolveEventBestEffort(options) {
  const attempts = Number.isSafeInteger(options?.attempts) ? Math.max(1, Math.min(5, options.attempts)) : 3;
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await reportSolveEvent(options);
    } catch (error) {
      lastError = error;
      if (["invalid_url", "invalid_secret", "invalid_value", "invalid_challenge"].includes(error?.code)) break;
      if (attempt + 1 < attempts) {
        await new Promise((resolve) => setTimeout(resolve, 120 * 2 ** attempt));
      }
    }
  }
  const logger = options?.logger || console;
  logger.error?.("leaderboard solve report failed", {
    challenge: options?.challenge,
    participantId: options?.participantId,
    error: lastError?.message || String(lastError),
  });
  return Object.freeze({ reported: false, reason: "delivery_failed" });
}
