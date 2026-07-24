import crypto from "node:crypto";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { consumeParticipantTicket, ParticipantTicketError, verifyParticipantTicket } from "@ctf26/participant-ticket";
import { forwardDisclosure, forwardIntegrityEvent, policyFor, publicPolicyFor, verifyMarker } from "@ctf26/agent-integrity";
import { eventGeneration, reportSolveEventBestEffort } from "@ctf26/leaderboard";
import { trustedClientAddress } from "@ctf26/request-budget";

import { createChamberChain, parseWallet } from "./chain.mjs";
import { createStore } from "./store.mjs";

const WEB = fileURLToPath(new URL("../web/", import.meta.url));
const IDL_FILE = fileURLToPath(new URL("../web/the-chamber-idl.json", import.meta.url));
const STATIC = new Map([
  ["/", ["index.html", "text/html; charset=utf-8"]],
  ["/app.js", ["app.js", "text/javascript; charset=utf-8"]],
  ["/style.css", ["style.css", "text/css; charset=utf-8"]],
]);
const COOKIE = "the_chamber_session";
const MAX_BODY = 16 * 1024;
const PARTICIPANT_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const policyPaths = new Set(["/robots.txt", "/agents.txt", "/llms.txt", "/.well-known/agents.txt"]);
const participantQueues = new Map();

class HttpError extends Error {
  constructor(status, message, retryAfter = null) {
    super(message);
    this.status = status;
    if (retryAfter) this.retryAfter = retryAfter;
  }
}

