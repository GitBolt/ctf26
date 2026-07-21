import crypto from "node:crypto";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import bs58 from "bs58";

import { consumeParticipantTicket, ParticipantTicketError, verifyParticipantTicket } from "@ctf26/participant-ticket";
import { forwardDisclosure, forwardIntegrityEvent, policyFor, publicPolicyFor, verifyMarker } from "@ctf26/agent-integrity";
import { reportSolveEventBestEffort } from "@ctf26/leaderboard";
import { trustedClientAddress } from "@ctf26/request-budget";

import { createEvidenceRoomChain } from "./chain.mjs";
import { createStore } from "./store.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const WEB = path.join(ROOT, "web");
const KIT = path.join(ROOT, "player-kit");
const THREE = path.join(ROOT, "node_modules", "three", "build");
const COOKIE = "evidence_room_session";
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

export async function createEvidenceRoomServer(options = {}) {
  const env = options.env || process.env;
  const production = env.NODE_ENV === "production";
  const store = options.store || await createStore(env);
  const chain = options.chain || createEvidenceRoomChain(env);
  const ticketSecret = requiredSecret(options.ticketSecret ?? env.PARTICIPANT_TICKET_SECRET, "PARTICIPANT_TICKET_SECRET", !production);
  const sessionSecret = requiredSecret(options.sessionSecret ?? env.SESSION_SECRET ?? (production ? null : "development-evidence-room-session-secret-32"), "SESSION_SECRET");
  const completionSecret = requiredSecret(options.completionSecret ?? env.COMPLETION_SECRET ?? (production ? null : "development-evidence-room-completion-secret"), "COMPLETION_SECRET");
  const policySecret = requiredSecret(options.policySecret ?? env.AGENT_POLICY_SECRET ?? (production ? null : "development-evidence-room-policy-secret-32"), "AGENT_POLICY_SECRET");
  if (production && (options.allowDev === true || env.ALLOW_DEV_LAUNCH === "true")) throw new Error("development launch mode is not allowed in production");
  const allowDev = !production && (options.allowDev ?? (env.ALLOW_DEV_LAUNCH === "true" || !ticketSecret));
  const windowMs = positiveInteger(options.windowMs ?? env.EVIDENCE_ROOM_WINDOW_MS ?? 30_000, "EVIDENCE_ROOM_WINDOW_MS");
  const captureGraceMs = positiveInteger(options.captureGraceMs ?? env.EVIDENCE_ROOM_CAPTURE_GRACE_MS ?? 30_000, "EVIDENCE_ROOM_CAPTURE_GRACE_MS");
  const batchCooldownMs = positiveInteger(options.batchCooldownMs ?? env.EVIDENCE_ROOM_BATCH_COOLDOWN_MS ?? 30_000, "EVIDENCE_ROOM_BATCH_COOLDOWN_MS");
  const maxBatches = positiveInteger(options.maxBatches ?? env.EVIDENCE_ROOM_MAX_BATCHES ?? 4, "EVIDENCE_ROOM_MAX_BATCHES");
  const interferenceCredits = nonNegativeInteger(options.interferenceCredits ?? env.EVIDENCE_ROOM_INTERFERENCE_CREDITS ?? 2, "EVIDENCE_ROOM_INTERFERENCE_CREDITS");
  const schedulerConcurrency = positiveInteger(options.schedulerConcurrency ?? env.EVIDENCE_ROOM_SCHEDULER_CONCURRENCY ?? 4, "EVIDENCE_ROOM_SCHEDULER_CONCURRENCY");
  const preAuthIpLimit = positiveInteger(options.preAuthIpLimit ?? env.EVIDENCE_ROOM_PREAUTH_IP_LIMIT_PER_MINUTE ?? 240, "EVIDENCE_ROOM_PREAUTH_IP_LIMIT_PER_MINUTE");
  const preAuthGlobalLimit = positiveInteger(options.preAuthGlobalLimit ?? env.EVIDENCE_ROOM_PREAUTH_GLOBAL_LIMIT_PER_MINUTE ?? 2_400, "EVIDENCE_ROOM_PREAUTH_GLOBAL_LIMIT_PER_MINUTE");
  const sessionLimit = positiveInteger(options.sessionLimit ?? env.EVIDENCE_ROOM_SESSION_LIMIT_PER_MINUTE ?? 240, "EVIDENCE_ROOM_SESSION_LIMIT_PER_MINUTE");
  const participantOperationLimit = positiveInteger(options.participantOperationLimit ?? env.EVIDENCE_ROOM_PARTICIPANT_OPERATION_LIMIT_PER_MINUTE ?? 12, "EVIDENCE_ROOM_PARTICIPANT_OPERATION_LIMIT_PER_MINUTE");
  const globalOperationLimit = positiveInteger(options.globalOperationLimit ?? env.EVIDENCE_ROOM_GLOBAL_OPERATION_LIMIT_PER_MINUTE ?? 240, "EVIDENCE_ROOM_GLOBAL_OPERATION_LIMIT_PER_MINUTE");
  const maxExpensiveConcurrency = positiveInteger(options.maxExpensiveConcurrency ?? env.EVIDENCE_ROOM_MAX_EXPENSIVE_CONCURRENCY ?? 1, "EVIDENCE_ROOM_MAX_EXPENSIVE_CONCURRENCY");
  const operationTimeoutMs = positiveInteger(options.operationTimeoutMs ?? env.EVIDENCE_ROOM_OPERATION_TIMEOUT_MS ?? 40_000, "EVIDENCE_ROOM_OPERATION_TIMEOUT_MS");
  const operationLeaseMs = positiveInteger(options.operationLeaseMs ?? env.EVIDENCE_ROOM_OPERATION_LEASE_MS ?? 60_000, "EVIDENCE_ROOM_OPERATION_LEASE_MS");
  const healthCacheMs = positiveInteger(options.healthCacheMs ?? env.EVIDENCE_ROOM_HEALTH_CACHE_MS ?? 15_000, "EVIDENCE_ROOM_HEALTH_CACHE_MS");
  if (operationLeaseMs > 120_000) throw new Error("EVIDENCE_ROOM_OPERATION_LEASE_MS must not exceed 120000");
  if (operationLeaseMs <= operationTimeoutMs) throw new Error("EVIDENCE_ROOM_OPERATION_LEASE_MS must exceed EVIDENCE_ROOM_OPERATION_TIMEOUT_MS");
  const reportSolve = options.reportSolve || ((identity, sourceId, occurredAt) => reportSolveEventBestEffort({ url: env.LEADERBOARD_INGEST_URL, secret: ticketSecret, challenge: "evidence-room", eventId: store.eventGeneration, participantId: identity.participantId, sourceId, occurredAt, timeoutMs: 1_500 }));
  let healthCache = null;
  let healthProbe = null;
  const localActiveParticipants = new Set();
  let localActiveOperations = 0;

  async function readHealth() {
    if (healthCache && healthCache.expiresAt > Date.now()) return healthCache.value;
    if (!healthProbe) {
      healthProbe = Promise.allSettled([
        chain.health(),
        typeof store.health === "function" ? store.health() : Promise.resolve({ ok: true }),
      ]).then(([chainResult, storeResult]) => {
        const chainHealth = chainResult.status === "fulfilled" ? chainResult.value : { ok: false, error: "chain unavailable" };
        const storeHealth = storeResult.status === "fulfilled" ? storeResult.value : { ok: false, error: "store unavailable" };
        const value = { chainHealth, storeHealth, ok: chainHealth.ok === true && storeHealth.ok === true };
        healthCache = { value, expiresAt: Date.now() + healthCacheMs };
        return value;
      }).finally(() => { healthProbe = null; });
    }
    return healthProbe;
  }

  const server = http.createServer((request, response) => handle(request, response).catch((error) => {
    const status = error instanceof HttpError ? error.status : 500;
    if (status === 500) console.error("evidence-room", error);
    json(response, status, { error: status === 500 ? "internal server error" : error.message }, error.retryAfter ? { "retry-after": String(error.retryAfter) } : {});
  }));

  let tickRunning = false;
  const scheduler = setInterval(() => tick().catch((error) => console.error("evidence-room scheduler", error)), 10_000);
  scheduler.unref();

  async function tick() {
    if (tickRunning) return;
    tickRunning = true;
    try {
      await runBounded(await store.participantIds(), Math.min(schedulerConcurrency, maxExpensiveConcurrency), async (participantId) => {
        const lease = await store.acquireOperation(participantId, { ttlMs: operationLeaseMs, maxConcurrency: maxExpensiveConcurrency });
        if (!lease) return;
        try {
          await withParticipant(participantId, async () => {
            const instance = await store.getInstance(participantId);
            if (!instance || instance.completedAt) return;
            const changed = await advance(instance);
            if (changed) await store.putInstance(participantId, instance);
          });
        } catch (error) {
          console.warn("evidence-room chain poll deferred", String(error?.message || error).slice(0, 180));
        } finally {
          await store.releaseOperation(lease);
        }
      });
    } finally {
      tickRunning = false;
    }
  }

  async function advance(instance) {
    let changed = false;
    for (const batch of instance.batches) {
      if (batch.status === "allocating") {
        changed = await settleAllocation(instance, batch) || changed;
      }
      if (batch.status !== "allocated" && batch.status !== "factory-failed") continue;
      if (!batch.capture) {
        const target = await chain.inspect(batch.target);
        if (target.token?.state === 1 && target.token.authority === instance.wallet && target.token.mint === instance.factoryMint) {
          batch.capture = { observedAt: new Date().toISOString(), mint: target.token.mint };
          changed = true;
        } else if ((target.token?.state === 1 || !target.exists) && await classifyInterference(instance, batch, batch.target, "target state changed before factory processing")) {
          changed = true;
          continue;
        }
      }
      if (batch.status === "allocated" && Date.now() >= batch.initializeAt) {
        const result = await chain.finalize(instance.participantId, instance.nonce, batch.sequence);
        batch.factory = { at: new Date().toISOString(), ...result };
        if (result.ok) batch.status = "live";
        else if (result.failure === "already-initialized" && result.signature && Number.isSafeInteger(result.slot)) {
          batch.status = "factory-failed";
          if (!batch.capture && await classifyInterference(instance, batch, batch.target, "target was initialized by another transaction")) {
            changed = true;
            continue;
          }
        }
        else throw new Error("factory initialization did not return a verified finalized result");
        changed = true;
      }
      if (batch.status === "factory-failed" && batch.capture && !batch.closeSignature) {
        const target = await chain.inspect(batch.target);
        if (!target.exists) {
          const close = await chain.findClose(batch.target, instance.wallet, [batch.allocationSignature, batch.factory?.signature].filter(Boolean));
          if (close) {
            if (!close.signature || !Number.isSafeInteger(close.blockTime)) throw new Error("close transaction lacks finalized time evidence");
            let participantTouchedDecoy = false;
            let thirdPartyTouchedDecoy = false;
            for (const address of batch.decoys) {
              const activity = await readActivity(address, [batch.allocationSignature], instance.wallet);
              participantTouchedDecoy ||= activity.participantSigned;
              thirdPartyTouchedDecoy ||= activity.external && !activity.participantSigned;
            }
            batch.closeSignature = close.signature;
            batch.closeSlot = close.slot;
            batch.capturedAt = new Date(close.blockTime * 1_000).toISOString();
            batch.decoyTouched = participantTouchedDecoy || thirdPartyTouchedDecoy;
            if (participantTouchedDecoy) batch.status = "invalid";
            else if (thirdPartyTouchedDecoy) markInterference(instance, batch, "a decoy was changed by a transaction not signed by the event wallet");
            else batch.status = "captured";
            changed = true;
          }
        }
      }
      const resolveBy = Number(batch.resolveBy || (batch.initializeAt + captureGraceMs));
      if (batch.status === "factory-failed" && Date.now() >= resolveBy) {
        batch.status = "invalid";
        changed = true;
      }
    }
    const captured = instance.batches.filter((batch) => batch.status === "captured");
    if (!instance.completedAt && captured.length >= 1) {
      const completedAt = captured.map((row) => row.capturedAt).filter(Boolean).sort()[0];
      if (!completedAt) throw new Error("captured case lacks finalized completion time");
      instance.completedAt = completedAt;
      instance.receipt = crypto.createHmac("sha256", completionSecret).update(`evidence-room:${instance.participantId}:${captured.map((row) => row.id).join(",")}`).digest("base64url").slice(0, 24);
      await reportSolve(instance, `evidence-room:${instance.participantId}:${instance.receipt}`, completedAt);
      changed = true;
    }
    return changed;
  }

  async function settleAllocation(instance, batch) {
    try {
      const allocation = await chain.allocate(instance.participantId, instance.nonce, batch.sequence);
      const allocatedAt = new Date().toISOString();
      Object.assign(batch, allocation, {
        allocatedAt,
        initializeAt: Date.now() + windowMs,
        resolveBy: Date.now() + windowMs + captureGraceMs,
        status: "allocated",
      });
      return true;
    } catch (error) {
      if (error?.code !== "allocation_interference") throw error;
      markInterference(instance, batch, String(error.message || "case allocation was interfered with"));
      return true;
    }
  }

  async function classifyInterference(instance, batch, address, reason) {
    const activity = await readActivity(address, [batch.allocationSignature, batch.factory?.signature].filter(Boolean), instance.wallet);
    if (!activity.external) return false;
    if (activity.participantSigned) {
      batch.status = "invalid";
      batch.interference = { at: new Date().toISOString(), reason, classifiedAs: "participant-signed" };
    } else {
      markInterference(instance, batch, reason);
    }
    return true;
  }

  async function readActivity(address, knownSignatures, participantSigner) {
    if (typeof chain.activity === "function") return chain.activity(address, knownSignatures, participantSigner);
    const external = typeof chain.hasExternalActivity === "function"
      ? await chain.hasExternalActivity(address, knownSignatures)
      : false;
    // Older adapters cannot prove signer identity, so they never receive an
    // interference credit. This is deliberately conservative against abuse.
    return { external, participantSigned: external, signatures: [] };
  }

  function markInterference(instance, batch, reason) {
    const creditsUsed = instance.batches.filter((row) => row !== batch && row.budgetExempt === true).length;
    batch.status = "interfered";
    batch.budgetExempt = creditsUsed < interferenceCredits;
    batch.interference = {
      at: new Date().toISOString(),
      reason,
      classifiedAs: "not-signed-by-event-wallet",
      budgetExempt: batch.budgetExempt,
    };
  }

  async function enforceRate(scope, identifier, limit) {
    const result = await store.rateLimit(scope, identifier, limit);
    if (!result.allowed) throw new HttpError(429, "request limit reached; try again shortly", result.retryAfter || 60);
  }

  async function withExpensiveOperation(participantId, kind, operation) {
    await Promise.all([
      enforceRate(`participant-${kind}`, participantId, participantOperationLimit),
      enforceRate("global-operation", "all", globalOperationLimit),
    ]);
    if (localActiveParticipants.has(participantId) || localActiveOperations >= maxExpensiveConcurrency) {
      throw new HttpError(429, "an operation is already running or service capacity is full", 2);
    }
    localActiveParticipants.add(participantId);
    localActiveOperations += 1;
    let lease;
    try {
      lease = await store.acquireOperation(participantId, { ttlMs: operationLeaseMs, maxConcurrency: maxExpensiveConcurrency });
    } catch (error) {
      localActiveParticipants.delete(participantId);
      localActiveOperations -= 1;
      throw error;
    }
    if (!lease) {
      localActiveParticipants.delete(participantId);
      localActiveOperations -= 1;
      throw new HttpError(429, "an operation is already running or service capacity is full", 2);
    }
    const release = async () => {
      try { await store.releaseOperation(lease); }
      finally {
        localActiveParticipants.delete(participantId);
        localActiveOperations -= 1;
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
    const url = new URL(request.url, "http://evidence-room.local");
    if (request.method === "GET" && url.pathname === "/health") {
      const { chainHealth, storeHealth, ok } = await readHealth();
      return json(response, ok ? 200 : 503, { ok, challenge: "evidence-room", chain: chainHealth, store: { mode: store.mode, ...storeHealth } });
    }
    if (request.method === "GET" && policyPaths.has(url.pathname)) {
      const identity = await optionalIdentity(request);
      if (identity) await integrityEvent(identity, "policy-read", "policy", request, "policy");
      const policy = identity ? policyFor({ challenge: "evidence-room", participantId: identity.participantId }, { markerSecret: policySecret, label: "EVIDENCE ROOM" }) : null;
      return text(response, 200, policy?.text || publicPolicyFor({ label: "EVIDENCE ROOM" }));
    }
    if (request.method === "GET" && ["/", "/app.js", "/bank-scene.js", "/style.css"].includes(url.pathname)) { const identity = await optionalIdentity(request); if (identity) await integrityEvent(identity, `interface:${url.pathname === "/" ? "index.html" : url.pathname.slice(1)}`, "interface", request, "direct-http"); return staticFile(response, WEB, url.pathname === "/" ? "index.html" : url.pathname.slice(1)); }
    if (request.method === "GET" && ["/three.module.js", "/three.core.js"].includes(url.pathname)) return staticFile(response, THREE, url.pathname.slice(1));
    if (request.method === "GET" && url.pathname.startsWith("/player-kit/")) return staticFile(response, KIT, path.basename(url.pathname));
    if (request.method === "POST" && url.pathname === "/api/session") return createSession(request, response);
    if (request.method === "GET" && url.pathname === "/api/completion") return completionStatus(request, response, url);

    const identity = await authenticate(request);
    let instance = await store.getInstance(identity.participantId);
    if (!instance) throw new HttpError(409, "challenge instance is unavailable");
    if (request.method === "POST" && url.pathname === "/api/ui-event") {
      const body = await readJson(request);
      if (!new Set(["app-boot", "automation-present"]).has(body.event)) throw new HttpError(400, "unknown UI event");
      await audit(identity, `ui:${body.event}`, request);
      return json(response, 202, { recorded: true });
    }
    if (request.method === "POST" && url.pathname === "/api/agent-disclosure") {
      const body = await readJson(request);
      if (!verifyMarker({ challenge: "evidence-room", participantId: identity.participantId }, body.marker, policySecret)) throw new HttpError(400, "invalid disclosure marker");
      const result = await forwardDisclosure({ identity, challenge: "evidence-room", label: "EVIDENCE ROOM", agent: body.agent, model: body.model, requestMeta: { source: "evidence-room-agent-policy", userAgent: String(request.headers["user-agent"] || "") } }, env, options.fetchImpl || fetch);
      await audit(identity, "agent-disclosure", request, { caseId: result.caseId });
      return json(response, 202, result);
    }
    if (request.method === "GET" && url.pathname === "/api/state") {
      return json(response, 200, publicState(instance, chain, maxBatches));
    }
    if (request.method === "GET" && url.pathname === "/api/event-wallet") {
      await audit(identity, "event-wallet-revealed", request);
      response.writeHead(200, { "content-type": "application/json", "content-disposition": "attachment; filename=evidence-room-key.json", "cache-control": "no-store" });
      const secretKey = bs58.encode(Uint8Array.from(chain.walletSecret(identity.participantId, instance.nonce)));
      return response.end(JSON.stringify({ secretKey }));
    }
    if (request.method === "POST" && url.pathname === "/api/batches") {
      const body = await readJson(request);
      assertAllowedKeys(body, []);
      const batch = await withExpensiveOperation(identity.participantId, "batch", () => withParticipant(identity.participantId, async () => {
        instance = await store.getInstance(identity.participantId);
        if (instance.completedAt) throw new HttpError(409, "casework is complete");
        if (fundedBatchCount(instance) >= maxBatches) throw new HttpError(429, "case limit reached; ask an event operator for help");
        if (instance.batches.some((row) => ["allocating", "allocated", "factory-failed"].includes(row.status))) throw new HttpError(409, "wait for the active batch to resolve");
        const latest = instance.batches.filter(countsTowardBudget).at(-1);
        const retryIn = latest ? batchCooldownMs - (Date.now() - new Date(latest.allocatedAt).getTime()) : 0;
        if (retryIn > 0) throw new HttpError(429, `desk is resetting; retry in ${Math.ceil(retryIn / 1_000)}s`);
        const sequence = Math.max(0, ...instance.batches.map((row) => Number(row.sequence) || 0)) + 1;
        const created = {
          id: crypto.randomUUID(), sequence, requestedAt: new Date().toISOString(), status: "allocating",
          capture: null, factory: null, closeSignature: null, decoyTouched: false, budgetExempt: false,
        };
        // Persist the deterministic intent before broadcasting. A crash after
        // the transaction lands is reconciled by the scheduler instead of
        // silently burning one of the participant's funded cases.
        instance.batches.push(created);
        await store.putInstance(identity.participantId, instance);
        try {
          await settleAllocation(instance, created);
          await store.putInstance(identity.participantId, instance);
        } catch (error) {
          console.warn("evidence-room allocation deferred", String(error?.message || error).slice(0, 180));
        }
        return created;
      }));
      await audit(identity, batch.status === "allocated" ? "batch:allocated" : "batch:allocation-pending", request, { batchId: batch.id, sequence: batch.sequence, status: batch.status });
      return json(response, batch.status === "allocated" ? 201 : 202, publicBatch(batch));
    }
    throw new HttpError(404, "not found");
  }

  async function createSession(request, response) {
    await enforceRate("session-preauth-ip", clientRateKey(request), preAuthIpLimit);
    await enforceRate("session-preauth-global", "all", preAuthGlobalLimit);
    const body = await readJson(request); let identity; let launchTicket = null;
    assertAllowedKeys(body, body.ticket ? ["ticket"] : ["participantId"]);
    if (body.ticket && ticketSecret) {
      try { const claims = verifyParticipantTicket(body.ticket, ticketSecret, { audience: "evidence-room", eventId: store.eventGeneration }); identity = { participantId: claims.participant_id, eventId: claims.event_id, launchMode: "portal" }; launchTicket = body.ticket; }
      catch (error) { if (error instanceof ParticipantTicketError) throw new HttpError(401, error.message); throw error; }
    } else if (allowDev) {
      const participantId = String(body.participantId || "local-evidence-room"); if (!/^[A-Za-z0-9_-]{1,128}$/.test(participantId)) throw new HttpError(400, "invalid participant ID"); identity = { participantId, eventId: store.eventGeneration, launchMode: "development" };
    } else throw new HttpError(401, "a portal launch ticket is required");
    await enforceRate("session", "global", sessionLimit);
    const reserved = await store.getInstance(identity.participantId);
    if (reserved && reserved.allocationStatus !== "provisioning") {
      if (launchTicket) await consumeLaunchTicket(launchTicket);
    } else {
      await withExpensiveOperation(identity.participantId, "provision", () => withParticipant(identity.participantId, async () => {
        const existing = await store.getInstance(identity.participantId);
        if (existing && existing.allocationStatus !== "provisioning") {
          if (launchTicket) await consumeLaunchTicket(launchTicket);
          return;
        }
        if (launchTicket) await consumeLaunchTicket(launchTicket);
        const nonce = existing?.nonce || crypto.randomBytes(12).toString("hex");
        if (!existing) {
          await store.putInstance(identity.participantId, {
            ...identity,
            nonce,
            allocationStatus: "provisioning",
            reservedAt: new Date().toISOString(),
            batches: [],
            completedAt: null,
            receipt: null,
          });
        }
        const provision = await chain.provision(identity.participantId, nonce);
        await store.putInstance(identity.participantId, { ...identity, nonce, allocationStatus: "ready", ...provision, batches: [], completedAt: null, receipt: null });
      }));
    }
    const id = crypto.randomBytes(24).toString("base64url"); await store.putSession(id, identity); await store.audit(identity.participantId, { at: Date.now(), event: "session-created", participantId: identity.participantId, source: "direct-http" }); await integrityEvent(identity, "interface:session", "interface", request, "direct-http");
    response.setHeader("set-cookie", `${COOKIE}=${sign(id, sessionSecret)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=43200${env.NODE_ENV === "production" ? "; Secure" : ""}`);
    return json(response, 201, { participantId: identity.participantId });
  }

  async function consumeLaunchTicket(ticket) {
    try {
      return await consumeParticipantTicket(ticket, ticketSecret, {
        audience: "evidence-room",
        eventId: store.eventGeneration,
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
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(participantId)) throw new HttpError(400, "invalid participant ID");
    const instance = await store.getInstance(participantId);
    return json(response, 200, { completed: Boolean(instance?.completedAt), completedAt: instance?.completedAt || null, eventGeneration: store.eventGeneration });
  }
  async function authenticate(request) { const id = verify(parseCookies(request.headers.cookie || "")[COOKIE], sessionSecret); if (!id) throw new HttpError(401, "launch authentication is required"); const identity = await store.getSession(id); if (!identity) throw new HttpError(401, "session expired"); return identity; }
  async function optionalIdentity(request) { try { return await authenticate(request); } catch { return null; } }
  async function integrityEvent(identity, event, category, request, source) { await forwardIntegrityEvent({ identity, challenge: "evidence-room", label: "EVIDENCE ROOM", action: event, category, source, request }, env, options.fetchImpl || fetch).catch((error) => console.warn("EVIDENCE ROOM integrity event deferred", error.message)); }
  async function audit(identity, event, request, detail = {}) { const source = request.headers?.["x-evidence-room-ui"] === "console" ? "browser-ui" : "direct-http"; const category = event.startsWith("ui:") ? "ui" : event.includes("captured") || event === "completion-verified" ? "completion" : event.includes("allocated") || event === "event-wallet-revealed" ? "challenge-action" : "activity"; await store.audit(identity.participantId, { at: Date.now(), event, participantId: identity.participantId, source, ...detail }); await integrityEvent(identity, event, category, request, source); }

  return { server, store, async tick() { await tick(); }, listen(port = 0) { return new Promise((resolve) => server.listen(port, () => resolve(server.address()))); }, close() { clearInterval(scheduler); return new Promise((resolve, reject) => server.close(async (error) => { await store.close(); error ? reject(error) : resolve(); })); } };
}

function publicState(instance, chain, maxBatches) { return { challenge: "evidence-room", network: chain.network, wallet: instance.wallet, factoryMint: instance.factoryMint, completedAt: instance.completedAt, batches: instance.batches.map(publicBatch), resolvedCases: instance.batches.filter((batch) => batch.status === "captured").length, maxCases: maxBatches, casesRemaining: Math.max(0, maxBatches - fundedBatchCount(instance)) }; }
function publicBatch(batch) { return { id: batch.id, sequence: batch.sequence, allocatedAt: batch.allocatedAt || batch.requestedAt, initializeAt: batch.initializeAt || null, status: batch.status, allocationSignature: batch.allocationSignature || null, accounts: batch.accounts || [], factory: batch.factory ? { ok: batch.factory.ok, at: batch.factory.at } : null, captured: batch.status === "captured", invalid: batch.status === "invalid", interfered: batch.status === "interfered" }; }
function countsTowardBudget(batch) { return batch.status !== "allocating" && batch.budgetExempt !== true; }
function fundedBatchCount(instance) { return instance.batches.filter(countsTowardBudget).length; }
function sign(id, secret) { return `${id}.${crypto.createHmac("sha256", secret).update(id).digest("base64url")}`; }
function verify(value, secret) { const [id, mac, extra] = String(value || "").split("."); if (!id || !mac || extra) return null; const expected = crypto.createHmac("sha256", secret).update(id).digest(); let actual; try { actual = Buffer.from(mac, "base64url"); } catch { return null; } return actual.length === expected.length && crypto.timingSafeEqual(actual, expected) ? id : null; }
function clientRateKey(request) { return crypto.createHash("sha256").update(trustedClientAddress(request)).digest("base64url").slice(0, 24); }
async function withParticipant(participantId, operation) { const previous = participantQueues.get(participantId) || Promise.resolve(); const current = previous.catch(() => {}).then(operation); participantQueues.set(participantId, current); try { return await current; } finally { if (participantQueues.get(participantId) === current) participantQueues.delete(participantId); } }
function requiredSecret(value, name, optional = false) { if (optional && !value) return null; if (typeof value !== "string" || Buffer.byteLength(value) < 32) throw new Error(`${name} must contain at least 32 bytes`); return value; }
function positiveInteger(value, name) { const number = Number(value); if (!Number.isSafeInteger(number) || number < 1) throw new Error(`${name} must be a positive integer`); return number; }
function nonNegativeInteger(value, name) { const number = Number(value); if (!Number.isSafeInteger(number) || number < 0) throw new Error(`${name} must be a non-negative integer`); return number; }
async function runBounded(items, limit, operation) {
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      await operation(items[index]);
    }
  });
  await Promise.all(workers);
}
function authorized(request, secret) { if (!secret) return false; const value = String(request.headers.authorization || ""); const supplied = value.startsWith("Bearer ") ? Buffer.from(value.slice(7)) : null; const expected = Buffer.from(secret); return supplied && supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected); }
function parseCookies(value) { return Object.fromEntries(value.split(";").map((part) => part.trim().split("=")).filter(([key, val]) => key && val)); }
async function readJson(request) { const chunks = []; let size = 0; for await (const chunk of request) { size += chunk.length; if (size > MAX_BODY) throw new HttpError(413, "request too large"); chunks.push(chunk); } try { return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); } catch { throw new HttpError(400, "invalid JSON"); } }
function assertAllowedKeys(body, allowed) { if (!body || typeof body !== "object" || Array.isArray(body)) throw new HttpError(400, "request body must be an object"); const unexpected = Object.keys(body).filter((key) => !allowed.includes(key)); if (unexpected.length) throw new HttpError(400, "request contains unexpected fields"); }
async function staticFile(response, root, file) { const safe = path.basename(file); const body = await fs.readFile(path.join(root, safe)); const type = safe.endsWith(".css") ? "text/css; charset=utf-8" : safe.endsWith(".js") ? "text/javascript; charset=utf-8" : safe.endsWith(".json") ? "application/json; charset=utf-8" : safe.endsWith(".webp") ? "image/webp" : "text/html; charset=utf-8"; response.writeHead(200, { "content-type": type, "cache-control": safe.endsWith(".webp") ? "public, max-age=86400" : "no-store" }); response.end(body); }
function security(response) { response.setHeader("content-security-policy", "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"); response.setHeader("x-content-type-options", "nosniff"); response.setHeader("referrer-policy", "no-referrer"); }
function json(response, status, body, headers = {}) { response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers }); response.end(JSON.stringify(body)); }
function text(response, status, body) { response.writeHead(status, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" }); response.end(body); }

if (process.argv[1] === fileURLToPath(import.meta.url)) { const service = await createEvidenceRoomServer(); const port = Number(process.env.PORT || 3009); await service.listen(port); console.log(`EVIDENCE ROOM listening on ${port}`); }
