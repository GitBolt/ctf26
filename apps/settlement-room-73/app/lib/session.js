import crypto from "crypto";

function base64url(input) {
  return Buffer.from(input).toString("base64url");
}

function sign(payload) {
  const secret = process.env.SESSION_SECRET || process.env.FLAG_SECRET;
  if (!secret) {
    throw new Error("SESSION_SECRET or FLAG_SECRET is not configured");
  }
  return crypto.createHmac("sha256", secret).update(payload).digest("base64url");
}

export function createSession(wallet) {
  const body = {
    wallet,
    nonce: crypto.randomBytes(10).toString("hex"),
    exp: Date.now() + 10 * 60 * 1000,
  };
  const payload = base64url(JSON.stringify(body));
  return `${payload}.${sign(payload)}`;
}

export function verifySession(token) {
  const [payload, mac] = String(token || "").split(".");
  if (!payload || !mac || sign(payload) !== mac) {
    return null;
  }
  const body = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  if (!body.wallet || !body.nonce || Date.now() > body.exp) {
    return null;
  }
  return body;
}

