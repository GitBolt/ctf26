import { checkOnchainSubmission, checkPreviewSubmission, checkRpcHealth, readTargetState, RpcError } from "./checker.mjs";
import { enforceSubmissionRateLimit, redisCommand } from "./redis.mjs";
import {
  AuthenticationError,
  exchangeLaunchTicket,
  identityFromRequest,
  sessionCookie,
} from "./session.mjs";
import { loadTargetForTeam, publicTarget } from "./targets.mjs";
import { forwardDisclosure, policyFor, verifyMarker } from "@ctf26/agent-integrity";

const MAX_BODY_BYTES = 10_000;

export function jsonResponse(response, statusCode, body, headers = {}) {
  response.statusCode = statusCode;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.setHeader("cache-control", "no-store");
  response.setHeader("x-content-type-options", "nosniff");
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

function publicError(statusCode, publicCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.publicCode = publicCode;
  return error;
}

function requireMethod(request, method) {
  if (request.method !== method) throw publicError(405, "method_not_allowed", `Use ${method} for this endpoint.`);
}

export async function handleSession(request, response, options = {}) {
  return withErrors(response, async () => {
    requireMethod(request, "POST");
    const body = await requestBody(request);
    const env = options.env || process.env;
    if (typeof body.ticket !== "string" || body.ticket.length > 4_096) {
      throw publicError(400, "invalid_ticket", "A valid launch ticket is required.");
    }
    let exchanged;
    try {
      exchanged = await exchangeLaunchTicket(body.ticket, {
        env,
        consumeJti: options.consumeJti,
      });
    } catch (error) {
      if (error?.name === "ParticipantTicketError") {
        throw publicError(401, "invalid_ticket", "The launch ticket is invalid, expired, or already used.");
      }
      throw error;
    }
    const { identity, session } = exchanged;
    jsonResponse(response, 200, { ok: true, teamId: identity.teamId }, {
      "set-cookie": sessionCookie(session, { secure: (options.env || process.env).NODE_ENV === "production" }),
    });
  });
}

export async function handleTarget(request, response, options = {}) {
  return withErrors(response, async () => {
    requireMethod(request, "GET");
    const env = options.env || process.env;
    const identity = identityFromRequest(request, { env });
    const target = await loadTargetForTeam(identity.teamId, { env, fetchImpl: options.fetchImpl || fetch });
    let state;
    try {
      state = await readTargetState(target, { env, fetchImpl: options.fetchImpl || fetch });
    } catch (error) {
      if (!(error instanceof RpcError)) throw error;
      state = { status: "unavailable", reserveRaw: null, escrowRaw: null, slot: null };
    }
    jsonResponse(response, 200, {
      identity: { participantId: identity.participantId, teamId: identity.teamId },
      target: publicTarget(target, state, env),
    });
  });
}

export async function handleSubmit(request, response, options = {}) {
  return withErrors(response, async () => {
    requireMethod(request, "POST");
    const env = options.env || process.env;
    const identity = identityFromRequest(request, { env });
    if (env.NODE_ENV === "production") {
      const limit = await (options.rateLimit || enforceSubmissionRateLimit)(identity.teamId, { env });
      if (!limit.allowed) throw publicError(429, "rate_limited", "Too many checker submissions. Try again in one minute.");
    }
    const body = await requestBody(request);
    if (typeof body.signature !== "string" || body.signature.length > 128) {
      throw publicError(400, "invalid_signature", "Enter a Solana transaction signature.");
    }
    const target = await loadTargetForTeam(identity.teamId, { env, fetchImpl: options.fetchImpl || fetch });
    const result = target.cluster === "localnet-preview"
      ? checkPreviewSubmission({ teamId: identity.teamId, target, signature: body.signature }, env)
      : await checkOnchainSubmission(
          { teamId: identity.teamId, target, signature: body.signature },
          { env, fetchImpl: options.fetchImpl || fetch },
        );
    jsonResponse(response, 200, { result });
  });
}

export async function handleHealth(request, response, options = {}) {
  return withErrors(response, async () => {
    requireMethod(request, "GET");
    const env = options.env || process.env;
    if (env.NODE_ENV !== "production") {
      jsonResponse(response, 200, { ok: true, service: "signet", mode: "preview" });
      return;
    }
    for (const name of ["FLAG_SECRET", "CHALLENGE_TICKET_SECRET", "CHALLENGE_SESSION_SECRET"]) {
      if (!env[name] || Buffer.byteLength(env[name]) < 32) {
        throw new Error(`${name} is missing or weak`);
      }
    }
    const fetchImpl = options.fetchImpl || fetch;
    const [redisHealth] = await Promise.all([
      redisCommand(["PING"], { env, fetchImpl }),
      checkRpcHealth({ env, fetchImpl }),
    ]);
    if (redisHealth !== "PONG") throw new Error("replay store health check failed");
    jsonResponse(response, 200, { ok: true, service: "signet", mode: "live" });
  });
}

export async function handleAgentPolicy(request, response, options = {}) {
  return withErrors(response, async () => {
    requireMethod(request, "GET");
    const env = options.env || process.env;
    let identity;
    try { identity = identityFromRequest(request, { env }); } catch { identity = null; }
    const text = identity
      ? policyFor({ ...identity, challenge: "signet" }, { label: "SIGNET", markerSecret: env.CHALLENGE_SESSION_SECRET }).text
      : "# CTF26 SIGNET autonomous-agent policy\nLaunch through the participant portal, then read this policy again before operating the scored challenge.";
    response.statusCode = 200;
    response.setHeader("content-type", "text/plain; charset=utf-8");
    response.setHeader("cache-control", "no-store");
    response.setHeader("x-ctf-agent-policy", "/agents.txt");
    response.end(text);
  });
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
    if (!response.headersSent) jsonResponse(response, statusCode, { error: { code: publicCode, message } });
    else response.end();
  }
}
