import crypto from "node:crypto";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { forwardDisclosure, forwardIntegrityEvent, policyFor, publicPolicyFor, verifyMarker } from "@ctf26/agent-integrity";
import { eventGeneration, reportSolveEventBestEffort } from "@ctf26/leaderboard";
import { consumeParticipantTicket, ParticipantTicketError } from "@ctf26/participant-ticket";
import { trustedClientAddress } from "@ctf26/request-budget";
import { DEFAULT_TARGET, canonicalClaimBody, createInstance, parseAndVerifyClaim, recordClaim, verifyPow } from "./protocol.mjs";
import { createStore } from "./store.mjs";

const WEB_ROOT = fileURLToPath(new URL("../web/", import.meta.url));
const STATIC = new Map([["/", ["index.html", "text/html; charset=utf-8"]], ["/app.js", ["app.js", "text/javascript; charset=utf-8"]], ["/style.css", ["style.css", "text/css; charset=utf-8"]]]);
const COOKIE = "the_broadcast_session";
const MAX_BODY = 20 * 1024;
const participantQueues = new Map();

class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
const requireSecret = (value, name, optional = false) => {
  if (optional && !value) return null;
  if (typeof value !== "string" || Buffer.byteLength(value) < 32) throw new Error(`${name} must contain at least 32 bytes`);
  return value;
};

