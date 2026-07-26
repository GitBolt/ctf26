import crypto from "node:crypto";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { consumeParticipantTicket, ParticipantTicketError, verifyParticipantTicket } from "@ctf26/participant-ticket";
import { forwardDisclosure, forwardIntegrityEvent, policyFor, publicPolicyFor, verifyMarker } from "@ctf26/agent-integrity";
import { eventGeneration, reportSolveEventBestEffort } from "@ctf26/leaderboard";
import { trustedClientAddress } from "@ctf26/request-budget";

import { createDevnetChain, explorerTransaction } from "./devnet-chain.mjs";
import { completionFor, createInstance, openJackpot, publicCabinet } from "./model.mjs";
import { createStore } from "./store.mjs";

const WEB_ROOT = fileURLToPath(new URL("../web/", import.meta.url));
const STATIC = new Map([["/", ["index.html", "text/html; charset=utf-8"]], ["/app.js", ["app.js", "text/javascript; charset=utf-8"]], ["/style.css", ["style.css", "text/css; charset=utf-8"]], ["/celebration.css", ["celebration.css", "text/css; charset=utf-8"]]]);
STATIC.set("/assets/co-op-jackpot-stage-v2.png", ["assets/co-op-jackpot-stage-v2.png", "image/png"]);
STATIC.set("/assets/jackpot-win.mp3", ["assets/jackpot-win.mp3", "audio/mpeg"]);
const COOKIE = "player_two_session";
const MAX_BODY = 16 * 1024;
const participantQueues = new Map();

class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
const requiredSecret = (value, name, optional = false) => {
  if (optional && !value) return null;
  if (typeof value !== "string" || Buffer.byteLength(value) < 32) throw new Error(`${name} must contain at least 32 bytes`);
  return value;
};

