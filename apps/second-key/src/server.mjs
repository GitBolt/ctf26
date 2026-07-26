import crypto from "node:crypto";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { consumeParticipantTicket, ParticipantTicketError, verifyParticipantTicket } from "@ctf26/participant-ticket";
import { forwardDisclosure, forwardIntegrityEvent, policyFor, publicPolicyFor, verifyMarker } from "@ctf26/agent-integrity";
import { eventGeneration, reportSolveEventBestEffort } from "@ctf26/leaderboard";
import { trustedClientAddress } from "@ctf26/request-budget";

import { createSecondKeyChain } from "./chain.mjs";
import { createStore } from "./store.mjs";

const WEB = fileURLToPath(new URL("../web/", import.meta.url));
const STATIC = new Map([["/", ["index.html", "text/html; charset=utf-8"]], ["/app.js", ["app.js", "text/javascript; charset=utf-8"]], ["/style.css", ["style.css", "text/css; charset=utf-8"]]]);
const COOKIE = "second_key_session";
const MAX_BODY = 16 * 1024;
const policyPaths = new Set(["/robots.txt", "/agents.txt", "/llms.txt", "/.well-known/agents.txt"]);
const participantQueues = new Map();

class HttpError extends Error {
  constructor(status, message, retryAfter = null) {
    super(message);
    this.status = status;
    if (retryAfter) this.retryAfter = retryAfter;
  }
}

