import crypto from "node:crypto";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { consumeParticipantTicket, ParticipantTicketError } from "@ctf26/participant-ticket";
import { forwardDisclosure, policyFor, publicPolicyFor, verifyMarker } from "@ctf26/agent-integrity";

import { createDevnetChain, explorerTransaction } from "./devnet-chain.mjs";
import { completionFor, createInstance, openJackpot, publicCabinet } from "./model.mjs";
import { createStore } from "./store.mjs";

const WEB_ROOT = fileURLToPath(new URL("../web/", import.meta.url));
const STATIC = new Map([["/", ["index.html", "text/html; charset=utf-8"]], ["/app.js", ["app.js", "text/javascript; charset=utf-8"]], ["/style.css", ["style.css", "text/css; charset=utf-8"]], ["/celebration.css", ["celebration.css", "text/css; charset=utf-8"]]]);
STATIC.set("/assets/co-op-jackpot-stage-v2.png", ["assets/co-op-jackpot-stage-v2.png", "image/png"]);
STATIC.set("/assets/jackpot-win.mp3", ["assets/jackpot-win.mp3", "audio/mpeg"]);
const COOKIE = "player_two_session";
const MAX_BODY = 16 * 1024;

class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
const requiredSecret = (value, name, optional = false) => {
  if (optional && !value) return null;
  if (typeof value !== "string" || Buffer.byteLength(value) < 32) throw new Error(`${name} must contain at least 32 bytes`);
  return value;
};