export async function createPlayerTwoServer(options = {}) {
  const env = options.env || process.env;
  const generation = eventGeneration(env);
  const production = env.NODE_ENV === "production";
  const store = options.store || await createStore(env);
  const ticketSecret = requiredSecret(options.ticketSecret ?? env.PARTICIPANT_TICKET_SECRET, "participant ticket secret", !production);
  const sessionSecret = requiredSecret(options.sessionSecret ?? env.SESSION_SECRET ?? (production ? null : "dev-player-two-session-secret-32-bytes"), "session secret");
  const policySecret = requiredSecret(options.policySecret ?? env.AGENT_POLICY_SECRET ?? (production ? null : "dev-player-two-policy-secret-32-bytes!"), "agent policy secret");
  const completionSecret = requiredSecret(options.completionSecret ?? env.COMPLETION_SECRET ?? (production ? null : "dev-player-two-completion-secret-32b"), "completion secret");
  if (production && (options.allowDev === true || env.ALLOW_DEV_LAUNCH === "true")) throw new Error("development launch mode is not allowed in production");
  const allowDev = !production && (options.allowDev ?? (env.ALLOW_DEV_LAUNCH === "true" || !ticketSecret));
  const chain = options.chain || createDevnetChain(env);
  const sessionRateMax = boundedInteger(env.PLAYER_TWO_SESSION_RATE_MAX, 4, 1, 30, "PLAYER_TWO_SESSION_RATE_MAX");
  const actionRateMax = boundedInteger(env.PLAYER_TWO_ACTION_RATE_MAX, 30, 1, 300, "PLAYER_TWO_ACTION_RATE_MAX");
  const maxActiveProvisions = boundedInteger(env.PLAYER_TWO_MAX_ACTIVE_PROVISIONS, 8, 1, 24, "PLAYER_TWO_MAX_ACTIVE_PROVISIONS");
  const maxActiveChainActions = boundedInteger(env.PLAYER_TWO_MAX_ACTIVE_CHAIN_ACTIONS, 24, 1, 80, "PLAYER_TWO_MAX_ACTIVE_CHAIN_ACTIONS");
  const feeBufferLamportsPerParticipant = requiredProductionInteger(env, "PLAYER_TWO_PROVISION_FEE_BUFFER_LAMPORTS", 150_000, 1, Number.MAX_SAFE_INTEGER);
  const reportSolve = options.reportSolve || ((identity, sourceId) => reportSolveEventBestEffort({
    url: env.LEADERBOARD_INGEST_URL,
    secret: ticketSecret,
    challenge: "player-two",
    eventId: generation,
    participantId: identity.participantId,
    sourceId,
    timeoutMs: 1_500,
  }));
  const health = cachedProbe(async () => {
    const base = { store: store.mode, challenge: "player-two", network: chain.network, programId: chain.programId };
    try {
      const [storageHealthy, provisionedInstances] = await Promise.all([
        typeof store.health === "function" ? store.health() : Promise.resolve(false),
        store.provisionedInstanceCount(),
      ]);
      const chainHealth = await chain.health({ remainingParticipants: 1, feeBufferLamportsPerParticipant });
      const ok = Boolean(chainHealth.ok && storageHealthy);
      return {
        status: ok ? 200 : 503,
        body: {
          ...base,
          ok,
          storageHealthy,
          programAvailable: chainHealth.programAvailable !== false,
          capacity: {
            reachable: true,
            provisionedInstances,
            availableProvisionSlots: chainHealth.availableProvisionSlots,
            maxParticipants: Number.isSafeInteger(chainHealth.availableProvisionSlots)
              ? provisionedInstances + chainHealth.availableProvisionSlots
              : null,
            sufficient: chainHealth.capacitySufficient !== false,
          },
          funding: {
            payer: chainHealth.payer,
            requiredBalance: chainHealth.requiredPayerBalance,
          },
        },
      };
    } catch (error) {
      console.error("PLAYER TWO capacity probe failed", error.message);
      return {
        status: 503,
        body: {
          ...base,
          ok: false,
          storageHealthy: false,
          capacity: { reachable: false },
        },
      };
    }
  });

  const server = http.createServer((request, response) => handle(request, response).catch((error) => {
    const status = error instanceof HttpError ? error.status : 500;
    if (status === 500) console.error(error);
    if (status === 429) response.setHeader("retry-after", String(error.retryAfterSeconds || 60));
    json(response, status, { error: status === 500 ? "internal server error" : error.message });
  }));

  async function handle(request, response) {
    security(response);
    const url = new URL(request.url, "http://player-two.local");
    if ((request.method === "GET" || request.method === "HEAD") && STATIC.has(url.pathname)) {
      const [file, type] = STATIC.get(url.pathname);
      const identity = await optionalIdentity(request);
      if (identity && request.method === "GET") await integrityEvent(identity, `interface:${file}`, "interface", request, "direct-http");
      const body = await fs.readFile(path.join(WEB_ROOT, file));
      response.writeHead(200, { "content-type": type, "cache-control": "no-store" });
      response.end(request.method === "HEAD" ? undefined : body); return;
    }
    if (request.method === "GET" && url.pathname === "/health") {
      const result = await health();
      return json(response, result.status, result.body);
    }
    if (request.method === "GET" && url.pathname === "/api/completion") {
      if (!bearerAuthorized(request, ticketSecret)) throw new HttpError(401, "not authorized");
      const participantId = String(url.searchParams.get("participantId") || "");
      if (!/^[a-zA-Z0-9_-]{1,128}$/.test(participantId)) throw new HttpError(400, "invalid participant ID");
      const instance = await withExpensiveSlot("chain-action", participantId, 15_000, maxActiveChainActions, () => withParticipant(participantId, async () => {
        const current = await store.getInstance(participantId);
        if (!isProvisionedInstance(current)) return current;
        if (await withTimeout(reconcileJackpot(current), 8_000, "completion reconciliation timed out", true)) await store.putInstance(participantId, current);
        return current;
      }));
      return json(response, 200, instance?.openedAt
        ? { completed: true, completedAt: new Date(instance.openedAt).toISOString(), eventGeneration: generation }
        : { completed: false, eventGeneration: generation });
    }
    if (request.method === "GET" && new Set(["/robots.txt", "/agents.txt", "/llms.txt", "/.well-known/agents.txt"]).has(url.pathname)) {
      const identity = await optionalIdentity(request);
      if (identity) await integrityEvent(identity, "policy-read", "policy", request, "policy");
      const policy = identity ? policyFor({ challenge: "player-two", participantId: identity.participantId }, { markerSecret: policySecret, label: "PLAYER TWO" }) : null;
      return text(response, 200, policy?.text || publicPolicyFor({ label: "PLAYER TWO" }));
    }
    if (request.method === "POST" && url.pathname === "/api/session") {
      await enforceRate(`session-ip:${clientAddress(request)}`, 120, 60_000);
      const body = await readJson(request);
      let identity;
      let launchTicket = null;
      if (body.ticket && ticketSecret) {
        try {
          const claims = verifyParticipantTicket(body.ticket, ticketSecret, { audience: "player-two", eventId: generation });
          identity = { participantId: claims.participant_id, eventId: claims.event_id, launchMode: "portal" };
          launchTicket = body.ticket;
        } catch (error) {
          if (error instanceof ParticipantTicketError) throw new HttpError(401, error.message);
          throw error;
        }
      } else if (allowDev) {
        const participantId = String(body.participantId || "local-player");
        if (!/^[a-zA-Z0-9_-]{1,128}$/.test(participantId)) throw new HttpError(400, "invalid participant ID");
        identity = { participantId, eventId: generation, launchMode: "development" };
      } else throw new HttpError(401, "a portal launch ticket is required");
      await enforceRate(`session:${identity.participantId}`, sessionRateMax, 60_000);
      const id = crypto.randomBytes(24).toString("base64url");
      const existing = await store.getInstance(identity.participantId);
      if (existing && existing.allocationStatus !== "allocating") {
        if (launchTicket) await consumeLaunchTicket(launchTicket);
      } else await withExpensiveSlot("provision", identity.participantId, 60_000, maxActiveProvisions, () => withParticipant(identity.participantId, async () => {
        const current = await store.getInstance(identity.participantId);
        if (current && current.allocationStatus !== "allocating") {
          if (launchTicket) await consumeLaunchTicket(launchTicket);
          return;
        }
        if (!current) {
          const capacity = await chain.health({ remainingParticipants: 1, feeBufferLamportsPerParticipant });
          if (!capacity.ok || capacity.capacitySufficient === false) throw new HttpError(503, "event provisioning capacity is temporarily unavailable");
        }
        if (launchTicket) await consumeLaunchTicket(launchTicket);
        const eventNonce = current?.eventNonce || crypto.randomBytes(12).toString("hex");
        if (!current) {
          await store.putInstance(identity.participantId, {
            allocationStatus: "allocating",
            participantId: identity.participantId,
            eventNonce,
            reservedAt: new Date().toISOString(),
          });
        }
        const provisioned = await withTimeout(chain.provision(identity.participantId, eventNonce), 45_000, "cabinet provisioning timed out", true);
        await store.putInstance(identity.participantId, createInstance(identity.participantId, eventNonce, { ...provisioned, programId: chain.programId }));
      }));
      await store.putSession(id, identity);
      await audit(identity, "session-created", request, {}, "interface");
      response.setHeader("set-cookie", `${COOKIE}=${sign(id, sessionSecret)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=43200${env.NODE_ENV === "production" ? "; Secure" : ""}`);
      return json(response, 201, identity);
    }
    if (request.method === "POST" && url.pathname === "/api/agent-disclosure") {
      const identity = await authenticate(request);
      const body = await readJson(request);
      if (!verifyMarker({ challenge: "player-two", participantId: identity.participantId }, body.marker, policySecret)) throw new HttpError(400, "invalid disclosure marker");
      const result = await forwardDisclosure({ identity, challenge: "player-two", label: "PLAYER TWO", agent: body.agent, model: body.model, requestMeta: { source: "player-two-agent-policy", userAgent: String(request.headers["user-agent"] || "") } }, env, options.fetchImpl || fetch);
      await audit(identity, "agent-disclosure", request, { caseId: result.caseId, agent: String(body.agent || "").slice(0, 120), model: String(body.model || "").slice(0, 120) });
      return json(response, 202, result);
    }

    const identity = await authenticate(request);
    let instance = await store.getInstance(identity.participantId);
    if (!isProvisionedInstance(instance)) throw new HttpError(503, "cabinet provisioning is incomplete; relaunch the challenge");
    if (request.method === "GET" && url.pathname === "/api/cabinet") {
      await enforceRate(`cabinet:${identity.participantId}`, actionRateMax, 60_000);
      instance = await withExpensiveSlot("chain-action", identity.participantId, 15_000, maxActiveChainActions, () => withParticipant(identity.participantId, async () => {
        const current = await store.getInstance(identity.participantId);
        if (await withTimeout(reconcileJackpot(current), 8_000, "cabinet reconciliation timed out", true)) await store.putInstance(identity.participantId, current);
        return current;
      }));
      await audit(identity, "cabinet-read", request);
      return json(response, 200, publicCabinet(instance));
    }
    if (request.method === "POST" && url.pathname === "/api/ui-event") {
      await enforceRate(`ui:${identity.participantId}`, 120, 60_000);
      const body = await readJson(request);
      const allowed = new Set(["cabinet-ready", "automation-present", "receipt-pulled", "transaction-copied", "scanner-opened", "reader-changed", "lever-pulled"]);
      if (!allowed.has(body.event)) throw new HttpError(400, "unknown cabinet event");
      await audit(identity, `ui:${body.event}`, request, { detail: String(body.detail || "").slice(0, 160) }, "ui");
      return json(response, 202, { recorded: true });
    }
    if (request.method === "POST" && url.pathname === "/api/receipt") {
      await enforceRate(`receipt:${identity.participantId}`, actionRateMax, 60_000);
      await audit(identity, "receipt-inspected", request, {}, "challenge-action");
      return json(response, 200, { signature: instance.receiptSignature, network: "devnet", explorerUrl: explorerTransaction(instance.receiptSignature) });
    }
    if (request.method === "POST" && url.pathname === "/api/scan") {
      await enforceRate(`scan:${identity.participantId}`, actionRateMax, 60_000);
      const body = await readJson(request);
      const result = await withExpensiveSlot("chain-action", identity.participantId, 15_000, maxActiveChainActions, () => withTimeout(chain.inspectPass(body.address), 8_000, "account scan timed out", true));
      await audit(identity, "account-scanned", request, { address: result.address, found: result.found }, "challenge-action");
      return json(response, 200, { ...result, authorityMatch: result.found ? result.holder === instance.holder : false });
    }
    if (request.method === "POST" && url.pathname === "/api/jackpot") {
      await enforceRate(`jackpot:${identity.participantId}`, Math.min(actionRateMax, 12), 60_000);
      const body = await readJson(request);
      const result = await withExpensiveSlot("chain-action", identity.participantId, 45_000, maxActiveChainActions, () => withParticipant(identity.participantId, async () => {
        instance = await store.getInstance(identity.participantId);
        const recovered = await withTimeout(reconcileJackpot(instance), 8_000, "jackpot reconciliation timed out", true);
        if (instance.opened) {
          if (recovered) await store.putInstance(identity.participantId, instance);
          return {
            ok: true,
            code: "jackpot_open",
            message: recovered ? "Jackpot opening recovered from Devnet." : "This jackpot is already open.",
            completionReceipt: instance.completionReceipt,
            jackpotSignature: instance.jackpotSignature,
            explorerUrl: instance.jackpotSignature ? explorerTransaction(instance.jackpotSignature) : null,
            recovered,
          };
        }
        const candidate = structuredClone(instance);
        const outcome = openJackpot(candidate, { leftPass: String(body.leftPass || ""), rightPass: String(body.rightPass || ""), leftHolder: identityHolder(candidate, body.leftHolder), rightHolder: identityHolder(candidate, body.rightHolder) });
        if (outcome.ok) {
          const chainResult = await withTimeout(chain.openJackpot({ participantId: identity.participantId, eventNonce: instance.eventNonce, jackpot: instance.jackpot, firstPass: String(body.leftPass || ""), secondPass: String(body.rightPass || "") }), 30_000, "jackpot transaction timed out", true);
          candidate.jackpotSignature = chainResult.signature;
          instance = candidate;
          outcome.completionReceipt = completionFor(instance, completionSecret);
          outcome.jackpotSignature = chainResult.signature;
          outcome.explorerUrl = chainResult.explorerUrl;
        } else {
          instance.attempts = candidate.attempts;
        }
        await store.putInstance(identity.participantId, instance);
        return outcome;
      }));
      if (result.ok) await reportSolve(identity, result.jackpotSignature || `player-two:${identity.participantId}`);
      await audit(identity, "jackpot-attempt", request, { code: result.code, leftPass: String(body.leftPass || ""), rightPass: String(body.rightPass || "") }, result.ok ? "completion" : "scored-action");
      return json(response, result.ok ? 200 : 422, { ...result, cabinet: publicCabinet(instance) });
    }
    throw new HttpError(404, "not found");
  }

  async function reconcileJackpot(instance) {
    if (instance.opened) {
      const previousReceipt = instance.completionReceipt;
      completionFor(instance, completionSecret);
      return previousReceipt !== instance.completionReceipt;
    }
    const state = await chain.jackpotState(instance.jackpot);
    if (!state?.opened) return false;
    instance.opened = true;
    instance.openedAt = Number.isSafeInteger(state.openedAt) ? state.openedAt : Date.now();
    instance.jackpotSignature = state.signature || instance.jackpotSignature || null;
    completionFor(instance, completionSecret);
    return true;
  }

  function identityHolder(instance, value) { return String(value || instance.holder); }
  async function optionalIdentity(request) { try { return await authenticate(request); } catch { return null; } }
  async function authenticate(request) {
    const raw = parseCookies(request.headers.cookie || "")[COOKIE];
    const id = verify(raw, sessionSecret);
    if (!id) throw new HttpError(401, "launch authentication is required");
    const identity = await store.getSession(id);
    if (!identity) throw new HttpError(401, "session expired");
    return identity;
  }
  async function integrityEvent(identity, event, category, request, source) {
    await forwardIntegrityEvent({ identity, challenge: "player-two", label: "PLAYER TWO", action: event, category, source, request }, env, options.fetchImpl || fetch)
      .catch((error) => console.warn("PLAYER TWO integrity event deferred", error.message));
  }
  async function audit(identity, event, request, detail = {}, category = "activity") {
    const source = request.headers["x-player-two-ui"] === "cabinet" ? "browser-ui" : "direct-http";
    await store.audit(identity.participantId, { at: Date.now(), event, participantId: identity.participantId, source, ...detail });
    await integrityEvent(identity, event, category, request, source);
  }
  async function enforceRate(key, max, windowMs) {
    if (!await store.hitRate(key, Date.now(), max, windowMs)) throw rateError("too many requests", Math.ceil(windowMs / 1_000));
  }
  async function consumeLaunchTicket(ticket) {
    try {
      return await consumeParticipantTicket(ticket, ticketSecret, { audience: "player-two", eventId: generation, consumeJti: ({ jti, expiresAt }) => store.consumeTicket(jti, expiresAt) });
    } catch (error) {
      if (error instanceof ParticipantTicketError) throw new HttpError(401, error.message);
      throw error;
    }
  }
  async function withExpensiveSlot(scope, participantId, ttlMs, max, operation) {
    if (!await store.acquireSlot(scope, participantId, Date.now(), ttlMs, max)) throw rateError("challenge service is busy; retry shortly", 2);
    let release = true;
    try { return await operation(); }
    catch (error) { if (error.keepResourceSlot) release = false; throw error; }
    finally { if (release) await store.releaseSlot(scope, participantId); }
  }
  return { server, store, listen(port = 0) { return new Promise((resolve) => server.listen(port, () => resolve(server.address()))); }, close() { return new Promise((resolve, reject) => server.close(async (error) => { await store.close(); error ? reject(error) : resolve(); })); } };
}

