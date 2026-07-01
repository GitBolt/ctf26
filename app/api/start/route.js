import { PublicKey } from "@solana/web3.js";
import { createSession } from "../../lib/session";

function json(body, status = 200) {
  return Response.json(body, { status });
}

async function verifyTurnstile(token, ip) {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) {
    return true;
  }
  if (!token) {
    return false;
  }

  const form = new FormData();
  form.append("secret", secret);
  form.append("response", token);
  if (ip) {
    form.append("remoteip", ip);
  }

  const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    body: form,
  });
  const data = await res.json();
  return data.success === true;
}

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "bad request" }, 400);
  }

  const wallet = String(body.wallet || "").trim();
  const turnstileToken = String(body.turnstileToken || "").trim();

  try {
    new PublicKey(wallet);
  } catch {
    return json({ error: "bad request" }, 400);
  }

  const ip = request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for") || "";
  const ok = await verifyTurnstile(turnstileToken, ip);
  if (!ok) {
    return json({ error: "human check failed" }, 403);
  }

  const session = createSession(wallet);
  const nonce = JSON.parse(Buffer.from(session.split(".")[0], "base64url").toString("utf8")).nonce;

  return json({
    session,
    nonce,
    ttl_seconds: 600,
    rule: "opens / moves / closes",
  });
}