export async function createChamberServer(options = {}) {
  const env = options.env || process.env;
  const generation = eventGeneration(env);
  const production = env.NODE_ENV === "production";
  const store = options.store || await createStore(env);
  const chain = options.chain || createChamberChain(env);
  const ticketSecret = required(options.ticketSecret ?? env.PARTICIPANT_TICKET_SECRET, "PARTICIPANT_TICKET_SECRET", !production);
  const sessionSecret = required(options.sessionSecret ?? env.SESSION_SECRET ?? (production ? null : "development-the-chamber-session-secret"), "SESSION_SECRET");
  const completionSecret = required(options.completionSecret ?? env.COMPLETION_SECRET ?? (production ? null : "development-the-chamber-completion-key"), "COMPLETION_SECRET");
  const policySecret = required(options.policySecret ?? env.AGENT_POLICY_SECRET ?? (production ? null : "development-the-chamber-policy-secret"), "AGENT_POLICY_SECRET");
  if (production && (options.allowDev === true || env.ALLOW_DEV_LAUNCH === "true")) throw new Error("development launch mode is not allowed in production");
  const allowDev = !production && (options.allowDev ?? (env.ALLOW_DEV_LAUNCH === "true" || !ticketSecret));
  const expectedParticipants = positiveInteger(options.expectedParticipants ?? env.THE_CHAMBER_EXPECTED_PARTICIPANTS ?? 50, "THE_CHAMBER_EXPECTED_PARTICIPANTS");
  const preAuthIpLimit = positiveInteger(options.preAuthIpLimit ?? env.THE_CHAMBER_PREAUTH_IP_LIMIT_PER_MINUTE ?? 240, "THE_CHAMBER_PREAUTH_IP_LIMIT_PER_MINUTE");
  const preAuthGlobalLimit = positiveInteger(options.preAuthGlobalLimit ?? env.THE_CHAMBER_PREAUTH_GLOBAL_LIMIT_PER_MINUTE ?? 2_400, "THE_CHAMBER_PREAUTH_GLOBAL_LIMIT_PER_MINUTE");
  const sessionLimit = positiveInteger(options.sessionLimit ?? env.THE_CHAMBER_SESSION_LIMIT_PER_MINUTE ?? 240, "THE_CHAMBER_SESSION_LIMIT_PER_MINUTE");
  const participantOperationLimit = positiveInteger(options.participantOperationLimit ?? env.THE_CHAMBER_PARTICIPANT_OPERATION_LIMIT_PER_MINUTE ?? 30, "THE_CHAMBER_PARTICIPANT_OPERATION_LIMIT_PER_MINUTE");
  const globalOperationLimit = positiveInteger(options.globalOperationLimit ?? env.THE_CHAMBER_GLOBAL_OPERATION_LIMIT_PER_MINUTE ?? 1_200, "THE_CHAMBER_GLOBAL_OPERATION_LIMIT_PER_MINUTE");
  const maxExpensiveConcurrency = positiveInteger(options.maxExpensiveConcurrency ?? env.THE_CHAMBER_MAX_EXPENSIVE_CONCURRENCY ?? 1, "THE_CHAMBER_MAX_EXPENSIVE_CONCURRENCY");
  const maxReadConcurrency = positiveInteger(options.maxReadConcurrency ?? env.THE_CHAMBER_MAX_READ_CONCURRENCY ?? 12, "THE_CHAMBER_MAX_READ_CONCURRENCY");
  const operationTimeoutMs = positiveInteger(options.operationTimeoutMs ?? env.THE_CHAMBER_OPERATION_TIMEOUT_MS ?? 40_000, "THE_CHAMBER_OPERATION_TIMEOUT_MS");
  const operationLeaseMs = positiveInteger(options.operationLeaseMs ?? env.THE_CHAMBER_OPERATION_LEASE_MS ?? 60_000, "THE_CHAMBER_OPERATION_LEASE_MS");
  const healthCacheMs = positiveInteger(options.healthCacheMs ?? env.THE_CHAMBER_HEALTH_CACHE_MS ?? 15_000, "THE_CHAMBER_HEALTH_CACHE_MS");
  if (operationLeaseMs > 120_000) throw new Error("THE_CHAMBER_OPERATION_LEASE_MS must not exceed 120000");
  if (operationLeaseMs <= operationTimeoutMs) throw new Error("THE_CHAMBER_OPERATION_LEASE_MS must exceed THE_CHAMBER_OPERATION_TIMEOUT_MS");
  const reportSolve = options.reportSolve || ((identity, sourceId, occurredAt) => reportSolveEventBestEffort({
    url: env.LEADERBOARD_INGEST_URL,
    secret: ticketSecret,
    challenge: "the-chamber",
    eventId: generation,
    participantId: identity.participantId,
    sourceId,
    occurredAt,
    timeoutMs: 1_500,
  }));

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
        const withinConfiguredField = provisionedParticipants <= expectedParticipants;
        const remainingParticipants = Math.max(0, expectedParticipants - provisionedParticipants);
        const chainHealth = await chain.health({ remainingParticipants });
        const ok = Boolean(chainHealth.ok && storageHealthy && withinConfiguredField);
        const value = { chainHealth, storageHealthy, provisionedParticipants, remainingParticipants, withinConfiguredField, ok };
        if (epoch === healthEpoch) healthCache = { value, expiresAt: Date.now() + healthCacheMs };
        return value;
      } catch (error) {
        console.error("THE CHAMBER capacity probe failed", error.message);
        const value = { chainHealth: { ok: false }, storageHealthy: false, provisionedParticipants: 0, remainingParticipants: 0, withinConfiguredField: false, ok: false };
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
    if (status === 500) console.error("the-chamber", error);
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
    const url = new URL(request.url, "http://the-chamber.local");
    if ((request.method === "GET" || request.method === "HEAD") && STATIC.has(url.pathname)) {
      const [file, type] = STATIC.get(url.pathname);
      const body = await fs.readFile(path.join(WEB, file));
      const identity = await optionalIdentity(request);
      if (identity && request.method === "GET") await integrityEvent(identity, `interface:${file}`, "interface", request, "direct-http");
      response.writeHead(200, { "content-type": type, "cache-control": "no-store" });
      return response.end(request.method === "HEAD" ? undefined : body);
    }
    if (request.method === "GET" && url.pathname === "/health") {
      const { chainHealth, storageHealthy, provisionedParticipants, remainingParticipants, withinConfiguredField, ok } = await readHealth();
      return json(response, ok ? 200 : 503, {
        ok,
        challenge: "the-chamber",
        store: store.mode,
        storageHealthy,
        network: chain.network,
        programId: chain.programId,
        programAvailable: chainHealth.programAvailable !== false,
        capacity: {
          reachable: chainHealth.ok !== undefined,
          expectedParticipants,
          provisionedParticipants,
          remainingParticipants,
          withinConfiguredField,
          sufficient: chainHealth.capacitySufficient !== false,
        },
        funding: { payer: chainHealth.payer, requiredBalance: chainHealth.requiredPayerBalance },
      });
    }
    if (request.method === "GET" && policyPaths.has(url.pathname)) {
      const identity = await optionalIdentity(request);
      if (identity) await integrityEvent(identity, "policy-read", "policy", request, "policy");
      const policy = identity ? policyFor({ challenge: "the-chamber", participantId: identity.participantId }, { markerSecret: policySecret, label: "THE CHAMBER" }) : null;
      return text(response, 200, policy?.text || publicPolicyFor({ label: "THE CHAMBER" }));
    }
    if (request.method === "POST" && url.pathname === "/api/session") return createSession(request, response);
    if (request.method === "GET" && url.pathname === "/api/completion") return completionStatus(request, response, url);

    const identity = await authenticate(request);
    if (request.method === "POST" && url.pathname === "/api/ui-event") {
      const body = await readJson(request);
      if (!new Set(["app-boot", "automation-present"]).has(body.event)) throw new HttpError(400, "unknown UI event");
      await audit(identity, `ui:${body.event}`, request);
      return json(response, 202, { recorded: true });
    }
    if (request.method === "POST" && url.pathname === "/api/agent-disclosure") {
      const body = await readJson(request);
      if (!verifyMarker({ challenge: "the-chamber", participantId: identity.participantId }, body.marker, policySecret)) throw new HttpError(400, "invalid disclosure marker");
      const result = await forwardDisclosure({
        identity,
        challenge: "the-chamber",
        label: "THE CHAMBER",
        agent: body.agent,
        model: body.model,
        requestMeta: { source: "the-chamber-agent-policy", userAgent: String(request.headers["user-agent"] || "") },
      }, env, options.fetchImpl || fetch);
      await audit(identity, "agent-disclosure", request, { caseId: result.caseId });
      return json(response, 202, result);
    }
    if (request.method === "GET" && url.pathname === "/api/idl") {
      const idl = await readIdl();
      if (!idl) throw new HttpError(503, "the interface description is not published yet");
      response.writeHead(200, {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
        // Matches the IDL's own program name so a participant's
        // `import idl from "./st_chamber_of_secrets.json"` resolves as written.
        "content-disposition": 'attachment; filename="st_chamber_of_secrets.json"',
      });
      return response.end(idl);
    }
    if (request.method === "POST" && url.pathname === "/api/register") {
      const body = await readJson(request);
      assertAllowedKeys(body, ["wallet"]);
      const wallet = parseWallet(body.wallet);
      if (!wallet) throw new HttpError(400, "a valid wallet address is required");
      const walletKey = wallet.toBase58();
      const instance = await withExpensiveOperation(identity.participantId, "register", () => withParticipant(identity.participantId, async () => {
        const current = await store.getInstance(identity.participantId);
        if (current?.wallet && current.wallet !== walletKey) {
          throw new HttpError(409, "this launch is already bound to a different wallet");
        }
        if (current?.wallet === walletKey && current.pda) return current;
        const claim = await store.claimWallet(walletKey, identity.participantId);
        if (claim === "taken") throw new HttpError(409, "that wallet is already registered to another participant");
        const provisioned = await chain.provision(walletKey);
        const next = {
          ...identity,
          wallet: walletKey,
          pda: provisioned.pda,
          createSignature: provisioned.signature,
          registeredAt: new Date().toISOString(),
          completedAt: current?.completedAt || null,
          receipt: current?.receipt || null,
        };
        await store.putInstance(identity.participantId, next);
        return next;
      }));
      invalidateHealth();
      await audit(identity, "wallet-registered", request, { wallet: instance.wallet, pda: instance.pda });
      return json(response, 201, publicState(instance, { firstUnlock: false, secondUnlock: false, thirdUnlock: false, chamberOpen: false }, chain));
    }
    if (request.method === "GET" && url.pathname === "/api/state") {
      const result = await withExpensiveOperation(identity.participantId, "inspect", () => withParticipant(identity.participantId, async () => {
        const instance = await store.getInstance(identity.participantId);
        if (!instance?.wallet) return { instance: null, locks: null };
        const locks = await chain.readLocks(instance.wallet);
        return { instance: await reconcile(identity, instance, locks), locks };
      }), { pool: "read", maxConcurrency: maxReadConcurrency });
      if (!result.instance) return json(response, 200, { challenge: "the-chamber", network: chain.network, programId: chain.programId, registered: false });
      return json(response, 200, publicState(result.instance, result.locks, chain));
    }
    throw new HttpError(404, "not found");
  }

  /**
   * The chain is the only authority on a solve. When the program's own
   * chamber flag is set, record the completion once and report it.
   */
  async function reconcile(identity, instance, locks) {
    if (instance.completedAt || !locks?.chamberOpen) return instance;
    const openedAt = await chain.openedAt?.(instance.wallet).catch(() => null);
    instance.completedAt = openedAt || new Date().toISOString();
    instance.receipt = crypto.createHmac("sha256", completionSecret)
      .update(`the-chamber:${identity.participantId}:${instance.wallet}:${instance.pda}`)
      .digest("base64url")
      .slice(0, 24);
    await store.putInstance(identity.participantId, instance);
    await reportSolve(identity, `the-chamber:${identity.participantId}:${instance.receipt}`, instance.completedAt);
    await audit(identity, "completion-verified", { headers: {} }, { wallet: instance.wallet });
    return instance;
  }

  async function createSession(request, response) {
    await enforceRate("session-preauth-ip", clientRateKey(request), preAuthIpLimit);
    await enforceRate("session-preauth-global", "all", preAuthGlobalLimit);
    const body = await readJson(request);
    let identity;
    let launchTicket = null;
    assertAllowedKeys(body, body.ticket ? ["ticket"] : ["participantId"]);
    if (body.ticket && ticketSecret) {
      try {
        const claims = verifyParticipantTicket(body.ticket, ticketSecret, { audience: "the-chamber", eventId: generation });
        identity = { participantId: claims.participant_id, eventId: claims.event_id, launchMode: "portal" };
        launchTicket = body.ticket;
      } catch (error) {
        if (error instanceof ParticipantTicketError) throw new HttpError(401, error.message);
        throw error;
      }
    } else if (allowDev) {
      const participantId = String(body.participantId || "local-the-chamber");
      if (!PARTICIPANT_PATTERN.test(participantId)) throw new HttpError(400, "invalid participant ID");
      identity = { participantId, eventId: generation, launchMode: "development" };
    } else throw new HttpError(401, "a portal launch ticket is required");
    await enforceRate("session", "global", sessionLimit);
    if (launchTicket) await consumeLaunchTicket(launchTicket);
    const id = crypto.randomBytes(24).toString("base64url");
    await store.putSession(id, identity);
    await store.audit(identity.participantId, { at: Date.now(), event: "session-created", participantId: identity.participantId, source: "direct-http" });
    await integrityEvent(identity, "interface:session", "interface", request, "direct-http");
    response.setHeader("set-cookie", `${COOKIE}=${sign(id, sessionSecret)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=43200${production ? "; Secure" : ""}`);
    return json(response, 201, { participantId: identity.participantId });
  }

  async function consumeLaunchTicket(ticket) {
    try {
      return await consumeParticipantTicket(ticket, ticketSecret, {
        audience: "the-chamber",
        eventId: generation,
        consumeJti: ({ jti, expiresAt }) => store.consumeTicket(jti, expiresAt),
      });
    } catch (error) {
      if (error instanceof ParticipantTicketError) throw new HttpError(401, error.message);
      throw error;
    }
  }

  async function completionStatus(request, response, url) {
    if (!authorized(request, ticketSecret)) throw new HttpError(401, "unauthorized");
    const participantId = String(url.searchParams.get("participantId") || "");
    if (!PARTICIPANT_PATTERN.test(participantId)) throw new HttpError(400, "invalid participant ID");
    const instance = await withExpensiveOperation(participantId, "completion", () => withParticipant(participantId, async () => {
      const current = await store.getInstance(participantId);
      if (!current?.wallet || current.completedAt) return current;
      return reconcile(current, current, await chain.readLocks(current.wallet));
    }), { pool: "read", maxConcurrency: maxReadConcurrency });
    return json(response, 200, {
      completed: Boolean(instance?.completedAt),
      completedAt: instance?.completedAt || null,
      eventGeneration: generation,
    });
  }

  async function readIdl() {
    try { return await fs.readFile(IDL_FILE, "utf8"); }
    catch { return null; }
  }

  async function authenticate(request) {
    const id = verify(parseCookies(request.headers.cookie || "")[COOKIE], sessionSecret);
    if (!id) throw new HttpError(401, "launch authentication is required");
    const identity = await store.getSession(id);
    if (!identity) throw new HttpError(401, "session expired");
    return identity;
  }
  async function optionalIdentity(request) { try { return await authenticate(request); } catch { return null; } }
  async function integrityEvent(identity, event, category, request, source) {
    await forwardIntegrityEvent({ identity, challenge: "the-chamber", label: "THE CHAMBER", action: event, category, source, request }, env, options.fetchImpl || fetch)
      .catch((error) => console.warn("THE CHAMBER integrity event deferred", error.message));
  }
  async function audit(identity, event, request, detail = {}) {
    const source = request.headers?.["x-the-chamber-ui"] === "chamber" ? "browser-ui" : "direct-http";
    const category = event.startsWith("ui:")
      ? "ui"
      : event === "completion-verified"
        ? "completion"
        : event === "wallet-registered"
          ? "challenge-action"
          : "activity";
    await store.audit(identity.participantId, { at: Date.now(), event, participantId: identity.participantId, source, ...detail });
    await integrityEvent(identity, event, category, request, source);
  }

  return {
    server,
    store,
    listen(port = 0) { return new Promise((resolve) => server.listen(port, () => resolve(server.address()))); },
    close() { return new Promise((resolve, reject) => server.close(async (error) => { await store.close(); error ? reject(error) : resolve(); })); },
  };
}

