import crypto from "node:crypto";
import { ParticipantTicketError, verifyParticipantTicket } from "@ctf26/participant-ticket";
import { eventGeneration } from "@ctf26/leaderboard";
import { consumeLaunchJti } from "./redis.mjs";

export const SESSION_COOKIE = "signet_session";
export const TICKET_AUDIENCE = "signet";
const SESSION_TTL_SECONDS = 12 * 60 * 60;
const localJtis = new Set();

export class AuthenticationError extends Error {
  constructor(message = "Your challenge session is missing or expired.") {
    super(message);
    this.name = "AuthenticationError";
    this.statusCode = 401;
    this.publicCode = "session_required";
  }
}

function requireSecret(name, env = process.env) {
  const value = env[name];
  if (!value || Buffer.byteLength(value) < 32) {
    throw new Error(`${name} must contain at least 32 bytes`);
  }
  return value;
}

function sessionSignature(payload, env) {
  return crypto
    .createHmac("sha256", requireSecret("CHALLENGE_SESSION_SECRET", env))
    .update(`signet-session-v1.${payload}`)
    .digest();
}

export function issueSession(identity, { env = process.env, now = Math.floor(Date.now() / 1000) } = {}) {
  const payload = Buffer.from(
    JSON.stringify({
      v: 1,
      eventId: identity.eventId,
      participantId: identity.participantId,
      email: identity.email || "",
      iat: now,
      exp: now + SESSION_TTL_SECONDS,
    }),
  ).toString("base64url");
  const signature = sessionSignature(payload, env).toString("base64url");
  return `v1.${payload}.${signature}`;
}

export function verifySession(token, { env = process.env, now = Math.floor(Date.now() / 1000) } = {}) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3 || parts[0] !== "v1") throw new AuthenticationError();
  const [, payload, signatureText] = parts;
  let actual;
  let body;
  try {
    actual = Buffer.from(signatureText, "base64url");
    body = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    throw new AuthenticationError();
  }
  const expected = sessionSignature(payload, env);
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) {
    throw new AuthenticationError();
  }
  if (
    body.v !== 1 ||
    body.eventId !== eventGeneration(env) ||
    typeof body.participantId !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(body.participantId) ||
    !Number.isSafeInteger(body.iat) ||
    !Number.isSafeInteger(body.exp) ||
    body.exp <= now ||
    body.iat > now + 30 ||
    body.exp - body.iat !== SESSION_TTL_SECONDS
  ) {
    throw new AuthenticationError();
  }
  return Object.freeze({
    eventId: body.eventId,
    participantId: body.participantId,
    email: body.email || "",
  });
}

export async function exchangeLaunchTicket(
  ticket,
  { env = process.env, now = Math.floor(Date.now() / 1000), consumeJti, admitClaims } = {},
) {
  const secret = requireSecret("CHALLENGE_TICKET_SECRET", env);
  const consume = consumeJti || (async (record) => {
    if (env.NODE_ENV !== "production") {
      if (localJtis.has(record.jti)) return false;
      localJtis.add(record.jti);
      return true;
    }
    return consumeLaunchJti(record, { env });
  });
  const claims = verifyParticipantTicket(ticket, secret, {
    audience: TICKET_AUDIENCE,
    eventId: eventGeneration(env),
    now,
  });
  if (typeof admitClaims === "function") await admitClaims(claims);
  const accepted = await consume({
    eventId: claims.event_id,
    audience: claims.aud,
    participantId: claims.participant_id,
    jti: claims.jti,
    expiresAt: claims.exp,
  });
  if (accepted !== true) throw new ParticipantTicketError("replayed", "ticket has already been consumed");
  const identity = {
    eventId: claims.event_id,
    participantId: claims.participant_id,
    email: claims.email || "",
  };
  return { identity, session: issueSession(identity, { env, now }) };
}

export function parseCookies(header) {
  const cookies = {};
  for (const pair of String(header || "").split(";")) {
    const separator = pair.indexOf("=");
    if (separator <= 0) continue;
    try {
      cookies[pair.slice(0, separator).trim()] = decodeURIComponent(pair.slice(separator + 1).trim());
    } catch {
      continue;
    }
  }
  return cookies;
}

export function identityFromRequest(request, { env = process.env } = {}) {
  const cookies = parseCookies(request.headers?.cookie);
  if (cookies[SESSION_COOKIE]) return verifySession(cookies[SESSION_COOKIE], { env });
  if (env.NODE_ENV !== "production" && env.ALLOW_LOCAL_DEMO !== "false") {
    return Object.freeze({ eventId: eventGeneration(env), participantId: "participant-local" });
  }
  throw new AuthenticationError();
}

export function sessionCookie(token, { secure = process.env.NODE_ENV === "production" } = {}) {
  return [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    secure ? "Secure" : "",
    `Max-Age=${SESSION_TTL_SECONDS}`,
  ].filter(Boolean).join("; ");
}