export async function createBroadcastServer(options = {}) {
  const env = options.env || process.env;
  const generation = eventGeneration(env);
  const production = env.NODE_ENV === "production";
  const store = options.store || await createStore(env);
  const ticketSecret = requireSecret(options.ticketSecret ?? env.PARTICIPANT_TICKET_SECRET, "participant ticket secret", !production);
  const sessionSecret = requireSecret(options.sessionSecret ?? env.SESSION_SECRET ?? (production ? null : "dev-broadcast-session-secret-32-bytes"), "session secret");
  const policySecret = requireSecret(options.policySecret ?? env.AGENT_POLICY_SECRET ?? (production ? null : "dev-broadcast-policy-secret-32-bytes!"), "agent policy secret");
  if (production && (options.allowDev === true || env.ALLOW_DEV_LAUNCH === "true")) throw new Error("development launch mode is not allowed in production");
  const allowDev = !production && (options.allowDev ?? (env.ALLOW_DEV_LAUNCH === "true" || !ticketSecret));
  const reportSolve = options.reportSolve || ((identity, sourceId) => reportSolveEventBestEffort({
    url: env.LEADERBOARD_INGEST_URL,
    secret: ticketSecret,
    challenge: "the-broadcast",
    eventId: generation,
    participantId: identity.participantId,
    sourceId,
    timeoutMs: 1_500,
  }));
  const powBits = Number(options.powBits ?? env.POW_BITS ?? 16);
  const powTtlMs = Number(env.POW_TTL_MS || 120_000);
  const rateMax = boundedInteger(env.RATE_LIMIT_MAX, 30, 1, 300, "RATE_LIMIT_MAX");
  const rateWindowMs = boundedInteger(env.RATE_LIMIT_WINDOW_MS, 60_000, 1_000, 3_600_000, "RATE_LIMIT_WINDOW_MS");
  const sessionRateMax = boundedInteger(env.BROADCAST_SESSION_RATE_MAX, 4, 1, 30, "BROADCAST_SESSION_RATE_MAX");
  const powRateMax = boundedInteger(env.BROADCAST_POW_RATE_MAX, 60, 1, 600, "BROADCAST_POW_RATE_MAX");
  const maxActiveClaims = boundedInteger(env.BROADCAST_MAX_ACTIVE_CLAIMS, 32, 1, 128, "BROADCAST_MAX_ACTIVE_CLAIMS");
  const winningVideo = env.BROADCAST_VIDEO_ID || env.BROADCAST_VIDEO_URL || "Zg97oEONXk4";
  const claimTarget = Number(options.claimTarget ?? env.CLAIM_TARGET ?? DEFAULT_TARGET);
  if (!Number.isSafeInteger(claimTarget) || claimTarget < 1 || claimTarget > 15) {
    throw new Error("CLAIM_TARGET must be an integer between 1 and 15");
  }
  const health = cachedProbe(async () => {
    const healthy = typeof store.health === "function" ? await store.health() : true;
    return { status: healthy ? 200 : 503, body: { ok: healthy, challenge: "the-broadcast", store: store.mode } };
  });

  const server = http.createServer((request, response) => handle(request, response).catch((error) => {
    const status = error instanceof HttpError ? error.status : error instanceof ParticipantTicketError ? 401 : 500;
    if (status === 500) console.error(error);
    if (status === 429) response.setHeader("retry-after", String(error.retryAfterSeconds || 60));
    json(response, status, { error: status === 500 ? "internal server error" : error.message });
  }));

  async function handle(request, response) {
    security(response);
    const url = new URL(request.url, "http://the-broadcast.local");
    if (request.method === "GET" && url.pathname === "/health") {
      const result = await health();
      return json(response, result.status, result.body);
    }
    if (request.method === "GET" && new Set(["/robots.txt", "/agents.txt", "/llms.txt", "/.well-known/agents.txt"]).has(url.pathname)) {
      let identity = null;
      try { identity = await authenticate(request, store, sessionSecret); } catch {}
      if (identity) await integrityEvent(identity, "policy-read", "policy", request, "policy");
      const policy = identity
        ? policyFor({ challenge: "the-broadcast", participantId: identity.participantId }, { markerSecret: policySecret, label: "THE BROADCAST" }).text
        : publicPolicyFor({ label: "THE BROADCAST" });
      return text(response, 200, policy);
    }
    if (request.method === "GET" && url.pathname === "/launch") {
      await enforceRate(`launch-ip:${clientAddress(request)}`, 120, 60_000);
      let identity;
      const ticket = url.searchParams.get("ticket");
      if (ticket && ticketSecret) {
        const claims = await consumeParticipantTicket(ticket, ticketSecret, { audience: "the-broadcast", eventId: generation, consumeJti: ({ jti, expiresAt }) => store.consumeTicket(jti, expiresAt) });
        identity = { participantId: claims.participant_id, eventId: claims.event_id };
      } else if (allowDev) {
        const participantId = String(url.searchParams.get("participantId") || "local-player");
        if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(participantId)) throw new HttpError(400, "invalid participant ID");
        identity = { participantId, eventId: generation };
      } else throw new HttpError(401, "a portal launch ticket is required");
      await enforceRate(`launch:${identity.participantId}`, sessionRateMax, 60_000);
      const sessionId = crypto.randomBytes(24).toString("base64url");
      await store.putSession(sessionId, identity);
      await withParticipant(identity.participantId, async () => {
        if (!await store.getInstance(identity.participantId)) await store.putInstance(identity.participantId, createInstance(identity.participantId, { target: claimTarget }));
      });
      await integrityEvent(identity, "interface:launch", "interface", request, "direct-http");
      response.writeHead(303, { location: "/", "set-cookie": cookieFor(sign(sessionId, sessionSecret), env), "cache-control": "no-store", "referrer-policy": "no-referrer" });
      return response.end();
    }
    if (request.method === "GET" && url.pathname === "/api/completion") {
      if (!bearerAuthorized(request, ticketSecret)) throw new HttpError(401, "not authorized");
      const participantId = String(url.searchParams.get("participantId") || "");
      if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(participantId)) throw new HttpError(400, "invalid participant ID");
      const instance = await store.getInstance(participantId);
      return json(response, 200, instance?.completedAt
        ? { completed: true, completedAt: instance.completedAt, eventGeneration: generation }
        : { completed: false, eventGeneration: generation });
    }
    if (request.method === "GET" && url.pathname === "/api/v1/claim") return json(response, 410, { note: "deprecated; v1 replay handling was replaced" });
    if (request.method === "GET" && url.pathname === "/api/debug") return json(response, 200, { token: "eyJhbGciOiJIUzI1NiJ9.eyJzY29wZSI6ImNsYWltOnJlYWQifQ.decoy", scope: "claim:read" });
    if (request.method === "GET" && url.pathname === "/metrics") return text(response, 200, "# TYPE claims_total counter\nclaims_total 9181\n# TYPE claims_rejected_total counter\nclaims_rejected_total 8661\n");

    const identity = await authenticate(request, store, sessionSecret);
    if (request.method === "POST" && url.pathname === "/api/agent-disclosure") {
      const body = await readJson(request);
      if (!verifyMarker({ challenge: "the-broadcast", participantId: identity.participantId }, body.marker, policySecret)) throw new HttpError(400, "invalid disclosure marker");
      const result = await forwardDisclosure({
        identity: { participantId: identity.participantId, eventId: identity.eventId },
        challenge: "the-broadcast",
        label: "THE BROADCAST",
        agent: body.agent,
        model: body.model,
        requestMeta: { source: "the-broadcast-agent-policy", userAgent: String(request.headers["user-agent"] || "") },
      }, env, options.fetchImpl || fetch);
      return json(response, 202, result);
    }
    let instance = await store.getInstance(identity.participantId);
    if (!instance) { instance = createInstance(identity.participantId, { target: claimTarget }); await store.putInstance(identity.participantId, instance); }

    if ((request.method === "GET" || request.method === "HEAD") && STATIC.has(url.pathname)) {
      const [file, type] = STATIC.get(url.pathname);
      if (request.method === "GET") await integrityEvent(identity, `interface:${file}`, "interface", request, "direct-http");
      const body = await fs.readFile(path.join(WEB_ROOT, file));
      response.writeHead(200, { "content-type": type, "cache-control": "no-store" });
      return response.end(request.method === "HEAD" ? undefined : body);
    }
    if (request.method === "GET" && url.pathname === "/api/config") {
      await integrityEvent(identity, "config-read", "activity", request, "direct-http");
      return json(response, 200, { challenge: "The Broadcast", participantId: identity.participantId, message: instance.message, powBits, receiptEncoding: "base58 protocol record", completed: Boolean(instance.completedAt) });
    }
    if (request.method === "POST" && url.pathname === "/api/ui-event") {
      const body = await readJson(request);
      if (!new Set(["page-ready", "automation-present", "wallet-connect", "message-sign", "claim-submit", "receipt-decode"]).has(body.event)) throw new HttpError(400, "unknown UI event");
      await integrityEvent(identity, `ui:${body.event}`, "ui", request, "browser-ui");
      return json(response, 202, { recorded: true });
    }
    if (request.method === "GET" && url.pathname === "/api/pow") {
      await enforceRate(`pow:${identity.participantId}`, powRateMax, 60_000);
      await integrityEvent(identity, "proof-requested", "challenge-action", request, "direct-http");
      const challenge = crypto.randomBytes(12).toString("hex");
      await store.registerPow(challenge, { sessionId: identity.sessionId, bits: powBits, expiresAt: Date.now() + powTtlMs });
      return json(response, 200, { challenge, bits: powBits, binding: "sha256(challenge + ':' + nonce + ':' + sha256(canonical claim JSON))" });
    }
    if (request.method === "POST" && url.pathname === "/api/claim") {
      await enforceRate(`claim:${identity.participantId}`, rateMax, rateWindowMs);
      await integrityEvent(identity, "claim-submitted", "scored-action", request, "direct-http");
      const body = await readJson(request);
      const result = await withExpensiveSlot("claim", identity.participantId, 10_000, maxActiveClaims, async () => {
        try { canonicalClaimBody(body); } catch { throw new HttpError(400, "invalid claim JSON"); }
        const powHeader = String(request.headers["x-pow"] || "");
        const separator = powHeader.indexOf(":");
        if (separator < 1) throw rateError("proof of work required", 1);
        const challenge = powHeader.slice(0, separator);
        const nonce = powHeader.slice(separator + 1);
        const pow = await store.consumePow(challenge);
        if (!pow || pow.sessionId !== identity.sessionId || pow.expiresAt < Date.now()) throw rateError("invalid proof of work", 1);
        if (!verifyPow({ challenge, nonce, body, bits: pow.bits })) throw rateError("insufficient proof of work", 1);
        const allowed = await store.hitRate(`wallet:${identity.participantId}:${String(body.pubkey || "")}`, Date.now(), rateMax, rateWindowMs);
        if (!allowed) throw rateError("wallet rate limit exceeded", Math.ceil(rateWindowMs / 1_000));
        const verified = parseAndVerifyClaim(instance, body);
        if (!verified.ok) throw new HttpError(verified.status, verified.error);
        return withParticipant(identity.participantId, async () => {
          const current = await store.getInstance(identity.participantId);
          if (current.wallet && current.wallet !== verified.pubkey) throw new HttpError(409, "this instance is bound to another wallet");
          const recorded = recordClaim(current, verified, { videoId: winningVideo });
          await store.putInstance(identity.participantId, recorded.instance);
          return recorded;
        });
      });
      if (result.completed) await reportSolve(identity, `the-broadcast:${identity.participantId}`);
      if (result.completed) await integrityEvent(identity, "claim-completed", "completion", request, "direct-http");
      return json(response, 200, { id: result.receipt });
    }
    throw new HttpError(404, "not found");
  }

  async function integrityEvent(identity, action, category, request, source) {
    await forwardIntegrityEvent({ identity, challenge: "the-broadcast", label: "THE BROADCAST", action, category, source, request }, env, options.fetchImpl || fetch)
      .catch((error) => console.warn("THE BROADCAST integrity event deferred", error.message));
  }
  async function enforceRate(key, max, windowMs) {
    if (!await store.hitRate(key, Date.now(), max, windowMs)) throw rateError("too many requests", Math.ceil(windowMs / 1_000));
  }
  async function withExpensiveSlot(scope, participantId, ttlMs, max, operation) {
    if (!await store.acquireSlot(scope, participantId, Date.now(), ttlMs, max)) throw rateError("challenge service is busy; retry shortly", 2);
    try { return await operation(); }
    finally { await store.releaseSlot(scope, participantId); }
  }

  return { server, store, listen(port = 0) { return new Promise((resolve) => server.listen(port, "0.0.0.0", () => resolve(server.address()))); }, close() { return new Promise((resolve, reject) => server.close(async (error) => { await store.close(); error ? reject(error) : resolve(); })); } };
}

