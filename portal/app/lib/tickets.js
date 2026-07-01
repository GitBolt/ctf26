import crypto from "crypto";

const SESSION_COOKIE = "ctf26_user";
const STATE_COOKIE = "ctf26_oauth_state";

function secret(name) {
  const value =
    process.env[name] ||
    process.env.REGISTRATION_SHARED_SECRET ||
    process.env.CENTRAL_SESSION_SECRET;
  if (!value) {
    throw new Error(`${name} is not configured`);
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
  const [payload, mac] = String(token || "").split(".");
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
    .createHmac("sha256", secret("REGISTRATION_SHARED_SECRET"))
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

export function createChallengeTicket(user) {
  return makeSignedToken(
    {
      participant_id: user.participant_id,
      team_id: user.team_id || user.participant_id,
      event_id: "ctf26",
      exp: Math.floor(Date.now() / 1000) + 30 * 60,
    },
    secret("REGISTRATION_SHARED_SECRET"),
  );
}

export function createOauthState() {
  return crypto.randomBytes(24).toString("base64url");
}

export { SESSION_COOKIE, STATE_COOKIE };

