import crypto from "node:crypto";

import { checkOnchainSubmission, checkPreviewSubmission, checkRpcHealth, readTargetState, RpcError } from "./checker.mjs";
import {
  acquireSubmissionLease,
  completionForParticipant,
  enforceGlobalRateLimit,
  enforceParticipantSessionRateLimit,
  enforceSessionAttemptRateLimit,
  enforceSubmissionRateLimit,
  enforceTargetRateLimit,
  recordCompletion,
  redisCommand,
  releaseSubmissionLease,
} from "./redis.mjs";
import {
  AuthenticationError,
  exchangeLaunchTicket,
  identityFromRequest,
  sessionCookie,
} from "./session.mjs";
import { loadTargetForParticipant, loadTargetInventory, publicTarget } from "./targets.mjs";
import { ensureParticipantTarget, participantProvisionCapacity } from "./auto-provision.mjs";
import { forwardDisclosure, forwardIntegrityEvent, policyFor, publicPolicyFor, verifyMarker } from "@ctf26/agent-integrity";
import { eventGeneration, reportSolveEventBestEffort } from "@ctf26/leaderboard";
import { trustedClientAddress } from "@ctf26/request-budget";

const MAX_BODY_BYTES = 10_000;
const PARTICIPANT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const healthProbeCache = new WeakMap();

export function jsonResponse(response, statusCode, body, headers = {}) {
  response.statusCode = statusCode;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.setHeader("cache-control", "no-store");
  response.setHeader("x-content-type-options", "nosniff");
  response.setHeader("x-frame-options", "DENY");
  response.setHeader("referrer-policy", "no-referrer");
  response.setHeader("content-security-policy", "default-src 'none'; frame-ancestors 'none'; base-uri 'none'");
  for (const [name, value] of Object.entries(headers)) response.setHeader(name, value);
  response.end(JSON.stringify(body));
}

async function requestBody(request) {
  let parsedBody;
  try {
    parsedBody = request.body;
  } catch {
    throw publicError(400, "invalid_json", "Request body must be valid JSON.");
  }
  if (parsedBody && typeof parsedBody === "object" && !Buffer.isBuffer(parsedBody)) {
    if (Buffer.byteLength(JSON.stringify(parsedBody)) > MAX_BODY_BYTES) {
      throw publicError(413, "body_too_large", "Request body is too large.");
    }
    return parsedBody;
  }
  if (Buffer.isBuffer(parsedBody)) parsedBody = parsedBody.toString("utf8");
  if (typeof parsedBody === "string") {
    if (Buffer.byteLength(parsedBody) > MAX_BODY_BYTES) throw publicError(413, "body_too_large", "Request body is too large.");
    try {
      return JSON.parse(parsedBody);
    } catch {
      throw publicError(400, "invalid_json", "Request body must be valid JSON.");
    }
  }
  let bytes = 0;
  const chunks = [];
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > MAX_BODY_BYTES) throw publicError(413, "body_too_large", "Request body is too large.");
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw publicError(400, "invalid_json", "Request body must be valid JSON.");
  }
}

function publicError(statusCode, publicCode, message, retryAfter = null) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.publicCode = publicCode;
  if (retryAfter) error.retryAfter = retryAfter;
  return error;
}

function requireMethod(request, method) {
  if (request.method !== method) throw publicError(405, "method_not_allowed", `Use ${method} for this endpoint.`);
}

function requireExactFields(body, fields, label) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw publicError(400, "invalid_request", `${label} must be an object.`);
  const actual = Object.keys(body).sort();
  const expected = [...fields].sort();
  if (actual.length !== expected.length || actual.some((field, index) => field !== expected[index])) {
    throw publicError(400, "invalid_request", `${label} contains unexpected fields.`);
  }
}

function bearerAuthorized(request, secret) {
  const value = String(request.headers?.authorization || "");
  if (!value.startsWith("Bearer ") || typeof secret !== "string") return false;
  const supplied = Buffer.from(value.slice(7));
  const expected = Buffer.from(secret);
  return supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected);
}

function sessionAttemptSource(request) {
  return crypto.createHash("sha256").update(trustedClientAddress(request)).digest("base64url").slice(0, 18);
}

function requireAllowedLimit(result, message) {
  if (!result?.allowed) throw publicError(429, "rate_limited", message, result?.retryAfter || 60);
}

