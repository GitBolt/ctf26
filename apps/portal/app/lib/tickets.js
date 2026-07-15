import crypto from "crypto";
import { issueParticipantTicket } from "@ctf26/participant-ticket";

const SESSION_COOKIE = "ctf26_user";
const STATE_COOKIE = "ctf26_oauth_state";
const TICKET_SECRET_ENV = Object.freeze({
  "reward-sniper": "CHALLENGE_TICKET_SECRET_REWARD_SNIPER",
  imprint: "CHALLENGE_TICKET_SECRET_IMPRINT",
  signet: "CHALLENGE_TICKET_SECRET_SILENT_PATCH",
  overclock: "CHALLENGE_TICKET_SECRET_OVERCLOCK",
  "last-stop": "CHALLENGE_TICKET_SECRET_LAST_STOP",
  "after-hours": "CHALLENGE_TICKET_SECRET_AFTER_HOURS",
  "player-two": "CHALLENGE_TICKET_SECRET_PLAYER_TWO",
  "st-genesis-airdrop": "CHALLENGE_TICKET_SECRET_ST_GENESIS_AIRDROP",
});

function secret(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not configured`);
  }
  if (Buffer.byteLength(value) < 32) {
    throw new Error(`${name} must contain at least 32 bytes`);
  }
  return value;
}

export function base64urlJson(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

export function signPayload(payload, key) {
  return crypto.createHmac("sha256", key).update(payload).digest("base64url");
}

export function makeSignedToken(body, key) {
  const payload = base64urlJson(body);
  return `${payload}.${signPayload(payload, key)}`;
}

export function verifySignedToken(token, key) {
  const parts = String(token || "").split(".");
  if (parts.length !== 2) return null;
  const [payload, mac] = parts;
  if (!payload || !mac) return null;

  const expected = signPayload(payload, key);
  if (
    mac.length !== expected.length ||
    !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expected))
  ) {
    return null;
  }

  let body;
  try {
    body = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }

  if (body.exp && Date.now() > Number(body.exp) * 1000) {
    return null;
  }
  return body;
}

export function participantIdForEmail(email) {
  return crypto
    .createHmac("sha256", secret("PARTICIPANT_ID_SECRET"))
    .update(String(email || "").toLowerCase())
    .digest("hex")
    .slice(0, 16);
}

export function createUserSession(user) {
  return makeSignedToken(
    {
      participant_id: user.participant_id,
      team_id: user.team_id || user.participant_id,
      event_id: "ctf26",
      email: user.email,
      name: user.name || user.email,
      picture: user.picture || "",
      exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60,
    },
    secret("CENTRAL_SESSION_SECRET"),
  );
}

export function verifyUserSession(token) {
  return verifySignedToken(token, secret("CENTRAL_SESSION_SECRET"));
}

export function createChallengeTicket(user, audience) {
  const secretEnv = TICKET_SECRET_ENV[audience];
  if (!secretEnv) {
    throw new Error(`unknown challenge audience: ${audience}`);
  }
  return issueParticipantTicket(
    {
      audience,
      eventId: "ctf26",
      participantId: user.participant_id,
      teamId: user.team_id || user.participant_id,
      email: user.email,
    },
    secret(secretEnv),
  );
}

export function createOauthState() {
  return crypto.randomBytes(24).toString("base64url");
}

export { SESSION_COOKIE, STATE_COOKIE };