export async function createSecondKeyServer(options = {}) {
  const env = options.env || process.env;
  const generation = eventGeneration(env);
  const production = env.NODE_ENV === "production";
  const store = options.store || await createStore(env);
  const chain = options.chain || createSecondKeyChain(env);
  const ticketSecret = required(options.ticketSecret ?? env.PARTICIPANT_TICKET_SECRET, "PARTICIPANT_TICKET_SECRET", !production);
  const sessionSecret = required(options.sessionSecret ?? env.SESSION_SECRET ?? (production ? null : "development-second-key-session-secret"), "SESSION_SECRET");
  const completionSecret = required(options.completionSecret ?? env.COMPLETION_SECRET ?? (production ? null : "development-second-key-completion-key"), "COMPLETION_SECRET");
  const policySecret = required(options.policySecret ?? env.AGENT_POLICY_SECRET ?? (production ? null : "development-second-key-policy-secret"), "AGENT_POLICY_SECRET");
  if (production && (options.allowDev === true || env.ALLOW_DEV_LAUNCH === "true")) throw new Error("development launch mode is not allowed in production");
  const allowDev = !production && (options.allowDev ?? (env.ALLOW_DEV_LAUNCH === "true" || !ticketSecret));
  const preAuthIpLimit = positiveInteger(options.preAuthIpLimit ?? env.SECOND_KEY_PREAUTH_IP_LIMIT_PER_MINUTE ?? 240, "SECOND_KEY_PREAUTH_IP_LIMIT_PER_MINUTE");
  const preAuthGlobalLimit = positiveInteger(options.preAuthGlobalLimit ?? env.SECOND_KEY_PREAUTH_GLOBAL_LIMIT_PER_MINUTE ?? 2_400, "SECOND_KEY_PREAUTH_GLOBAL_LIMIT_PER_MINUTE");
  const sessionLimit = positiveInteger(options.sessionLimit ?? env.SECOND_KEY_SESSION_LIMIT_PER_MINUTE ?? 240, "SECOND_KEY_SESSION_LIMIT_PER_MINUTE");
  const participantOperationLimit = positiveInteger(options.participantOperationLimit ?? env.SECOND_KEY_PARTICIPANT_OPERATION_LIMIT_PER_MINUTE ?? 30, "SECOND_KEY_PARTICIPANT_OPERATION_LIMIT_PER_MINUTE");
  const globalOperationLimit = positiveInteger(options.globalOperationLimit ?? env.SECOND_KEY_GLOBAL_OPERATION_LIMIT_PER_MINUTE ?? 1_200, "SECOND_KEY_GLOBAL_OPERATION_LIMIT_PER_MINUTE");
  const maxExpensiveConcurrency = positiveInteger(options.maxExpensiveConcurrency ?? env.SECOND_KEY_MAX_EXPENSIVE_CONCURRENCY ?? 1, "SECOND_KEY_MAX_EXPENSIVE_CONCURRENCY");
  const maxReadConcurrency = positiveInteger(options.maxReadConcurrency ?? env.SECOND_KEY_MAX_READ_CONCURRENCY ?? 12, "SECOND_KEY_MAX_READ_CONCURRENCY");
  const operationTimeoutMs = positiveInteger(options.operationTimeoutMs ?? env.SECOND_KEY_OPERATION_TIMEOUT_MS ?? 40_000, "SECOND_KEY_OPERATION_TIMEOUT_MS");
  const operationLeaseMs = positiveInteger(options.operationLeaseMs ?? env.SECOND_KEY_OPERATION_LEASE_MS ?? 60_000, "SECOND_KEY_OPERATION_LEASE_MS");
  const healthCacheMs = positiveInteger(options.healthCacheMs ?? env.SECOND_KEY_HEALTH_CACHE_MS ?? 15_000, "SECOND_KEY_HEALTH_CACHE_MS");
  if (operationLeaseMs > 120_000) throw new Error("SECOND_KEY_OPERATION_LEASE_MS must not exceed 120000");
  if (operationLeaseMs <= operationTimeoutMs) throw new Error("SECOND_KEY_OPERATION_LEASE_MS must exceed SECOND_KEY_OPERATION_TIMEOUT_MS");
  const reportSolve = options.reportSolve || ((identity, sourceId, occurredAt) => reportSolveEventBestEffort({ url: env.LEADERBOARD_INGEST_URL, secret: ticketSecret, challenge: "second-key", eventId: generation, participantId: identity.participantId, sourceId, occurredAt, timeoutMs: 1_500 }));
  let healthCache = null;
  let healthProbe = null;
  let healthEpoch = 0;
  const localActiveParticipants = new Set();
  const localActiveOperations = new Map();

  async function readHealth() {
    if (healthCache && healthCache.expiresAt > Date.now()) return healthCache.value;
    if (healthProbe) return healthProbe;
    const epoch = healthEpoch;
    const probe = (async () => {
      try {
        const [provisionedParticipants, storageHealthy] = await Promise.all([
          typeof store.provisionedCount === "function" ? store.provisionedCount() : Promise.resolve(0),
          typeof store.health === "function" ? store.health() : Promise.resolve(false),
        ]);
        const health = await chain.health({ provisionedParticipants });
        const value = { health, storageHealthy, ok: health.ok && storageHealthy };
        if (epoch === healthEpoch) healthCache = { value, expiresAt: Date.now() + healthCacheMs };
        return value;
      } catch {
        const value = { health: { ok: false }, storageHealthy: false, ok: false };
        if (epoch === healthEpoch) healthCache = { value, expiresAt: Date.now() + healthCacheMs };
        return value;
      }
    })();
    healthProbe = probe;
    try { return await probe; }
    finally { if (healthProbe === probe) healthProbe = null; }
  }

  function invalidateHealth() {
    healthEpoch += 1;
    healthCache = null;
    healthProbe = null;
  }

  const server = http.createServer((request, response) => handle(request, response).catch((error) => {
    const status = error instanceof HttpError ? error.status : 500;
    if (status === 500) console.error("second-key", error);
    json(response, status, { error: status === 500 ? "internal server error" : error.message }, error.retryAfter ? { "retry-after": String(error.retryAfter) } : {});
  }));

  async function enforceRate(scope, identifier, limit) {
    const result = await store.rateLimit(scope, identifier, limit);
    if (!result.allowed) throw new HttpError(429, "request limit reached; try again shortly", result.retryAfter || 60);
  }

  async function withExpensiveOperation(participantId, kind, operation, { pool = "write", maxConcurrency = maxExpensiveConcurrency } = {}) {
    await Promise.all([
      enforceRate(`participant-${kind}`, participantId, participantOperationLimit),
      enforceRate("global-operation", "all", globalOperationLimit),
    ]);
    const activeInPool = localActiveOperations.get(pool) || 0;
    if (localActiveParticipants.has(participantId) || activeInPool >= maxConcurrency) {
      throw new HttpError(429, "an operation is already running or service capacity is full", 2);
    }
    localActiveParticipants.add(participantId);
    localActiveOperations.set(pool, activeInPool + 1);
    let lease;
    try {
      lease = await store.acquireOperation(participantId, { ttlMs: operationLeaseMs, maxConcurrency, pool });
    } catch (error) {
      localActiveParticipants.delete(participantId);
      localActiveOperations.set(pool, Math.max(0, (localActiveOperations.get(pool) || 1) - 1));
      throw error;
    }
    if (!lease) {
      localActiveParticipants.delete(participantId);
      localActiveOperations.set(pool, Math.max(0, (localActiveOperations.get(pool) || 1) - 1));
      throw new HttpError(429, "an operation is already running or service capacity is full", 2);
    }
    const release = async () => {
      try { await store.releaseOperation(lease); }
      finally {
        localActiveParticipants.delete(participantId);
        localActiveOperations.set(pool, Math.max(0, (localActiveOperations.get(pool) || 1) - 1));
      }
    };
    const work = Promise.resolve().then(operation);
    let timedOut = false;
    let timer;
    try {
      return await Promise.race([
        work,
        new Promise((_, reject) => {
          timer = setTimeout(() => {
            timedOut = true;
            reject(new HttpError(504, "chain operation timed out; its result will be reconciled automatically"));
          }, operationTimeoutMs);
        }),
      ]);
    } finally {
      clearTimeout(timer);
      if (timedOut) void work.catch(() => {}).finally(release);
      else await release();
    }
  }

  async function handle(request, response) {
    security(response);
    const url = new URL(request.url, "http://second-key.local");
    if ((request.method === "GET" || request.method === "HEAD") && STATIC.has(url.pathname)) {
      const [file, type] = STATIC.get(url.pathname); const body = await fs.readFile(path.join(WEB, file));
      const identity = await optionalIdentity(request); if (identity && request.method === "GET") await integrityEvent(identity, `interface:${file}`, "interface", request, "direct-http");
      response.writeHead(200, { "content-type": type, "cache-control": "no-store" }); return response.end(request.method === "HEAD" ? undefined : body);
    }
    if (request.method === "GET" && url.pathname === "/health") {
      const { health, storageHealthy, ok } = await readHealth();
      return json(response, ok ? 200 : 503, { ...health, ok, storageHealthy, challenge: "second-key", store: store.mode });
    }
    if (request.method === "GET" && policyPaths.has(url.pathname)) {
      const identity = await optionalIdentity(request); if (identity) await integrityEvent(identity, "policy-read", "policy", request, "policy"); const policy = identity ? policyFor({ challenge: "second-key", participantId: identity.participantId }, { markerSecret: policySecret, label: "SECOND KEY" }) : null;
      return text(response, 200, policy?.text || publicPolicyFor({ label: "SECOND KEY" }));
    }
    if (request.method === "POST" && url.pathname === "/api/session") return createSession(request, response);
    if (request.method === "GET" && url.pathname === "/api/completion") return completionStatus(request, response, url);

    const identity = await authenticate(request); let instance = await store.getInstance(identity.participantId);
    if (!instance) throw new HttpError(409, "collateral case is unavailable");
    if (request.method === "POST" && url.pathname === "/api/ui-event") {
      const body = await readJson(request);
      if (!new Set(["app-boot", "automation-present"]).has(body.event)) throw new HttpError(400, "unknown UI event");
      await audit(identity, `ui:${body.event}`, request);
      return json(response, 202, { recorded: true });
    }
    if (request.method === "POST" && url.pathname === "/api/agent-disclosure") {
      const body = await readJson(request);
      if (!verifyMarker({ challenge: "second-key", participantId: identity.participantId }, body.marker, policySecret)) throw new HttpError(400, "invalid disclosure marker");
      const result = await forwardDisclosure({ identity, challenge: "second-key", label: "SECOND KEY", agent: body.agent, model: body.model, requestMeta: { source: "second-key-agent-policy", userAgent: String(request.headers["user-agent"] || "") } }, env, options.fetchImpl || fetch);
      await audit(identity, "agent-disclosure", request, { caseId: result.caseId }); return json(response, 202, result);
    }
    if (request.method === "GET" && url.pathname === "/api/state") {
      instance = await withExpensiveOperation(identity.participantId, "inspect", () => withParticipant(identity.participantId, async () => refreshInstance(identity, await store.getInstance(identity.participantId))), { pool: "read", maxConcurrency: maxReadConcurrency }); return json(response, 200, publicState(instance, chain));
    }
    if (request.method === "POST" && url.pathname === "/api/pledge") {
      assertAllowedKeys(await readJson(request), []);
      const result = await withExpensiveOperation(identity.participantId, "pledge", () => withParticipant(identity.participantId, async () => {
        instance = await store.getInstance(identity.participantId);
        if (instance.pledgeSignature) return { signature: instance.pledgeSignature, created: false, recovered: false };
        let recovery = await reconcilePledge(identity, instance);
        if (recovery.recovered) {
          await store.putInstance(identity.participantId, instance);
          return { signature: instance.pledgeSignature, created: false, recovered: true };
        }
        if (recovery.custody.outstanding) throw new HttpError(503, "the pledge is finalizing; retry shortly");
        try {
          const pledged = await chain.pledge(identity.participantId, instance.nonce);
          instance.pledgeSignature = pledged;
          instance.pledgedAt = new Date().toISOString();
          await store.putInstance(identity.participantId, instance);
          return { signature: pledged, created: true, recovered: false };
        } catch (error) {
          recovery = await reconcilePledge(identity, instance);
          if (!recovery.recovered) throw error;
          await store.putInstance(identity.participantId, instance);
          return { signature: instance.pledgeSignature, created: false, recovered: true };
        }
      }));
      await audit(identity, "receipt-pledged", request, { signature: result.signature, recovered: result.recovered });
      return json(response, result.created ? 201 : 200, { signature: result.signature, recovered: result.recovered });
    }
    if (request.method === "GET" && url.pathname === "/api/wallet-keypair") {
      await audit(identity, "participant-wallet-opened", request);
      return json(response, 200, { secretKey: chain.walletSecret(identity.participantId, instance.nonce) });
    }
    throw new HttpError(404, "not found");
  }

  async function createSession(request, response) {
    await enforceRate("session-preauth-ip", clientRateKey(request), preAuthIpLimit);
    await enforceRate("session-preauth-global", "all", preAuthGlobalLimit);
    const body = await readJson(request); let identity; let launchTicket = null;
    assertAllowedKeys(body, body.ticket ? ["ticket"] : ["participantId"]);
    if (body.ticket && ticketSecret) {
      try { const claims = verifyParticipantTicket(body.ticket, ticketSecret, { audience: "second-key", eventId: generation }); identity = { participantId: claims.participant_id, eventId: claims.event_id, launchMode: "portal" }; launchTicket = body.ticket; }
      catch (error) { if (error instanceof ParticipantTicketError) throw new HttpError(401, error.message); throw error; }
    } else if (allowDev) {
      const participantId = String(body.participantId || "local-second-key"); if (!/^[A-Za-z0-9_-]{1,128}$/.test(participantId)) throw new HttpError(400, "invalid participant ID"); identity = { participantId, eventId: generation, launchMode: "development" };
    } else throw new HttpError(401, "a portal launch ticket is required");
    await enforceRate("session", "global", sessionLimit);
    let createdProvision = false;
    const reserved = await store.getInstance(identity.participantId);
    if (reserved && reserved.allocationStatus !== "allocating") {
      if (launchTicket) await consumeLaunchTicket(launchTicket);
    } else {
      await withExpensiveOperation(identity.participantId, "provision", () => withParticipant(identity.participantId, async () => {
        const existing = await store.getInstance(identity.participantId);
        if (existing && existing.allocationStatus !== "allocating") {
          if (launchTicket) await consumeLaunchTicket(launchTicket);
          return;
        }
        if (launchTicket) await consumeLaunchTicket(launchTicket);
        const nonce = existing?.nonce || crypto.randomBytes(12).toString("hex");
        if (!existing) {
          await store.putInstance(identity.participantId, {
            allocationStatus: "allocating",
            ...identity,
            nonce,
            reservedAt: new Date().toISOString(),
          });
        }
        const provisioned = await chain.provision(identity.participantId, nonce);
        await store.putInstance(identity.participantId, { ...identity, nonce, ...provisioned, pledgeSignature: null, pledgedAt: null, removalSignature: null, completedAt: null, receipt: null });
        createdProvision = true;
      }));
    }
    if (createdProvision) invalidateHealth();
    const id = crypto.randomBytes(24).toString("base64url"); await store.putSession(id, identity); await store.audit(identity.participantId, { at: Date.now(), event: "session-created", participantId: identity.participantId, source: "direct-http" }); await integrityEvent(identity, "interface:session", "interface", request, "direct-http");
    response.setHeader("set-cookie", `${COOKIE}=${sign(id, sessionSecret)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=43200${env.NODE_ENV === "production" ? "; Secure" : ""}`);
    return json(response, 201, { participantId: identity.participantId });
  }

  async function consumeLaunchTicket(ticket) {
    try {
      return await consumeParticipantTicket(ticket, ticketSecret, {
        audience: "second-key",
        eventId: generation,
        consumeJti: ({ jti, expiresAt }) => store.consumeTicket(jti, expiresAt),
      });
    } catch (error) {
      if (error instanceof ParticipantTicketError) throw new HttpError(401, error.message);
      throw error;
    }
  }

  async function refreshInstance(identity, instance) {
    const { custody } = await reconcilePledge(identity, instance);
    if (!instance.completedAt && instance.pledgeSignature && custody.outstanding && custody.vaultBalance === 0 && custody.sourceBalance === 1) {
      const removal = await chain.findRemoval(identity.participantId, instance.nonce, instance.pledgeSignature);
      if (removal) {
        instance.removalSignature = removal.signature; instance.completedAt = removal.completedAt;
        instance.receipt = crypto.createHmac("sha256", completionSecret).update(`second-key:${identity.participantId}:${instance.mint}:${removal.signature}`).digest("base64url").slice(0, 24);
        await store.putInstance(identity.participantId, instance);
        await reportSolve(identity, `second-key:${identity.participantId}:${instance.receipt}`, instance.completedAt); await audit(identity, "completion-verified", { headers: {} }, { signature: removal.signature });
      }
    }
    await store.putInstance(identity.participantId, instance); return instance;
  }

  async function reconcilePledge(identity, instance) {
    const custody = await chain.inspect(identity.participantId, instance.nonce);
    instance.custody = custody;
    if (instance.pledgeSignature || !custody.outstanding) return { custody, recovered: false };
    const evidence = await chain.findPledge(identity.participantId, instance.nonce);
    if (!evidence) return { custody, recovered: false };
    instance.pledgeSignature = typeof evidence === "string" ? evidence : evidence.signature;
    instance.pledgedAt = typeof evidence === "object" && evidence.pledgedAt ? evidence.pledgedAt : new Date().toISOString();
    return { custody, recovered: Boolean(instance.pledgeSignature) };
  }

  async function completionStatus(request, response, url) {
    if (!authorized(request, ticketSecret)) throw new HttpError(401, "unauthorized");
    const participantId = String(url.searchParams.get("participantId") || "");
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(participantId)) throw new HttpError(400, "invalid participant ID");
    const instance = await withExpensiveOperation(participantId, "completion", () => withParticipant(participantId, async () => {
      const current = await store.getInstance(participantId);
      return current && !current.completedAt ? refreshInstance(current, current) : current;
    }), { pool: "read", maxConcurrency: maxReadConcurrency });
    return json(response, 200, { completed: Boolean(instance?.completedAt), completedAt: instance?.completedAt || null, eventGeneration: generation });
  }
  async function authenticate(request) { const id = verify(parseCookies(request.headers.cookie || "")[COOKIE], sessionSecret); if (!id) throw new HttpError(401, "launch authentication is required"); const identity = await store.getSession(id); if (!identity) throw new HttpError(401, "session expired"); return identity; }
  async function optionalIdentity(request) { try { return await authenticate(request); } catch { return null; } }
  async function integrityEvent(identity, event, category, request, source) { await forwardIntegrityEvent({ identity, challenge: "second-key", label: "SECOND KEY", action: event, category, source, request }, env, options.fetchImpl || fetch).catch((error) => console.warn("SECOND KEY integrity event deferred", error.message)); }
  async function audit(identity, event, request, detail = {}) { const source = request.headers?.["x-second-key-ui"] === "desk" ? "browser-ui" : "direct-http"; const category = event.startsWith("ui:") ? "ui" : event === "completion-verified" ? "completion" : new Set(["receipt-pledged", "participant-wallet-opened"]).has(event) ? "challenge-action" : "activity"; await store.audit(identity.participantId, { at: Date.now(), event, participantId: identity.participantId, source, ...detail }); await integrityEvent(identity, event, category, request, source); }

  return { server, store, listen(port = 0) { return new Promise((resolve) => server.listen(port, () => resolve(server.address()))); }, close() { return new Promise((resolve, reject) => server.close(async (error) => { await store.close(); error ? reject(error) : resolve(); })); } };
}