export async function createPlayerTwoServer(options = {}) {
  const env = options.env || process.env;
  const store = options.store || await createStore(env);
  const ticketSecret = requiredSecret(options.ticketSecret ?? env.PARTICIPANT_TICKET_SECRET, "participant ticket secret", true);
  const sessionSecret = requiredSecret(options.sessionSecret ?? env.SESSION_SECRET ?? "dev-player-two-session-secret-32-bytes", "session secret");
  const policySecret = requiredSecret(options.policySecret ?? env.AGENT_POLICY_SECRET ?? "dev-player-two-policy-secret-32-bytes!", "agent policy secret");
  const completionSecret = requiredSecret(options.completionSecret ?? env.COMPLETION_SECRET ?? "dev-player-two-completion-secret-32b", "completion secret");
  const allowDev = options.allowDev ?? (env.ALLOW_DEV_LAUNCH === "true" || !ticketSecret);
  const chain = options.chain || createDevnetChain(env);

  const server = http.createServer((request, response) => handle(request, response).catch((error) => {
    const status = error instanceof HttpError ? error.status : 500;
    if (status === 500) console.error(error);
    json(response, status, { error: status === 500 ? "internal server error" : error.message });
  }));

  async function handle(request, response) {
    security(response);
    const url = new URL(request.url, "http://player-two.local");
    if ((request.method === "GET" || request.method === "HEAD") && STATIC.has(url.pathname)) {
      const [file, type] = STATIC.get(url.pathname);
      const body = await fs.readFile(path.join(WEB_ROOT, file));
      response.writeHead(200, { "content-type": type, "cache-control": "no-store" });
      response.end(request.method === "HEAD" ? undefined : body); return;
    }
    if (request.method === "GET" && url.pathname === "/health") return json(response, 200, { ok: true, store: store.mode, challenge: "player-two", network: chain.network, programId: chain.programId });
    if (request.method === "GET" && new Set(["/robots.txt", "/agents.txt", "/llms.txt", "/.well-known/agents.txt"]).has(url.pathname)) {
      const identity = await optionalIdentity(request);
      const policy = identity ? policyFor({ challenge: "player-two", participantId: identity.participantId, teamId: identity.teamId }, { markerSecret: policySecret, label: "PLAYER TWO" }) : null;
      return text(response, 200, policy?.text || publicPolicyFor({ label: "PLAYER TWO" }));
    }
    if (request.method === "POST" && url.pathname === "/api/session") {
      const body = await readJson(request);
      let identity;
      if (body.ticket && ticketSecret) {
        try {
          const claims = await consumeParticipantTicket(body.ticket, ticketSecret, { audience: "player-two", consumeJti: ({ jti, expiresAt }) => store.consumeTicket(jti, expiresAt) });
          identity = { participantId: claims.participant_id, teamId: claims.team_id, eventId: claims.event_id, launchMode: "portal" };
        } catch (error) {
          if (error instanceof ParticipantTicketError) throw new HttpError(401, error.message);
          throw error;
        }
      } else if (allowDev) {
        const teamId = String(body.teamId || "local-player");
        if (!/^[a-zA-Z0-9_-]{1,128}$/.test(teamId)) throw new HttpError(400, "invalid team ID");
        identity = { participantId: teamId, teamId, eventId: "ctf26", launchMode: "development" };
      } else throw new HttpError(401, "a portal launch ticket is required");
      const id = crypto.randomBytes(24).toString("base64url");
      await store.putSession(id, identity);
      if (!await store.getInstance(identity.teamId)) {
        const eventNonce = crypto.randomBytes(12).toString("hex");
        const provisioned = await chain.provision(identity.teamId, eventNonce);
        await store.putInstance(identity.teamId, createInstance(identity.teamId, eventNonce, { ...provisioned, programId: chain.programId }));
      }
      await audit(identity, "session-created", request);
      response.setHeader("set-cookie", `${COOKIE}=${sign(id, sessionSecret)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=43200${env.NODE_ENV === "production" ? "; Secure" : ""}`);
      return json(response, 201, identity);
    }
    if (request.method === "POST" && url.pathname === "/api/agent-disclosure") {
      const identity = await authenticate(request);
      const body = await readJson(request);
      if (!verifyMarker({ challenge: "player-two", participantId: identity.participantId, teamId: identity.teamId }, body.marker, policySecret)) throw new HttpError(400, "invalid disclosure marker");
      const result = await forwardDisclosure({ identity, challenge: "player-two", label: "PLAYER TWO", agent: body.agent, model: body.model, requestMeta: { source: "player-two-agent-policy", userAgent: String(request.headers["user-agent"] || "") } }, env, options.fetchImpl || fetch);
      await audit(identity, "agent-disclosure", request, { caseId: result.caseId, agent: String(body.agent || "").slice(0, 120), model: String(body.model || "").slice(0, 120) });
      return json(response, 202, result);
    }

    const identity = await authenticate(request);
    let instance = await store.getInstance(identity.teamId);
    if (!instance) throw new HttpError(409, "cabinet instance is unavailable");
    if (request.method === "GET" && url.pathname === "/api/cabinet") {
      await audit(identity, "cabinet-read", request);
      return json(response, 200, publicCabinet(instance));
    }
    if (request.method === "POST" && url.pathname === "/api/ui-event") {
      const body = await readJson(request);
      const allowed = new Set(["cabinet-ready", "receipt-pulled", "transaction-copied", "scanner-opened", "reader-changed", "lever-pulled"]);
      if (!allowed.has(body.event)) throw new HttpError(400, "unknown cabinet event");
      await audit(identity, `ui:${body.event}`, request, { detail: String(body.detail || "").slice(0, 160) });
      return json(response, 202, { recorded: true });
    }
    if (request.method === "POST" && url.pathname === "/api/receipt") {
      await audit(identity, "receipt-inspected", request);
      return json(response, 200, { signature: instance.receiptSignature, network: "devnet", explorerUrl: explorerTransaction(instance.receiptSignature) });
    }
    if (request.method === "POST" && url.pathname === "/api/scan") {
      const body = await readJson(request);
      const result = await chain.inspectPass(body.address);
      await audit(identity, "account-scanned", request, { address: result.address, found: result.found });
      return json(response, 200, { ...result, authorityMatch: result.found ? result.holder === instance.holder : false });
    }
    if (request.method === "POST" && url.pathname === "/api/jackpot") {
      const body = await readJson(request);
      const candidate = structuredClone(instance);
      const result = openJackpot(candidate, { leftPass: String(body.leftPass || ""), rightPass: String(body.rightPass || ""), leftHolder: identityHolder(candidate, body.leftHolder), rightHolder: identityHolder(candidate, body.rightHolder) });
      if (result.ok) {
        const chainResult = await chain.openJackpot({ teamId: identity.teamId, eventNonce: instance.eventNonce, jackpot: instance.jackpot, firstPass: String(body.leftPass || ""), secondPass: String(body.rightPass || "") });
        candidate.jackpotSignature = chainResult.signature;
        instance = candidate;
        result.completionReceipt = completionFor(instance, completionSecret);
        result.jackpotSignature = chainResult.signature;
        result.explorerUrl = chainResult.explorerUrl;
      } else {
        instance.attempts = candidate.attempts;
      }
      await store.putInstance(identity.teamId, instance);
      await audit(identity, "jackpot-attempt", request, { code: result.code, leftPass: String(body.leftPass || ""), rightPass: String(body.rightPass || "") });
      return json(response, result.ok ? 200 : 422, { ...result, cabinet: publicCabinet(instance) });
    }
    throw new HttpError(404, "not found");
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
  async function audit(identity, event, request, detail = {}) {
    await store.audit(identity.teamId, { at: Date.now(), event, participantId: identity.participantId, teamId: identity.teamId, source: request.headers["x-player-two-ui"] === "cabinet" ? "browser-ui" : "direct-http", ...detail });
  }
  return { server, store, listen(port = 0) { return new Promise((resolve) => server.listen(port, () => resolve(server.address()))); }, close() { return new Promise((resolve, reject) => server.close(async (error) => { await store.close(); error ? reject(error) : resolve(); })); } };
}

function sign(id, secret) { return `${id}.${crypto.createHmac("sha256", secret).update(id).digest("base64url")}`; }
function verify(value, secret) { const [id, sig, extra] = String(value || "").split("."); if (!id || !sig || extra) return null; const expected = crypto.createHmac("sha256", secret).update(id).digest(); let actual; try { actual = Buffer.from(sig, "base64url"); } catch { return null; } return actual.length === expected.length && crypto.timingSafeEqual(actual, expected) ? id : null; }
function parseCookies(value) { return Object.fromEntries(value.split(";").map((part) => part.trim().split("=")).filter(([key, val]) => key && val)); }
async function readJson(request) { const chunks = []; let size = 0; for await (const chunk of request) { size += chunk.length; if (size > MAX_BODY) throw new HttpError(413, "request too large"); chunks.push(chunk); } try { return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); } catch { throw new HttpError(400, "invalid JSON"); } }
function security(response) { response.setHeader("content-security-policy", "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"); response.setHeader("x-content-type-options", "nosniff"); response.setHeader("referrer-policy", "no-referrer"); }
function json(response, status, body) { response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }); response.end(JSON.stringify(body)); }
function text(response, status, body) { response.writeHead(status, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" }); response.end(body); }

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const service = await createPlayerTwoServer();
  const port = Number(process.env.PORT || 3007);
  await service.listen(port);
  console.log(`PLAYER TWO listening on ${port}`);
}
