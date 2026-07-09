import crypto from "node:crypto";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  beginRevealPhase,
  commitAction,
  createMarket,
  inspectMarket,
  issueVoucher,
  registerTeam,
  revealAction,
  resolveTick,
  scoreboard,
} from "./market.mjs";

const MODULE_PATH = fileURLToPath(import.meta.url);
const WEB_ROOT = fileURLToPath(new URL("../web/", import.meta.url));
const STATIC_FILES = new Map([
  ["/", ["index.html", "text/html; charset=utf-8"]],
  ["/index.html", ["index.html", "text/html; charset=utf-8"]],
  ["/main.js", ["main.js", "text/javascript; charset=utf-8"]],
  ["/style.css", ["style.css", "text/css; charset=utf-8"]],
]);
const TELEMETRY_KINDS = ["delayed-bin-touch", "noisy-reward-rate", "partial-swap-pressure"];
const MAX_BODY_BYTES = 16 * 1024;

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function createRewardSniperServer(options = {}) {
  const market = createMarket(options.seed ?? "web-round", {
    startingLiquidity: options.startingLiquidity,
    maxActionLiquidity: options.maxActionLiquidity,
    voucherSecret: options.voucherSecret,
  });
  const sessions = new Map();
  const autoPhases = options.autoPhases ?? true;
  const commitDurationMs = options.commitDurationMs ?? 20_000;
  const revealDurationMs = options.revealDurationMs ?? 10_000;
  assertDuration(commitDurationMs, "commit duration");
  assertDuration(revealDurationMs, "reveal duration");
  let registrationCount = 0;
  let phaseTimer;
  let phaseEndsAt = null;

  const server = http.createServer((request, response) => {
    handleRequest(request, response).catch((error) => {
      const status = error instanceof HttpError ? error.status : 500;
      if (status === 500) console.error(error);
      sendJson(response, status, { error: status === 500 ? "internal server error" : error.message });
    });
  });

  async function handleRequest(request, response) {
    setSecurityHeaders(response);
    const url = new URL(request.url, "http://reward-sniper.local");

    if (request.method === "GET" && STATIC_FILES.has(url.pathname)) {
      const [filename, contentType] = STATIC_FILES.get(url.pathname);
      const body = await fs.readFile(path.join(WEB_ROOT, filename));
      response.writeHead(200, { "content-type": contentType, "cache-control": "no-store" });
      response.end(body);
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/health") {
      sendJson(response, 200, { ok: true, tick: market.tick, phase: market.phase, phaseEndsAt });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/session") {
      const body = await readJson(request);
      const teamId = body.teamId ?? `team-${crypto.randomUUID().slice(0, 8)}`;
      if (typeof teamId !== "string" || !/^[a-zA-Z0-9_-]{3,40}$/.test(teamId)) {
        throw new HttpError(400, "team id must be 3-40 letters, numbers, underscores, or dashes");
      }
      if (market.teams[teamId]) throw new HttpError(409, "team id already registered");

      const telemetryKind = TELEMETRY_KINDS[registrationCount % TELEMETRY_KINDS.length];
      registrationCount += 1;
      registerTeam(market, teamId, telemetryKind);
      const accessToken = crypto.randomBytes(32).toString("base64url");
      sessions.set(accessToken, teamId);
      sendJson(response, 201, { teamId, accessToken });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/market") {
      const teamId = authenticate(request, sessions);
      const view = runMarketAction(() => inspectMarket(market, teamId));
      sendJson(response, 200, { ...view, phaseEndsAt });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/scoreboard") {
      sendJson(response, 200, scoreboard(market));
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/voucher") {
      const teamId = authenticate(request, sessions);
      const body = await readJson(request);
      const voucher = runMarketAction(() => issueVoucher(market, teamId, {
        binId: body.binId,
        nonce: crypto.randomUUID(),
      }));
      sendJson(response, 201, { voucher });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/commit") {
      const teamId = authenticate(request, sessions);
      const body = await readJson(request);
      const action = normalizeAction(body.action);
      const commitment = runMarketAction(() => commitAction(market, teamId, action, body.nonce));
      sendJson(response, 201, { commitment, tick: market.tick });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/reveal") {
      const teamId = authenticate(request, sessions);
      const body = await readJson(request);
      const action = normalizeAction(body.action);
      const result = runMarketAction(() => revealAction(market, teamId, action, body.nonce));
      sendJson(response, 202, { result, tick: market.tick });
      return;
    }

    throw new HttpError(404, "not found");
  }

  return {
    market,
    server,
    async listen(port = 0, host = "127.0.0.1") {
      if (!Number.isSafeInteger(port) || port < 0 || port > 65_535) throw new Error("invalid port");
      await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, host, () => {
          server.off("error", reject);
          resolve();
        });
      });
      if (autoPhases) scheduleCurrentPhase();
      const address = server.address();
      return `http://${address.address.includes(":") ? `[${address.address}]` : address.address}:${address.port}`;
    },
    advancePhase() {
      if (phaseTimer) clearTimeout(phaseTimer);
      phaseTimer = undefined;
      phaseEndsAt = null;
      const result = transitionPhase();
      if (autoPhases && server.listening) scheduleCurrentPhase();
      return result;
    },
    async close() {
      if (phaseTimer) clearTimeout(phaseTimer);
      phaseTimer = undefined;
      phaseEndsAt = null;
      if (!server.listening) return;
      await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    },
  };

  function transitionPhase() {
    return market.phase === "commit" ? beginRevealPhase(market) : resolveTick(market);
  }

  function scheduleCurrentPhase() {
    const duration = market.phase === "commit" ? commitDurationMs : revealDurationMs;
    phaseEndsAt = Date.now() + duration;
    phaseTimer = setTimeout(() => {
      phaseTimer = undefined;
      phaseEndsAt = null;
      transitionPhase();
      scheduleCurrentPhase();
    }, duration);
    phaseTimer.unref();
  }
}