function publicState(instance, chain) { const custody = instance.custody || { sourceBalance: 1, vaultBalance: 0, outstanding: false, advanceLamports: 10_000_000 }; return { challenge: "second-key", network: chain.network, wallet: instance.wallet, mint: instance.mint, source: instance.source, vault: instance.vault, vaultAuthority: instance.vaultAuthority, loan: instance.loan, programId: instance.programId || chain.programId, pledgeSignature: instance.pledgeSignature, removalSignature: instance.removalSignature, completedAt: instance.completedAt, ...custody }; }
function sign(id, secret) { return `${id}.${crypto.createHmac("sha256", secret).update(id).digest("base64url")}`; }
function verify(value, secret) { const [id, mac, extra] = String(value || "").split("."); if (!id || !mac || extra) return null; const expected = crypto.createHmac("sha256", secret).update(id).digest(); let actual; try { actual = Buffer.from(mac, "base64url"); } catch { return null; } return actual.length === expected.length && crypto.timingSafeEqual(actual, expected) ? id : null; }
function clientRateKey(request) { return crypto.createHash("sha256").update(trustedClientAddress(request)).digest("base64url").slice(0, 24); }
async function withParticipant(participantId, operation) { const previous = participantQueues.get(participantId) || Promise.resolve(); const current = previous.catch(() => {}).then(operation); participantQueues.set(participantId, current); try { return await current; } finally { if (participantQueues.get(participantId) === current) participantQueues.delete(participantId); } }
function required(value, name, optional = false) { if (optional && !value) return null; if (typeof value !== "string" || Buffer.byteLength(value) < 32) throw new Error(`${name} must contain at least 32 bytes`); return value; }
function positiveInteger(value, name) { const number = Number(value); if (!Number.isSafeInteger(number) || number < 1) throw new Error(`${name} must be a positive integer`); return number; }
function authorized(request, secret) { if (!secret) return false; const value = String(request.headers.authorization || ""); const supplied = value.startsWith("Bearer ") ? Buffer.from(value.slice(7)) : null; const expected = Buffer.from(secret); return supplied && supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected); }
function parseCookies(value) { return Object.fromEntries(value.split(";").map((part) => part.trim().split("=")).filter(([key, val]) => key && val)); }
async function readJson(request) { const chunks = []; let size = 0; for await (const chunk of request) { size += chunk.length; if (size > MAX_BODY) throw new HttpError(413, "request too large"); chunks.push(chunk); } try { return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); } catch { throw new HttpError(400, "invalid JSON"); } }
function assertAllowedKeys(body, allowed) { if (!body || typeof body !== "object" || Array.isArray(body)) throw new HttpError(400, "request body must be an object"); const unexpected = Object.keys(body).filter((key) => !allowed.includes(key)); if (unexpected.length) throw new HttpError(400, "request contains unexpected fields"); }
function security(response) { response.setHeader("content-security-policy", "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"); response.setHeader("x-content-type-options", "nosniff"); response.setHeader("referrer-policy", "no-referrer"); }
function json(response, status, body, headers = {}) { response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers }); response.end(JSON.stringify(body)); }
function text(response, status, body) { response.writeHead(status, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" }); response.end(body); }

if (process.argv[1] === fileURLToPath(import.meta.url)) { const service = await createSecondKeyServer(); const port = Number(process.env.PORT || 3011); await service.listen(port); console.log(`SECOND KEY listening on ${port}`); }
