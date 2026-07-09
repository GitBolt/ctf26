import crypto from "node:crypto";

export const TICKET_VERSION = "v1";
export const TICKET_ISSUER = "ctf26-portal";
export const TICKET_TYPE = "challenge-launch";
export const DEFAULT_EVENT_ID = "ctf26";
export const DEFAULT_TTL_SECONDS = 5 * 60;
export const MAX_TTL_SECONDS = 10 * 60;

const CLOCK_SKEW_SECONDS = 30;
const ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/;

export class ParticipantTicketError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "ParticipantTicketError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new ParticipantTicketError(code, message);
}

function requireIdentifier(value, field) {
  const normalized = String(value || "");
  if (!ID_PATTERN.test(normalized)) {
    fail("invalid_claim", `${field} is invalid`);
  }
  return normalized;
}

function requireSecret(secret) {
  if (typeof secret !== "string" && !Buffer.isBuffer(secret)) {
    fail("invalid_secret", "ticket secret must be a string or Buffer");
  }
  if (Buffer.byteLength(secret) < 32) {
    fail("invalid_secret", "ticket secret must contain at least 32 bytes");
  }
  return secret;
}

function requireTimestamp(value, field) {
  if (!Number.isSafeInteger(value) || value < 0) {
    fail("invalid_claim", `${field} must be a positive integer timestamp`);
  }
  return value;
}

function encodeJson(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function decodeJson(value) {
  try {
    return JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
  } catch {
    fail("malformed", "ticket payload is not valid base64url JSON");
  }
}

function signatureFor(payload, secret) {
  return crypto
    .createHmac("sha256", requireSecret(secret))
    .update(`${TICKET_VERSION}.${payload}`)
    .digest();
}

function decodeSignature(value) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    fail("malformed", "ticket signature is not valid base64url");
  }
  try {
    return Buffer.from(value, "base64url");
  } catch {
    fail("malformed", "ticket signature is not valid base64url");
  }
}

export function issueParticipantTicket(claims, secret, options = {}) {
  const now = requireTimestamp(
    options.now ?? Math.floor(Date.now() / 1000),
    "now",
  );
  const ttlSeconds = options.ttlSeconds ?? DEFAULT_TTL_SECONDS;
  if (
    !Number.isSafeInteger(ttlSeconds) ||
    ttlSeconds < 1 ||
    ttlSeconds > MAX_TTL_SECONDS
  ) {
    fail(
      "invalid_ttl",
      `ticket TTL must be between 1 and ${MAX_TTL_SECONDS} seconds`,
    );
  }

  const body = {
    iss: TICKET_ISSUER,
    typ: TICKET_TYPE,
    event_id: requireIdentifier(
      claims.eventId || DEFAULT_EVENT_ID,
      "event_id",
    ),
    aud: requireIdentifier(claims.audience, "aud"),
    participant_id: requireIdentifier(
      claims.participantId,
      "participant_id",
    ),
    team_id: requireIdentifier(
      claims.teamId || claims.participantId,
      "team_id",
    ),
    iat: now,
    exp: now + ttlSeconds,
    jti: requireIdentifier(
      options.jti || crypto.randomBytes(18).toString("base64url"),
      "jti",
    ),
  };

  const payload = encodeJson(body);
  const signature = signatureFor(payload, secret).toString("base64url");
  return `${TICKET_VERSION}.${payload}.${signature}`;
}

export function verifyParticipantTicket(token, secret, options = {}) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3 || parts[0] !== TICKET_VERSION) {
    fail("malformed", `ticket must use the ${TICKET_VERSION} format`);
  }

  const [, payload, encodedSignature] = parts;
  if (!payload || !encodedSignature) {
    fail("malformed", "ticket is incomplete");
  }

  const actual = decodeSignature(encodedSignature);
  const expected = signatureFor(payload, secret);
  if (
    actual.length !== expected.length ||
    !crypto.timingSafeEqual(actual, expected)
  ) {
    fail("bad_signature", "ticket signature is invalid");
  }

  const body = decodeJson(payload);
  const now = requireTimestamp(
    options.now ?? Math.floor(Date.now() / 1000),
    "now",
  );
  const maxTtlSeconds = options.maxTtlSeconds ?? MAX_TTL_SECONDS;
  if (
    !Number.isSafeInteger(maxTtlSeconds) ||
    maxTtlSeconds < 1 ||
    maxTtlSeconds > MAX_TTL_SECONDS
  ) {
    fail(
      "invalid_ttl",
      `maximum accepted TTL must be between 1 and ${MAX_TTL_SECONDS} seconds`,
    );
  }

  if (body.iss !== TICKET_ISSUER || body.typ !== TICKET_TYPE) {
    fail("wrong_type", "ticket issuer or type is invalid");
  }
  if (body.event_id !== (options.eventId || DEFAULT_EVENT_ID)) {
    fail("wrong_event", "ticket belongs to another event");
  }
  if (!options.audience || body.aud !== options.audience) {
    fail("wrong_audience", "ticket belongs to another challenge");
  }

  requireIdentifier(body.participant_id, "participant_id");
  requireIdentifier(body.team_id, "team_id");
  requireIdentifier(body.jti, "jti");
  const issuedAt = requireTimestamp(body.iat, "iat");
  const expiresAt = requireTimestamp(body.exp, "exp");

  if (expiresAt <= issuedAt || expiresAt - issuedAt > maxTtlSeconds) {
    fail("invalid_lifetime", "ticket lifetime is invalid");
  }
  if (issuedAt > now + CLOCK_SKEW_SECONDS) {
    fail("not_active", "ticket was issued in the future");
  }
  if (expiresAt <= now) {
    fail("expired", "ticket has expired");
  }

  return Object.freeze({ ...body });
}

export async function consumeParticipantTicket(token, secret, options = {}) {
  if (typeof options.consumeJti !== "function") {
    fail(
      "missing_replay_store",
      "consumeJti must atomically record a previously unseen JTI",
    );
  }

  const claims = verifyParticipantTicket(token, secret, options);
  const accepted = await options.consumeJti({
    eventId: claims.event_id,
    audience: claims.aud,
    participantId: claims.participant_id,
    teamId: claims.team_id,
    jti: claims.jti,
    expiresAt: claims.exp,
  });
  if (accepted !== true) {
    fail("replayed", "ticket has already been consumed");
  }
  return claims;
}