function sign(id, secret) { return `${id}.${crypto.createHmac("sha256", secret).update(id).digest("base64url")}`; }
function verify(value, secret) { const [id, sig, extra] = String(value || "").split("."); if (!id || !sig || extra) return null; const expected = crypto.createHmac("sha256", secret).update(id).digest(); let actual; try { actual = Buffer.from(sig, "base64url"); } catch { return null; } return actual.length === expected.length && crypto.timingSafeEqual(actual, expected) ? id : null; }
async function withParticipant(participantId, operation) { const previous = participantQueues.get(participantId) || Promise.resolve(); const current = previous.catch(() => {}).then(operation); participantQueues.set(participantId, current); try { return await current; } finally { if (participantQueues.get(participantId) === current) participantQueues.delete(participantId); } }
function boundedInteger(value, fallback, minimum, maximum, name) { const parsed = value === undefined || value === "" ? fallback : Number(value); if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`); return parsed; }
function requiredProductionInteger(env, name, fallback, minimum, maximum) { if (env.NODE_ENV === "production" && String(env[name] || "").trim() === "") throw new Error(`${name} is required in production`); return boundedInteger(env[name], fallback, minimum, maximum, name); }
function clientAddress(request) { return trustedClientAddress(request); }
function rateError(message, retryAfterSeconds) { const error = new HttpError(429, message); error.retryAfterSeconds = retryAfterSeconds; return error; }
function withTimeout(promise, timeoutMs, message, keepResourceSlot = false) { let timer; return Promise.race([Promise.resolve(promise), new Promise((_, reject) => { timer = setTimeout(() => { const error = new HttpError(504, message); error.keepResourceSlot = keepResourceSlot; reject(error); }, timeoutMs); })]).finally(() => clearTimeout(timer)); }
function cachedProbe(probe, ttlMs = 15_000) { let cached = null; let inFlight = null; return async () => { const now = Date.now(); if (cached && cached.expiresAt > now) return cached.value; if (inFlight) return inFlight; inFlight = Promise.resolve().then(probe).then((value) => { cached = { value, expiresAt: Date.now() + ttlMs }; return value; }).finally(() => { inFlight = null; }); return inFlight; }; }
function bearerAuthorized(request, secret) { if (!secret) return false; const supplied = Buffer.from(String(request.headers.authorization || "").replace(/^Bearer /, "")); const expected = Buffer.from(secret); return supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected); }
function parseCookies(value) { return Object.fromEntries(value.split(";").map((part) => part.trim().split("=")).filter(([key, val]) => key && val)); }
function isProvisionedInstance(instance) { return Boolean(instance && instance.allocationStatus !== "allocating" && instance.jackpot && instance.receiptSignature); }
async function readJson(request) { return withTimeout((async () => { const chunks = []; let size = 0; for await (const chunk of request) { size += chunk.length; if (size > MAX_BODY) throw new HttpError(413, "request too large"); chunks.push(chunk); } try { return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); } catch { throw new HttpError(400, "invalid JSON"); } })(), 5_000, "request body timed out"); }
function security(response) { response.setHeader("content-security-policy", "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"); response.setHeader("x-content-type-options", "nosniff"); response.setHeader("referrer-policy", "no-referrer"); }
function json(response, status, body) { response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }); response.end(JSON.stringify(body)); }
function text(response, status, body) { response.writeHead(status, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" }); response.end(body); }

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const service = await createPlayerTwoServer();
  const port = Number(process.env.PORT || 3007);
  await service.listen(port);
  console.log(`PLAYER TWO listening on ${port}`);
}