export async function handleSession(request, response, options = {}) {
  return withErrors(response, async () => {
    requireMethod(request, "POST");
    const env = options.env || process.env;
    const body = await requestBody(request);
    requireExactFields(body, ["ticket"], "Session request");
    if (typeof body.ticket !== "string" || body.ticket.length > 4_096) {
      throw publicError(400, "invalid_ticket", "A valid launch ticket is required.");
    }
    const globalRateLimit = options.globalRateLimit || enforceGlobalRateLimit;
    const sourceAttemptLimit = await (options.sessionAttemptRateLimit || enforceSessionAttemptRateLimit)(
      sessionAttemptSource(request),
      { env },
    );
    requireAllowedLimit(sourceAttemptLimit, "Too many launch attempts from this network. Try again shortly.");
    const globalAttemptLimit = await globalRateLimit("session-attempt", { env });
    requireAllowedLimit(globalAttemptLimit, "Too many launch attempts. Try again shortly.");
    let exchanged;
    try {
      exchanged = await exchangeLaunchTicket(body.ticket, {
        env,
        consumeJti: options.consumeJti,
        admitClaims: async (claims) => {
          const participantLimit = await (options.participantSessionRateLimit || enforceParticipantSessionRateLimit)(
            claims.participant_id,
            { env },
          );
          requireAllowedLimit(participantLimit, "Too many session requests for this participant. Try again shortly.");
          const sessionLimit = await globalRateLimit("session", { env });
          requireAllowedLimit(sessionLimit, "Too many session requests. Try again shortly.");
        },
      });
    } catch (error) {
      if (error?.name === "ParticipantTicketError") {
        throw publicError(401, "invalid_ticket", "The launch ticket is invalid, expired, or already used.");
      }
      throw error;
    }
    const { identity, session } = exchanged;
    await recordEvent(identity, "interface:session", "interface", request, options);
    jsonResponse(response, 200, { ok: true, participantId: identity.participantId }, {
      "set-cookie": sessionCookie(session, { secure: (options.env || process.env).NODE_ENV === "production" }),
    });
  });
}

