import crypto from "node:crypto";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { forwardDisclosure, policyFor, publicPolicyFor, verifyMarker } from "@ctf26/agent-integrity";
import { consumeParticipantTicket, ParticipantTicketError } from "@ctf26/participant-ticket";
import { canonicalClaimBody, createInstance, parseAndVerifyClaim, recordClaim, verifyPow } from "./protocol.mjs";
import { createStore } from "./store.mjs";

const WEB_ROOT = fileURLToPath(new URL("../web/", import.meta.url));
const STATIC = new Map([["/", ["index.html", "text/html; charset=utf-8"]], ["/app.js", ["app.js", "text/javascript; charset=utf-8"]], ["/style.css", ["style.css", "text/css; charset=utf-8"]]]);
const COOKIE = "st_genesis_session";
const MAX_BODY = 20 * 1024;
const teamQueues = new Map();

class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
const requireSecret = (value, name, optional = false) => {
  if (optional && !value) return null;
  if (typeof value !== "string" || Buffer.byteLength(value) < 32) throw new Error(`${name} must contain at least 32 bytes`);
  return value;
};

export async function createGenesisServer(options = {}) {
  const env = options.env || process.env;
  const store = options.store || await createStore(env);
  const ticketSecret = requireSecret(options.ticketSecret ?? env.PARTICIPANT_TICKET_SECRET, "participant ticket secret", true);
  const sessionSecret = requireSecret(options.sessionSecret ?? env.SESSION_SECRET ?? "dev-st-genesis-session-secret-32-bytes", "session secret");
  const policySecret = requireSecret(options.policySecret ?? env.AGENT_POLICY_SECRET ?? "dev-st-genesis-policy-secret-32-bytes!", "agent policy secret");
  const completionSecret = requireSecret(options.completionSecret ?? env.COMPLETION_SECRET ?? "dev-st-genesis-completion-secret-32b", "completion secret");
  const allowDev = options.allowDev ?? (env.ALLOW_DEV_LAUNCH === "true" || !ticketSecret);
  const powBits = Number(options.powBits ?? env.POW_BITS ?? 16);
  const powTtlMs = Number(env.POW_TTL_MS || 120_000);
  const rateMax = Number(env.RATE_LIMIT_MAX || 30);
  const rateWindowMs = Number(env.RATE_LIMIT_WINDOW_MS || 60_000);
  const winningVideo = env.ST_GENESIS_VIDEO_ID || env.ST_GENESIS_VIDEO_URL || "Zg97oEONXk4";

  const server = http.createServer((request, response) => handle(request, response).catch((error) => {
    const status = error instanceof HttpError ? error.status : error instanceof ParticipantTicketError ? 401 : 500;
    if (status === 500) console.error(error);
    json(response, status, { error: status === 500 ? "internal server error" : error.message });
  }));

  async function handle(request, response) {
    security(response);
    const url = new URL(request.url, "http://st-genesis.local");
    if (request.method === "GET" && url.pathname === "/health") return json(response, 200, { ok: true, challenge: "st-genesis-airdrop", store: store.mode });
    if (request.method === "GET" && new Set(["/robots.txt", "/agents.txt", "/llms.txt", "/.well-known/agents.txt"]).has(url.pathname)) {
      let identity = null;
      try { identity = await authenticate(request, store, sessionSecret); } catch {}
      const policy = identity
        ? policyFor({ challenge: "st-genesis-airdrop", participantId: identity.participantId, teamId: identity.teamId }, { markerSecret: policySecret, label: "$ST GENESIS AIRDROP" }).text
        : publicPolicyFor({ label: "$ST GENESIS AIRDROP" });
      return text(response, 200, policy);
    }
    if (request.method === "GET" && url.pathname === "/launch") {
      let identity;
      const ticket = url.searchParams.get("ticket");
      if (ticket && ticketSecret) {
        const claims = await consumeParticipantTicket(ticket, ticketSecret, { audience: "st-genesis-airdrop", consumeJti: ({ jti, expiresAt }) => store.consumeTicket(jti, expiresAt) });
        identity = { participantId: claims.participant_id, teamId: claims.team_id, eventId: claims.event_id };
      } else if (allowDev) {
        const teamId = String(url.searchParams.get("teamId") || "local-player");
        if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(teamId)) throw new HttpError(400, "invalid team ID");
        identity = { participantId: teamId, teamId, eventId: "ctf26" };
      } else throw new HttpError(401, "a portal launch ticket is required");
      const sessionId = crypto.randomBytes(24).toString("base64url");
      await store.putSession(sessionId, identity);
      if (!await store.getInstance(identity.teamId)) await store.putInstance(identity.teamId, createInstance(identity.teamId));
      response.writeHead(303, { location: "/", "set-cookie": cookieFor(sign(sessionId, sessionSecret), env), "cache-control": "no-store", "referrer-policy": "no-referrer" });
      return response.end();
    }
    if (request.method === "GET" && url.pathname === "/api/completion") {
      if (!bearerAuthorized(request, completionSecret)) throw new HttpError(401, "not authorized");
      const teamId = String(url.searchParams.get("teamId") || "");
      if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(teamId)) throw new HttpError(400, "invalid team ID");
      const instance = await store.getInstance(teamId);
      return json(response, 200, instance?.completedAt ? { completed: true, completedAt: instance.completedAt } : { completed: false });
    }
    if (request.method === "GET" && url.pathname === "/api/v1/claim") return json(response, 410, { note: "deprecated; v1 replay handling was replaced" });
    if (request.method === "GET" && url.pathname === "/api/debug") return json(response, 200, { token: "eyJhbGciOiJIUzI1NiJ9.eyJzY29wZSI6ImNsYWltOnJlYWQifQ.decoy", scope: "claim:read" });
    if (request.method === "GET" && url.pathname === "/metrics") return text(response, 200, "# TYPE claims_total counter\nclaims_total 9181\n# TYPE claims_rejected_total counter\nclaims_rejected_total 8661\n");

    const identity = await authenticate(request, store, sessionSecret);
    if (request.method === "POST" && url.pathname === "/api/agent-disclosure") {
      const body = await readJson(request);
      if (!verifyMarker({ challenge: "st-genesis-airdrop", participantId: identity.participantId, teamId: identity.teamId }, body.marker, policySecret)) throw new HttpError(400, "invalid disclosure marker");
      const result = await forwardDisclosure({
        identity: { participantId: identity.participantId, teamId: identity.teamId, eventId: identity.eventId },
        challenge: "st-genesis-airdrop",
        label: "$ST GENESIS AIRDROP",
        agent: body.agent,
        model: body.model,
        requestMeta: { source: "st-genesis-agent-policy", userAgent: String(request.headers["user-agent"] || "") },
      }, env, options.fetchImpl || fetch);
      return json(response, 202, result);
    }
    let instance = await store.getInstance(identity.teamId);
    if (!instance) { instance = createInstance(identity.teamId); await store.putInstance(identity.teamId, instance); }

    if ((request.method === "GET" || request.method === "HEAD") && STATIC.has(url.pathname)) {
      const [file, type] = STATIC.get(url.pathname);
      const body = await fs.readFile(path.join(WEB_ROOT, file));
      response.writeHead(200, { "content-type": type, "cache-control": "no-store" });
      return response.end(request.method === "HEAD" ? undefined : body);
    }
    if (request.method === "GET" && url.pathname === "/api/config") {
      return json(response, 200, { challenge: "$ST Genesis Airdrop", teamId: identity.teamId, message: instance.message, powBits, receiptEncoding: "base58 protocol record", completed: Boolean(instance.completedAt) });
    }
    if (request.method === "GET" && url.pathname === "/api/pow") {
      const challenge = crypto.randomBytes(12).toString("hex");
      await store.registerPow(challenge, { sessionId: identity.sessionId, bits: powBits, expiresAt: Date.now() + powTtlMs });
      return json(response, 200, { challenge, bits: powBits, binding: "sha256(challenge + ':' + nonce + ':' + sha256(canonical claim JSON))" });
    }
    if (request.method === "POST" && url.pathname === "/api/claim") {
      const body = await readJson(request);
      try { canonicalClaimBody(body); } catch { throw new HttpError(400, "invalid claim JSON"); }
      const powHeader = String(request.headers["x-pow"] || "");
      const separator = powHeader.indexOf(":");
      if (separator < 1) throw new HttpError(429, "proof of work required");
      const challenge = powHeader.slice(0, separator);
      const nonce = powHeader.slice(separator + 1);
      const pow = await store.consumePow(challenge);
      if (!pow || pow.sessionId !== identity.sessionId || pow.expiresAt < Date.now()) throw new HttpError(429, "invalid proof of work");
      if (!verifyPow({ challenge, nonce, body, bits: pow.bits })) throw new HttpError(429, "insufficient proof of work");
      const allowed = await store.hitRate(`${identity.teamId}:${String(body.pubkey || "")}`, Date.now(), rateMax, rateWindowMs);
      if (!allowed) throw new HttpError(429, "wallet rate limit exceeded");
      const verified = parseAndVerifyClaim(instance, body);
      if (!verified.ok) throw new HttpError(verified.status, verified.error);
      const result = await withTeam(identity.teamId, async () => {
        const current = await store.getInstance(identity.teamId);
        if (current.wallet && current.wallet !== verified.pubkey) {
          throw new HttpError(409, "this instance is bound to another wallet");
        }
        const recorded = recordClaim(current, verified, { videoId: winningVideo });
        await store.putInstance(identity.teamId, recorded.instance);
        return recorded;
      });
      return json(response, 200, { id: result.receipt });
    }
    throw new HttpError(404, "not found");
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
async function withTeam(teamId, operation) { const previous = teamQueues.get(teamId) || Promise.resolve(); const current = previous.catch(() => {}).then(operation); teamQueues.set(teamId, current); try { return await current; } finally { if (teamQueues.get(teamId) === current) teamQueues.delete(teamId); } }
function sign(id, secret) { return `${id}.${crypto.createHmac("sha256", secret).update(id).digest("base64url")}`; }
function verify(value, secret) { const [id, signature, extra] = String(value || "").split("."); if (!id || !signature || extra) return null; const expected = crypto.createHmac("sha256", secret).update(id).digest(); let actual; try { actual = Buffer.from(signature, "base64url"); } catch { return null; } return actual.length === expected.length && crypto.timingSafeEqual(actual, expected) ? id : null; }
function cookieFor(value, env) { return `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=43200${env.NODE_ENV === "production" ? "; Secure" : ""}`; }
function parseCookies(value) { return Object.fromEntries(value.split(";").map((part) => part.trim().split("=")).filter(([key, val]) => key && val)); }
function bearerAuthorized(request, secret) { const supplied = Buffer.from(String(request.headers.authorization || "").replace(/^Bearer /, "")); const expected = Buffer.from(secret); return supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected); }
async function readJson(request) { const chunks = []; let size = 0; for await (const chunk of request) { size += chunk.length; if (size > MAX_BODY) throw new HttpError(413, "request too large"); chunks.push(chunk); } try { return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); } catch { throw new HttpError(400, "invalid JSON"); } }
function security(response) { response.setHeader("content-security-policy", "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"); response.setHeader("x-content-type-options", "nosniff"); response.setHeader("referrer-policy", "no-referrer"); response.setHeader("link", "</agents.txt>; rel=\"ai-policy\", </robots.txt>; rel=\"robots\""); response.setHeader("x-ctf-agent-policy", "/agents.txt"); }
function json(response, status, body) { response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }); response.end(JSON.stringify(body)); }
function text(response, status, body) { response.writeHead(status, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" }); response.end(body); }

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const service = await createGenesisServer();
  const port = Number(process.env.PORT || 3008);
  await service.listen(port);
  console.log(`$ST Genesis Airdrop listening on ${port}; store=${service.store.mode}`);
}