function authenticate(request, sessions) {
  const authorization = request.headers.authorization;
  const token = typeof authorization === "string" && authorization.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length)
    : "";
  const teamId = sessions.get(token);
  if (!teamId) throw new HttpError(401, "valid team access token required");
  return teamId;
}

function normalizeAction(action) {
  if (!action || typeof action !== "object" || Array.isArray(action)) {
    throw new HttpError(400, "action must be an object");
  }
  if (action.type === "ticket") {
    return {
      type: "ticket",
      binId: action.binId,
      liquidity: action.liquidity,
      voucher: action.voucher,
    };
  }
  if (action.type === "swap") return { type: "swap", toBin: action.toBin };
  throw new HttpError(400, "unsupported action type");
}

function runMarketAction(action) {
  try {
    return action();
  } catch (error) {
    throw new HttpError(400, error.message);
  }
}

async function readJson(request) {
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new HttpError(413, "request body too large");
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value;
  } catch {
    throw new HttpError(400, "request body must be a JSON object");
  }
}

function setSecurityHeaders(response) {
  response.setHeader("content-security-policy", "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'");
  response.setHeader("x-content-type-options", "nosniff");
  response.setHeader("referrer-policy", "no-referrer");
}

function sendJson(response, status, value) {
  if (response.writableEnded) return;
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  response.end(JSON.stringify(value));
}

function assertDuration(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${label} must be a positive integer`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === MODULE_PATH) {
  const port = Number.parseInt(process.env.PORT ?? "3010", 10);
  const commitDurationMs = Number.parseInt(process.env.COMMIT_MS ?? "20000", 10);
  const revealDurationMs = Number.parseInt(process.env.REVEAL_MS ?? "10000", 10);
  const app = createRewardSniperServer({ commitDurationMs, revealDurationMs });
  const url = await app.listen(port, process.env.HOST ?? "127.0.0.1");
  console.log(`reward sniper off-chain prototype listening on ${url}`);

  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.once(signal, async () => {
      await app.close();
      process.exit(0);
    });
  }
}
