import crypto from "node:crypto";
import { verifyParticipantTicket } from "@ctf26/participant-ticket";

export const IMPRINT_SESSION_COOKIE = "imprint_session";
const SESSION_TTL_SECONDS = 12 * 60 * 60;

function secret(env, name) {
  const value = env[name];
  if (typeof value !== "string" || Buffer.byteLength(value) < 32) {
    throw new Error(`${name} must contain at least 32 bytes`);
  }
  return value;
}

function encode(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function decode(value) {
  try {
    return JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
  } catch {
    throw new Error("challenge session is malformed");
  }
}

function mac(payload, key) {
  return crypto.createHmac("sha256", key).update(payload).digest("base64url");
}

export function createChallengeSession(ticket, env = process.env, now = Date.now()) {
  const claims = verifyParticipantTicket(ticket, secret(env, "CHALLENGE_TICKET_SECRET"), {
    audience: "imprint",
  });
  const issuedAt = Math.floor(now / 1000);
  const body = {
    teamId: claims.team_id,
    participantId: claims.participant_id,
    exp: issuedAt + SESSION_TTL_SECONDS,
  };
  const payload = encode(body);
  return `v1.${payload}.${mac(payload, secret(env, "IMPRINT_SESSION_SECRET"))}`;
}

export function verifyChallengeSession(token, env = process.env, now = Date.now()) {
  const [version, payload, signature, ...extra] = String(token || "").split(".");
  if (version !== "v1" || !payload || !signature || extra.length) {
    throw new Error("challenge session is malformed");
  }
  const expected = mac(payload, secret(env, "IMPRINT_SESSION_SECRET"));
  const actualBytes = Buffer.from(signature);
  const expectedBytes = Buffer.from(expected);
  if (
    actualBytes.length !== expectedBytes.length ||
    !crypto.timingSafeEqual(actualBytes, expectedBytes)
  ) {
    throw new Error("challenge session signature is invalid");
  }
  const body = decode(payload);
  if (
    typeof body.teamId !== "string" ||
    typeof body.participantId !== "string" ||
    !Number.isSafeInteger(body.exp) ||
    body.exp <= Math.floor(now / 1000)
  ) {
    throw new Error("challenge session is invalid or expired");
  }
  return Object.freeze(body);
}
