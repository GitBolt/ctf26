import crypto from "crypto";
import { issueParticipantTicket } from "@ctf26/participant-ticket";
import { assertChallengeLaunchAllowed, leaderboardConfig } from "./leaderboard-config.mjs";
import { participantIdForEmail } from "./registration.mjs";

const SESSION_COOKIE = "ctf26_user";
const STATE_COOKIE = "ctf26_oauth_state";
const RULES_COOKIE = "ctf26_rules";
export const RULES_VERSION = "2026-07-21";
const TICKET_SECRET_ENV = Object.freeze({
  "reward-sniper": "CHALLENGE_TICKET_SECRET_REWARD_SNIPER",
  imprint: "CHALLENGE_TICKET_SECRET_IMPRINT",
  signet: "CHALLENGE_TICKET_SECRET_SIGNET",
  drift: "CHALLENGE_TICKET_SECRET_DRIFT",
  "last-stop": "CHALLENGE_TICKET_SECRET_LAST_STOP",
  "after-hours": "CHALLENGE_TICKET_SECRET_AFTER_HOURS",
  "player-two": "CHALLENGE_TICKET_SECRET_PLAYER_TWO",
  "the-broadcast": "CHALLENGE_TICKET_SECRET_THE_BROADCAST",
  "evidence-room": "CHALLENGE_TICKET_SECRET_EVIDENCE_ROOM",
  "second-key": "CHALLENGE_TICKET_SECRET_SECOND_KEY",
});

function secret(name, env = process.env) {
  const value = env[name];
  if (!value) {
    throw new Error(`${name} is not configured`);
  }
  if (Buffer.byteLength(value) < 32) {
    throw new Error(`${name} must contain at least 32 bytes`);
  }
  return value;
}

function activeEventGeneration(env = process.env) {
  return leaderboardConfig(env).eventGeneration;
}

export function challengeTicketSecret(audience, env = process.env) {
  const secretEnv = TICKET_SECRET_ENV[audience];
  if (!secretEnv) throw new Error(`unknown challenge audience: ${audience}`);
  return secret(secretEnv, env);
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

export function createUserSession(user) {
  return makeSignedToken(
    {
      participant_id: user.participant_id,
      event_id: activeEventGeneration(),
      email: user.email,
      name: user.name || user.email,
      leaderboard_name: user.leaderboard_name || user.participant_id,
      picture: user.picture || "",
      exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60,
    },
    secret("CENTRAL_SESSION_SECRET"),
  );
}

export function verifyUserSession(token) {
  const claims = verifySignedToken(token, secret("CENTRAL_SESSION_SECRET"));
  return claims?.event_id === activeEventGeneration() ? claims : null;
}

export function createRulesAcknowledgment(user) {
  return makeSignedToken({
    participant_id: user.participant_id,
    event_id: activeEventGeneration(),
    rules_version: RULES_VERSION,
    exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60,
  }, secret("CENTRAL_SESSION_SECRET"));
}

export function verifyRulesAcknowledgment(token, user) {
  const claims = verifySignedToken(token, secret("CENTRAL_SESSION_SECRET"));
  return Boolean(
    claims
    && claims.participant_id === user?.participant_id
    && claims.event_id === activeEventGeneration()
    && claims.rules_version === RULES_VERSION
  );
}

export function createChallengeTicket(user, audience, options = {}) {
  assertChallengeLaunchAllowed(user?.participant_id, options.env || process.env, options.receivedAt || new Date(), options.config || null);
  return issueParticipantTicket(
    {
      audience,
      eventId: activeEventGeneration(),
      participantId: user.participant_id,
      email: user.email,
    },
    challengeTicketSecret(audience),
  );
}

export function createOauthState() {
  return crypto.randomBytes(24).toString("base64url");
}

export { RULES_COOKIE, SESSION_COOKIE, STATE_COOKIE, participantIdForEmail };