async function authenticate(request, store, secret) {
  const raw = parseCookies(request.headers.cookie || "")[COOKIE];
  const sessionId = verify(raw, secret);
  if (!sessionId) throw new HttpError(401, "launch this challenge from the participant portal");
  const identity = await store.getSession(sessionId);
  if (!identity) throw new HttpError(401, "session expired");
  return { ...identity, sessionId };
}
async function withParticipant(participantId, operation) { const previous = participantQueues.get(participantId) || Promise.resolve(); const current = previous.catch(() => {}).then(operation); participantQueues.set(participantId, current); try { return await current; } finally { if (participantQueues.get(participantId) === current) participantQueues.delete(participantId); } }
function boundedInteger(value, fallback, minimum, maximum, name) { const parsed = value === undefined || value === "" ? fallback : Number(value); if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`); return parsed; }
function clientAddress(request) { return trustedClientAddress(request); }
function rateError(message, retryAfterSeconds) { const error = new HttpError(429, message); error.retryAfterSeconds = retryAfterSeconds; return error; }
function withTimeout(promise, timeoutMs, message) { let timer; return Promise.race([Promise.resolve(promise), new Promise((_, reject) => { timer = setTimeout(() => reject(new HttpError(504, message)), timeoutMs); })]).finally(() => clearTimeout(timer)); }
function cachedProbe(probe, ttlMs = 15_000) { let cached = null; let inFlight = null; return async () => { const now = Date.now(); if (cached && cached.expiresAt > now) return cached.value; if (inFlight) return inFlight; inFlight = Promise.resolve().then(probe).then((value) => { cached = { value, expiresAt: Date.now() + ttlMs }; return value; }).finally(() => { inFlight = null; }); return inFlight; }; }
function sign(id, secret) { return `${id}.${crypto.createHmac("sha256", secret).update(id).digest("base64url")}`; }
function verify(value, secret) { const [id, signature, extra] = String(value || "").split("."); if (!id || !signature || extra) return null; const expected = crypto.createHmac("sha256", secret).update(id).digest(); let actual; try { actual = Buffer.from(signature, "base64url"); } catch { return null; } return actual.length === expected.length && crypto.timingSafeEqual(actual, expected) ? id : null; }
function cookieFor(value, env) { return `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=43200${env.NODE_ENV === "production" ? "; Secure" : ""}`; }
function parseCookies(value) { return Object.fromEntries(value.split(";").map((part) => part.trim().split("=")).filter(([key, val]) => key && val)); }
function bearerAuthorized(request, secret) { const supplied = Buffer.from(String(request.headers.authorization || "").replace(/^Bearer /, "")); const expected = Buffer.from(secret); return supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected); }
async function readJson(request) { return withTimeout((async () => { const chunks = []; let size = 0; for await (const chunk of request) { size += chunk.length; if (size > MAX_BODY) throw new HttpError(413, "request too large"); chunks.push(chunk); } try { return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); } catch { throw new HttpError(400, "invalid JSON"); } })(), 5_000, "request body timed out"); }
function security(response) { response.setHeader("content-security-policy", "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"); response.setHeader("x-content-type-options", "nosniff"); response.setHeader("referrer-policy", "no-referrer"); response.setHeader("link", "</agents.txt>; rel=\"ai-policy\", </robots.txt>; rel=\"robots\""); response.setHeader("x-ctf-agent-policy", "/agents.txt"); }
function json(response, status, body) { response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }); response.end(JSON.stringify(body)); }
function text(response, status, body) { response.writeHead(status, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" }); response.end(body); }

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const service = await createBroadcastServer();
  const port = Number(process.env.PORT || 3008);
  await service.listen(port);
  console.log(`The Broadcast listening on ${port}; store=${service.store.mode}`);
}