function publicState(instance, locks, chain) {
  return {
    challenge: "the-chamber",
    network: chain.network,
    programId: chain.programId,
    registered: true,
    wallet: instance.wallet,
    pda: instance.pda,
    locks: locks || { firstUnlock: false, secondUnlock: false, thirdUnlock: false, chamberOpen: false },
    initialized: locks !== null,
    completedAt: instance.completedAt || null,
  };
}
function sign(id, secret) { return `${id}.${crypto.createHmac("sha256", secret).update(id).digest("base64url")}`; }
function verify(value, secret) {
  const [id, mac, extra] = String(value || "").split(".");
  if (!id || !mac || extra) return null;
  const expected = crypto.createHmac("sha256", secret).update(id).digest();
  let actual;
  try { actual = Buffer.from(mac, "base64url"); } catch { return null; }
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected) ? id : null;
}
function clientRateKey(request) { return crypto.createHash("sha256").update(trustedClientAddress(request)).digest("base64url").slice(0, 24); }
async function withParticipant(participantId, operation) {
  const previous = participantQueues.get(participantId) || Promise.resolve();
  const current = previous.catch(() => {}).then(operation);
  participantQueues.set(participantId, current);
  try { return await current; }
  finally { if (participantQueues.get(participantId) === current) participantQueues.delete(participantId); }
}
function required(value, name, optional = false) {
  if (optional && !value) return null;
  if (typeof value !== "string" || Buffer.byteLength(value) < 32) throw new Error(`${name} must contain at least 32 bytes`);
  return value;
}
function positiveInteger(value, name) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) throw new Error(`${name} must be a positive integer`);
  return number;
}
function authorized(request, secret) {
  if (!secret) return false;
  const value = String(request.headers.authorization || "");
  const supplied = value.startsWith("Bearer ") ? Buffer.from(value.slice(7)) : null;
  const expected = Buffer.from(secret);
  return supplied && supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected);
}
function parseCookies(value) { return Object.fromEntries(value.split(";").map((part) => part.trim().split("=")).filter(([key, val]) => key && val)); }
async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY) throw new HttpError(413, "request too large");
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); }
  catch { throw new HttpError(400, "invalid JSON"); }
}
function assertAllowedKeys(body, allowed) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new HttpError(400, "request body must be an object");
  const unexpected = Object.keys(body).filter((key) => !allowed.includes(key));
  if (unexpected.length) throw new HttpError(400, "request contains unexpected fields");
}
function security(response) {
  response.setHeader("content-security-policy", "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
  response.setHeader("x-content-type-options", "nosniff");
  response.setHeader("referrer-policy", "no-referrer");
}
function json(response, status, body, headers = {}) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers });
  response.end(JSON.stringify(body));
}
function text(response, status, body) {
  response.writeHead(status, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
  response.end(body);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const service = await createChamberServer();
  const port = Number(process.env.PORT || 3012);
  await service.listen(port);
  console.log(`THE CHAMBER listening on ${port}`);
}