export async function recordInterfaceAsset(request, pathname, options = {}) {
  try {
    const identity = identityFromRequest(request, { env: options.env || process.env });
    const file = pathname === "/" ? "index.html" : pathname.replace(/^\//, "");
    await recordEvent(identity, `interface:${file}`, "interface", request, options);
  } catch {}
}

export async function handleTarget(request, response, options = {}) {
  return withErrors(response, async () => {
    requireMethod(request, "GET");
    const env = options.env || process.env;
    const identity = identityFromRequest(request, { env });
    const [participantLimit, globalLimit] = await Promise.all([
      (options.targetRateLimit || enforceTargetRateLimit)(identity.participantId, { env }),
      (options.globalRateLimit || enforceGlobalRateLimit)("target", { env }),
    ]);
    if (!participantLimit.allowed || !globalLimit.allowed) {
      throw publicError(429, "rate_limited", "Too many target refreshes. Try again shortly.", Math.max(participantLimit.retryAfter || 60, globalLimit.retryAfter || 60));
    }
    const lease = await (options.acquireLease || acquireSubmissionLease)(identity.participantId, { env });
    if (!lease) throw publicError(429, "checker_busy", "A checker operation is already running or capacity is full.", 2);
    try {
      await recordEvent(identity, "target-read", "challenge-action", request, options);
      const target = env.NODE_ENV === "production" && !env.SIGNET_TARGETS_JSON
        ? await (options.ensureTarget || ensureParticipantTarget)(identity.participantId, { env, fetchImpl: options.fetchImpl || fetch })
        : await loadTargetForParticipant(identity.participantId, { env, fetchImpl: options.fetchImpl || fetch });
      let state;
      try {
        state = await readTargetState(target, { env, fetchImpl: options.fetchImpl || fetch });
      } catch (error) {
        if (!(error instanceof RpcError)) throw error;
        state = { status: "unavailable", reserveRaw: null, escrowRaw: null, slot: null };
      }
      jsonResponse(response, 200, {
        identity: { participantId: identity.participantId },
        target: publicTarget(target, state, env),
      });
    } finally {
      await (options.releaseLease || releaseSubmissionLease)(lease, { env });
    }
  });
}

export async function handleProvision(request, response, options = {}) {
  return withErrors(response, async () => {
    requireMethod(request, "POST");
    const env = options.env || process.env;
    if (!bearerAuthorized(request, env.CHALLENGE_TICKET_SECRET)) {
      throw publicError(401, "not_authorized", "Not authorized.");
    }
    const body = await requestBody(request);
    requireExactFields(body, ["participantId"], "Provisioning request");
    const participantId = String(body.participantId || "");
    if (!PARTICIPANT_ID_PATTERN.test(participantId)) {
      throw publicError(400, "invalid_participant", "Invalid participant ID.");
    }
    const target = await (options.ensureTarget || ensureParticipantTarget)(participantId, {
      env,
      fetchImpl: options.fetchImpl || fetch,
    });
    jsonResponse(response, 200, { ok: true, participantId, instanceId: target.instanceId });
  });
}

export async function handleSubmit(request, response, options = {}) {
  return withErrors(response, async () => {
    requireMethod(request, "POST");
    const env = options.env || process.env;
    const identity = identityFromRequest(request, { env });
    const [participantLimit, globalLimit] = await Promise.all([
      (options.rateLimit || enforceSubmissionRateLimit)(identity.participantId, { env }),
      (options.globalRateLimit || enforceGlobalRateLimit)("submit", { env }),
    ]);
    if (!participantLimit.allowed || !globalLimit.allowed) {
      throw publicError(
        429,
        "rate_limited",
        "Too many checker submissions. Try again shortly.",
        Math.max(participantLimit.retryAfter || 60, globalLimit.retryAfter || 60),
      );
    }
    const body = await requestBody(request);
    requireExactFields(body, ["signature"], "Submission");
    if (typeof body.signature !== "string" || body.signature.length > 128) {
      throw publicError(400, "invalid_signature", "Enter a Solana transaction signature.");
    }
    const lease = await (options.acquireLease || acquireSubmissionLease)(identity.participantId, { env });
    if (!lease) {
      throw publicError(429, "checker_busy", "A checker operation is already running or capacity is full.", 2);
    }
    try {
      await recordEvent(identity, "submission-started", "scored-action", request, options);
      const target = await loadTargetForParticipant(identity.participantId, { env, fetchImpl: options.fetchImpl || fetch });
      const result = target.cluster === "localnet-preview"
        ? checkPreviewSubmission({ participantId: identity.participantId, target, signature: body.signature }, env)
        : await checkOnchainSubmission(
            { participantId: identity.participantId, target, signature: body.signature },
            { env, fetchImpl: options.fetchImpl || fetch },
          );
      if (result.ok) {
        const completion = await (options.recordCompletion || recordCompletion)(identity.participantId, {
          participantId: identity.participantId,
          completedAt: result.occurredAt || new Date().toISOString(),
          sourceId: result.signature,
        }, { env, fetchImpl: options.fetchImpl || fetch });
        await (options.reportSolve || reportSolveEventBestEffort)({
          url: env.LEADERBOARD_INGEST_URL,
          secret: env.CHALLENGE_TICKET_SECRET,
          challenge: "signet",
          eventId: eventGeneration(env),
          participantId: identity.participantId,
          sourceId: result.signature,
          occurredAt: completion.completedAt,
          timeoutMs: 1_500,
        });
      }
      jsonResponse(response, 200, { result });
    } finally {
      await (options.releaseLease || releaseSubmissionLease)(lease, { env });
    }
  });
}

export async function handleCompletion(request, response, options = {}) {
  return withErrors(response, async () => {
    requireMethod(request, "GET");
    const env = options.env || process.env;
    if (!bearerAuthorized(request, env.CHALLENGE_TICKET_SECRET)) {
      throw publicError(401, "not_authorized", "Not authorized.");
    }
    const url = new URL(request.url, "http://signet.local");
    const participantId = String(url.searchParams.get("participantId") || "");
    if (!PARTICIPANT_ID_PATTERN.test(participantId)) throw publicError(400, "invalid_participant", "Invalid participant ID.");
    const completion = await (options.completionForParticipant || completionForParticipant)(participantId, {
      env,
      fetchImpl: options.fetchImpl || fetch,
    });
    const generation = eventGeneration(env);
    jsonResponse(response, 200, completion
      ? { completed: true, completedAt: completion.completedAt, eventGeneration: generation }
      : { completed: false, eventGeneration: generation });
  });
}

export async function handleHealth(request, response, options = {}) {
  return withErrors(response, async () => {
    requireMethod(request, "GET");
    const env = options.env || process.env;
    const generation = eventGeneration(env);
    if (env.NODE_ENV !== "production") {
      jsonResponse(response, 200, { ok: true, service: "signet", mode: "preview", eventGeneration: generation });
      return;
    }
    for (const name of ["FLAG_SECRET", "CHALLENGE_TICKET_SECRET", "CHALLENGE_SESSION_SECRET"]) {
      if (!env[name] || Buffer.byteLength(env[name]) < 32) {
        throw new Error(`${name} is missing or weak`);
      }
    }
    const fetchImpl = options.fetchImpl || fetch;
    const cacheMs = Number(env.SIGNET_HEALTH_CACHE_MS || 15_000);
    if (!Number.isSafeInteger(cacheMs) || cacheMs < 1 || cacheMs > 60_000) throw new Error("SIGNET_HEALTH_CACHE_MS is invalid");
    const [redisHealth, , targetInventory, capacity] = await cachedHealthProbe(env, cacheMs, async () => {
      const [redisResult, rpcResult, inventory] = await Promise.all([
        redisCommand(["PING"], { env, fetchImpl }),
        checkRpcHealth({ env, fetchImpl }),
        loadTargetInventory({ env, fetchImpl }),
      ]);
      const capacityResult = await (options.capacityProbe || participantProvisionCapacity)(inventory.count, { env });
      return [redisResult, rpcResult, inventory, capacityResult];
    });
    if (redisHealth !== "PONG") throw new Error("replay store health check failed");
    if (!capacity.sufficient) throw new Error("SIGNET operator cannot provision the configured field");
    jsonResponse(response, 200, {
      ok: true,
      service: "signet",
      mode: "live",
      eventGeneration: generation,
      targetInventory: {
        count: targetInventory.count,
        participantIdsSha256: targetInventory.participantIdsSha256,
      },
      capacity: {
        expectedParticipants: capacity.expectedParticipants,
        provisionedParticipants: capacity.provisionedParticipants,
        remainingParticipants: capacity.remainingParticipants,
        sufficient: capacity.sufficient,
      },
      funding: {
        payer: capacity.payer,
        requiredBalance: capacity.requiredBalance,
      },
    });
  });
}

async function cachedHealthProbe(env, cacheMs, probe) {
  const now = Date.now();
  const existing = healthProbeCache.get(env);
  if (existing && existing.expiresAt > now) return existing.promise;
  const promise = Promise.resolve().then(probe);
  healthProbeCache.set(env, { expiresAt: now + cacheMs, promise });
  return promise;
}

export async function handleAgentPolicy(request, response, options = {}) {
  return withErrors(response, async () => {
    requireMethod(request, "GET");
    const env = options.env || process.env;
    let identity;
    try { identity = identityFromRequest(request, { env }); } catch { identity = null; }
    if (identity) await recordEvent(identity, "policy-read", "policy", request, options, "policy");
    const text = identity
      ? policyFor({ ...identity, challenge: "signet" }, { label: "SIGNET", markerSecret: env.CHALLENGE_SESSION_SECRET }).text
      : publicPolicyFor({ label: "SIGNET" });
    response.statusCode = 200;
    response.setHeader("content-type", "text/plain; charset=utf-8");
    response.setHeader("cache-control", "no-store");
    response.setHeader("x-ctf-agent-policy", "/agents.txt");
    response.end(text);
  });
}

export async function handleUiEvent(request, response, options = {}) {
  return withErrors(response, async () => {
    requireMethod(request, "POST");
    const identity = identityFromRequest(request, { env: options.env || process.env });
    const body = await requestBody(request);
    if (!new Set(["app-boot", "automation-present", "page-ready", "submit-click", "copy-target", "copy-flag"]).has(body.event)) throw publicError(400, "unknown_ui_event", "Unknown interface event.");
    await recordEvent(identity, `ui:${body.event}`, "ui", request, options, "browser-ui");
    jsonResponse(response, 202, { recorded: true });
  });
}

async function recordEvent(identity, action, category, request, options, source = "direct-http") {
  const env = options.env || process.env;
  await forwardIntegrityEvent({ identity, challenge: "signet", label: "SIGNET", action, category, source, request }, env, options.fetchImpl || fetch)
    .catch((error) => console.warn("SIGNET integrity event deferred", error.message));
}

export async function handleAgentDisclosure(request, response, options = {}) {
  return withErrors(response, async () => {
    requireMethod(request, "POST");
    const env = options.env || process.env;
    const identity = identityFromRequest(request, { env });
    const body = await requestBody(request);
    if (!verifyMarker({ ...identity, challenge: "signet" }, body.marker, env.CHALLENGE_SESSION_SECRET)) throw publicError(400, "invalid_marker", "Invalid disclosure marker.");
    const result = await forwardDisclosure({ identity, challenge: "signet", label: "SIGNET", agent: body.agent, model: body.model, requestMeta: { userAgent: String(request.headers["user-agent"] || "") } }, env, options.fetchImpl || fetch);
    jsonResponse(response, 202, result);
  });
}

async function withErrors(response, operation) {
  try {
    await operation();
  } catch (error) {
    const statusCode = error.statusCode || (error instanceof AuthenticationError ? 401 : 500);
    const publicCode = error.publicCode || (statusCode === 500 ? "internal_error" : "request_failed");
    const message = statusCode === 500 ? "The challenge service could not complete that request." : error.message;
    if (statusCode === 500) console.error("SIGNET service error", error);
    if (!response.headersSent) {
      jsonResponse(
        response,
        statusCode,
        { error: { code: publicCode, message } },
        error.retryAfter ? { "retry-after": String(error.retryAfter) } : {},
      );
    }
    else response.end();
  }
}
