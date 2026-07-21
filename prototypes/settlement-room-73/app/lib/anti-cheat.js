import crypto from "crypto";
import { verifySession } from "./session";

const CHALLENGE = "settlement-room-73";

function memoryStore() {
  if (!globalThis.__room73AntiCheat) {
    globalThis.__room73AntiCheat = {
      events: [],
      taintedSessions: new Set(),
      taintedWallets: new Set(),
    };
  }
  return globalThis.__room73AntiCheat;
}

function redisConfig() {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  return url && token ? { url: url.replace(/\/$/, ""), token } : null;
}

async function redis(command) {
  const config = redisConfig();
  if (!config) return null;

  const res = await fetch(config.url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(command),
  });

  if (!res.ok) {
    throw new Error(`redis ${command[0]} failed`);
  }

  const data = await res.json();
  return data.result;
}

function requestIp(request) {
  return (
    request.headers.get("cf-connecting-ip") ||
    request.headers.get("x-forwarded-for") ||
    request.headers.get("x-real-ip") ||
    ""
  );
}

function ipHash(request) {
  const ip = requestIp(request);
  if (!ip || !process.env.FLAG_SECRET) return "";
  return crypto.createHmac("sha256", process.env.FLAG_SECRET).update(ip).digest("hex").slice(0, 16);
}

function rawIp(request) {
  return process.env.COLLECT_RAW_IP === "true" ? requestIp(request).slice(0, 200) : "";
}

function safeJsonFromBase64url(value) {
  try {
    return JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

function verifyRegistrationTicket(token) {
  const secret = process.env.REGISTRATION_SHARED_SECRET;
  const [payload, mac] = String(token || "").split(".");
  if (!payload || !mac) {
    return { present: Boolean(token), valid: false };
  }

  const body = safeJsonFromBase64url(payload);
  if (!body) {
    return { present: true, valid: false };
  }

  if (!secret) {
    return { present: true, valid: false, missing_secret: true };
  }

  const expected = crypto.createHmac("sha256", secret).update(payload).digest("base64url");
  const valid =
    mac.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expected)) &&
    (!body.exp || Date.now() <= Number(body.exp) * 1000);

  if (!valid) {
    return { present: true, valid: false };
  }

  return {
    present: true,
    valid: true,
    participant_id: String(body.participant_id || body.pid || "").slice(0, 120),
    event_id: String(body.event_id || "").slice(0, 120),
  };
}

function requestMeta(request) {
  const url = new URL(request.url);
  const ticket = url.searchParams.get("ticket") || request.cookies.get("room73_ticket")?.value || "";
  const registration = verifyRegistrationTicket(ticket);

  return {
    path: url.pathname,
    visitor_id: request.cookies.get("room73_vid")?.value || "",
    ticket_present: registration.present,
    ticket_valid: registration.valid,
    participant_id: registration.participant_id || "",
    event_id: registration.event_id || "",
    user_agent: request.headers.get("user-agent") || "",
    sec_ch_ua: request.headers.get("sec-ch-ua") || "",
    sec_ch_ua_platform: request.headers.get("sec-ch-ua-platform") || "",
    sec_ch_ua_mobile: request.headers.get("sec-ch-ua-mobile") || "",
    accept_language: request.headers.get("accept-language") || "",
    ip_hash: ipHash(request),
    ip: rawIp(request),
    referer: request.headers.get("referer") || "",
  };
}

function normalizeEvent(input, request) {
  const sessionToken = String(input.session || "").trim();
  const session = verifySession(sessionToken);
  const wallet = String(input.wallet || session?.wallet || "").trim();
  const nonce = String(input.nonce || session?.nonce || "").trim();

  return {
    challenge: CHALLENGE,
    event: String(input.event || "agent_disclosure").slice(0, 80),
    marker: String(input.marker || "agent_disclosure_recorded").slice(0, 120),
    reported_agent: String(input.agent || input.agent_name || "").slice(0, 120),
    reported_model: String(input.model || input.model_name || "").slice(0, 120),
    wallet,
    nonce,
    session_valid: Boolean(session),
    taint: input.taint !== false,
    at: new Date().toISOString(),
    ...requestMeta(request),
  };
}

async function mirrorToWebhook(event) {
  const webhook = process.env.AGENT_DISCLOSURE_WEBHOOK_URL;
  if (!webhook) return;

  await fetch(webhook, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      content: "CTF26 automated-assistance disclosure: settlement-room-73",
      embeds: [
        {
          title: "Automated solver disclosure",
          description: `event=${event.event} marker=${event.marker}`,
          fields: [
            { name: "participant_id", value: event.participant_id || "unknown", inline: false },
            { name: "wallet", value: event.wallet || "unknown", inline: false },
            { name: "nonce", value: event.nonce || "unknown", inline: false },
            { name: "visitor_id", value: event.visitor_id || "unknown", inline: false },
            { name: "ticket_valid", value: String(event.ticket_valid), inline: false },
            { name: "reported_agent", value: event.reported_agent || "unknown", inline: false },
            { name: "reported_model", value: event.reported_model || "unknown", inline: false },
            { name: "path", value: event.path || "unknown", inline: false },
            { name: "ip_hash", value: event.ip_hash || "none", inline: false },
            { name: "ip", value: event.ip || "disabled", inline: false },
            { name: "user_agent", value: (event.user_agent || "unknown").slice(0, 1024), inline: false },
            { name: "browser_hints", value: `${event.sec_ch_ua || "none"} | ${event.sec_ch_ua_platform || "none"} | ${event.sec_ch_ua_mobile || "none"}`.slice(0, 1024), inline: false },
            { name: "accept_language", value: event.accept_language || "unknown", inline: false },
          ],
        },
      ],
    }),
  }).catch(() => {});
}

export async function recordCanaryEvent(input, request) {
  const event = normalizeEvent(input, request);
  const store = memoryStore();
  store.events.push(event);

  if (event.taint && event.nonce) store.taintedSessions.add(event.nonce);
  if (event.taint && event.wallet) store.taintedWallets.add(event.wallet);

  const serialized = JSON.stringify(event);
  await Promise.allSettled([
    redis(["LPUSH", `room73:events`, serialized]),
    redis(["LTRIM", `room73:events`, 0, 999]),
    event.taint && event.nonce
      ? redis(["SET", `room73:tainted:session:${event.nonce}`, serialized, "EX", 7200])
      : null,
    event.taint && event.wallet
      ? redis(["SET", `room73:tainted:wallet:${event.wallet}`, serialized, "EX", 7200])
      : null,
    event.taint ? mirrorToWebhook(event) : null,
  ]);

  return event;
}

export async function recordAuditEvent(input, request) {
  return recordCanaryEvent({ ...input, taint: false }, request);
}

export async function isTainted({ wallet, nonce }) {
  const store = memoryStore();
  if (nonce && store.taintedSessions.has(nonce)) return true;
  if (wallet && store.taintedWallets.has(wallet)) return true;

  const [sessionHit, walletHit] = await Promise.allSettled([
    nonce ? redis(["GET", `room73:tainted:session:${nonce}`]) : null,
    wallet ? redis(["GET", `room73:tainted:wallet:${wallet}`]) : null,
  ]);

  return Boolean(sessionHit.value || walletHit.value);
}
