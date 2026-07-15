import crypto from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import http from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

import { verifyParticipantTicket } from "@ctf26/participant-ticket";
import { forwardDisclosure, policyFor, publicPolicyFor, verifyMarker } from "@ctf26/agent-integrity";
import { createClient } from "redis";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const SESSION_COOKIE = "drift_session";
const SESSION_TTL_SECONDS = 12 * 60 * 60;
const MAX_BODY_BYTES = 64 * 1024;
const MAX_CHILD_OUTPUT_BYTES = 1024 * 1024;
const TEAM_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const WEB_ASSETS = Object.freeze({
  "/": Object.freeze({ file: "index.html", type: "text/html; charset=utf-8" }),
  "/app.js": Object.freeze({ file: "app.js", type: "text/javascript; charset=utf-8" }),
  "/styles.css": Object.freeze({ file: "styles.css", type: "text/css; charset=utf-8" }),
});

function requiredSecret(env, name) {
  const value = env[name];
  if (typeof value !== "string" || Buffer.byteLength(value) < 32) {
    throw new Error(`${name} must contain at least 32 bytes`);
  }
  return value;
}

function positiveInteger(env, name, fallback) {
  const value = Number(env[name] || fallback);
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${name} must be a positive integer`);
  return value;
}

function encode(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function sessionMac(payload, secret) {
  return crypto.createHmac("sha256", secret).update(payload).digest("base64url");
}

export function createSession(ticket, env = process.env, now = Date.now()) {
  const claims = verifyLaunchTicket(ticket, env, now);
  return sessionForClaims(claims, env, now);
}

function verifyLaunchTicket(ticket, env, now = Date.now()) {
  return verifyParticipantTicket(ticket, requiredSecret(env, "CHALLENGE_TICKET_SECRET"), {
    audience: env.DRIFT_TICKET_AUDIENCE || "overclock",
    now: Math.floor(now / 1000),
  });
}

function sessionForClaims(claims, env, now = Date.now()) {
  const payload = encode({
    teamId: claims.team_id,
    participantId: claims.participant_id,
    email: claims.email || "",
    exp: Math.floor(now / 1000) + SESSION_TTL_SECONDS,
  });
  return `v1.${payload}.${sessionMac(payload, requiredSecret(env, "DRIFT_SESSION_SECRET"))}`;
}

export function verifySession(token, env = process.env, now = Date.now()) {
  const [version, payload, mac, ...extra] = String(token || "").split(".");
  if (version !== "v1" || !payload || !mac || extra.length) throw new Error("session is malformed");
  const expected = sessionMac(payload, requiredSecret(env, "DRIFT_SESSION_SECRET"));
  const actualBytes = Buffer.from(mac);
  const expectedBytes = Buffer.from(expected);
  if (actualBytes.length !== expectedBytes.length || !crypto.timingSafeEqual(actualBytes, expectedBytes)) {
    throw new Error("session signature is invalid");
  }
  let body;
  try {
    body = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    throw new Error("session payload is invalid");
  }
  if (!TEAM_ID_PATTERN.test(body.teamId || "") || typeof body.participantId !== "string" ||
      !Number.isSafeInteger(body.exp) || body.exp <= Math.floor(now / 1000)) {
    throw new Error("session is invalid or expired");
  }
  return Object.freeze(body);
}

function cookies(request) {
  return Object.fromEntries(
    String(request.headers.cookie || "")
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const index = part.indexOf("=");
        return index < 0 ? [part, ""] : [part.slice(0, index), decodeURIComponent(part.slice(index + 1))];
      }),
  );
}

function authenticatedTeam(request, env) {
  try {
    return verifySession(cookies(request)[SESSION_COOKIE], env);
  } catch (error) {
    throw Object.assign(new Error(error.message || "authentication failed"), { status: 401 });
  }
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw Object.assign(new Error("request body is too large"), { status: 413 });
    chunks.push(chunk);
  }
  if (size === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw Object.assign(new Error("request body must be valid JSON"), { status: 400 });
  }
}

function exactObject(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw Object.assign(new Error(`${label} must be an object`), { status: 400 });
  }
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw Object.assign(new Error(`${label} contains unexpected fields`), { status: 400 });
  }
}

function responseJson(response, status, value, headers = {}) {
  const body = Buffer.from(JSON.stringify(value));
  response.writeHead(status, {
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
    "content-length": body.length,
    "x-content-type-options": "nosniff",
    ...headers,
  });
  response.end(body);
}

async function responseAsset(response, pathname) {
  const asset = WEB_ASSETS[pathname];
  if (!asset) return false;
  const body = await readFile(join(root, "web", asset.file));
  response.writeHead(200, {
    "cache-control": pathname === "/" ? "no-store" : "public, max-age=300",
    "content-type": asset.type,
    "content-length": body.length,
    "content-security-policy": "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
  });
  response.end(body);
  return true;
}

function responseError(response, error) {
  const status = Number.isInteger(error.status) ? error.status : 400;
  responseJson(response, status, { ok: false, error: error.message || "request failed" });
}

function defaultHarnessRunner(command, teamId, submission, env) {
  const binary = env.DRIFT_CHECKER_PATH || join(root, "native", "harness", "target", "release", "overclock-harness");
  const childEnv = { ...env, OVERCLOCK_PROGRAM_PATH: env.DRIFT_PROGRAM_PATH || join(root, "player-kit", "dist", "drift_vault.so") };
  if (command === "check") childEnv.FLAG_SECRET = requiredSecret(env, "FLAG_SECRET");
  const args = command === "target" ? ["target", teamId] : [command];
  const input = command === "target" ? null : JSON.stringify({ teamId, steps: submission.steps });
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { env: childEnv, stdio: ["pipe", "pipe", "pipe"] });
    const stdout = [];
    const stderr = [];
    let outputSize = 0;
    let settled = false;
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(Object.assign(new Error("checker timed out"), { status: 504 }));
    }, Number(env.DRIFT_CHECKER_TIMEOUT_MS || 15_000));
    function finish(error, value) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      error ? reject(error) : resolve(value);
    }
    for (const [stream, chunks] of [[child.stdout, stdout], [child.stderr, stderr]]) {
      stream.on("data", (chunk) => {
        outputSize += chunk.length;
        if (outputSize > MAX_CHILD_OUTPUT_BYTES) {
          child.kill("SIGKILL");
          finish(Object.assign(new Error("checker output exceeded limit"), { status: 500 }));
          return;
        }
        chunks.push(chunk);
      });
    }
    child.on("error", (error) => finish(Object.assign(error, { status: 500 })));
    child.on("close", (code) => {
      if (settled) return;
      if (code !== 0) {
        const message = Buffer.concat(stderr).toString("utf8").trim().split("\n").at(-1) || "checker rejected submission";
        finish(Object.assign(new Error(message), { status: 422 }));
        return;
      }
      try {
        finish(null, JSON.parse(Buffer.concat(stdout).toString("utf8")));
      } catch {
        finish(Object.assign(new Error("checker returned malformed output"), { status: 500 }));
      }
    });
    if (input) child.stdin.end(input);
    else child.stdin.end();
  });
}

function createStateStore(env, { replayPerMinute, submitPerMinute }) {
  const redisUrl = String(env.REDIS_URL || "").trim();
  const requireShared = env.DRIFT_REQUIRE_SHARED_STATE === "true";
  if (!redisUrl && requireShared) {
    throw new Error("REDIS_URL is required when DRIFT_REQUIRE_SHARED_STATE=true");
  }

  if (redisUrl) {
    let client;
    let connecting;
    const connectedClient = async () => {
      if (client?.isReady) return client;
      if (!connecting) {
        client = createClient({
          url: redisUrl,
          socket: { connectTimeout: 3_000, reconnectStrategy: false },
        });
        client.on("error", () => {});
        connecting = client.connect().catch((error) => {
          connecting = null;
          throw Object.assign(new Error(`shared state is unavailable: ${error.message}`), { status: 503 });
        });
      }
      await connecting;
      return client;
    };
    return Object.freeze({
      kind: "redis",
      async consumeTicket(jti, expiresAt, now) {
        const redis = await connectedClient();
        const ttl = Math.max(1, expiresAt - now);
        return (await redis.set(`ctf26:drift:ticket:${jti}`, "1", { NX: true, EX: ttl })) === "OK";
      },
      async rateLimit(teamId, kind, nowMs) {
        const redis = await connectedClient();
        const minute = Math.floor(nowMs / 60_000);
        const key = `ctf26:drift:rate:${teamId}:${kind}:${minute}`;
        const [count] = await redis.multi().incr(key).expire(key, 120).exec();
        const limit = kind === "submit" ? submitPerMinute : replayPerMinute;
        if (Number(count) > limit) {
          throw Object.assign(new Error(`${kind} rate limit exceeded`), { status: 429 });
        }
      },
      async close() {
        if (client?.isOpen) await client.quit().catch(() => {});
      },
    });
  }

  const tickets = new Map();
  const buckets = new Map();
  return Object.freeze({
    kind: "memory",
    async consumeTicket(jti, expiresAt, now) {
      for (const [ticket, expiry] of tickets) if (expiry <= now) tickets.delete(ticket);
      if (tickets.has(jti)) return false;
      tickets.set(jti, expiresAt);
      return true;
    },
    async rateLimit(teamId, kind, nowMs) {
      const minute = Math.floor(nowMs / 60_000);
      const key = `${teamId}:${kind}:${minute}`;
      const next = (buckets.get(key) || 0) + 1;
      buckets.set(key, next);
      if (buckets.size > 4096) {
        for (const bucket of buckets.keys()) if (!bucket.endsWith(`:${minute}`)) buckets.delete(bucket);
      }
      const limit = kind === "submit" ? submitPerMinute : replayPerMinute;
      if (next > limit) throw Object.assign(new Error(`${kind} rate limit exceeded`), { status: 429 });
    },
    async close() {},
  });
}

export function createDriftServer({ env = process.env, runHarness = defaultHarnessRunner } = {}) {
  requiredSecret(env, "CHALLENGE_TICKET_SECRET");
  requiredSecret(env, "DRIFT_SESSION_SECRET");
  requiredSecret(env, "FLAG_SECRET");
  positiveInteger(env, "DRIFT_CHECKER_TIMEOUT_MS", 15_000);
  const state = createStateStore(env, {
    replayPerMinute: positiveInteger(env, "DRIFT_REPLAY_LIMIT_PER_MINUTE", 30),
    submitPerMinute: positiveInteger(env, "DRIFT_SUBMIT_LIMIT_PER_MINUTE", 6),
  });
  const maxConcurrency = positiveInteger(env, "DRIFT_MAX_CONCURRENCY", 4);
  let active = 0;

  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url, "http://drift.invalid");
      if (request.method === "GET" && url.pathname === "/health") {
        responseJson(response, 200, { ok: true, challenge: "DRIFT", execution: "litesvm-exact-sbf" });
        return;
      }
      if (request.method === "GET" && new Set(["/agents.txt", "/robots.txt", "/llms.txt", "/.well-known/agents.txt"]).has(url.pathname)) {
        let session = null;
        try { session = authenticatedTeam(request, env); } catch {}
        const text = session
          ? policyFor({ ...session, challenge: "drift" }, { label: "DRIFT", markerSecret: env.DRIFT_SESSION_SECRET }).text
          : publicPolicyFor({ label: "DRIFT" });
        response.writeHead(200, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", "x-ctf-agent-policy": "/agents.txt" });
        response.end(text);
        return;
      }
      if (request.method === "GET" && await responseAsset(response, url.pathname)) {
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/session") {
        const body = await readJson(request);
        exactObject(body, ["ticket"], "session request");
        const claims = verifyLaunchTicket(body.ticket, env);
        const now = Math.floor(Date.now() / 1000);
        if (!await state.consumeTicket(claims.jti, claims.exp, now)) {
          throw Object.assign(new Error("launch ticket has already been consumed"), { status: 409 });
        }
        const token = sessionForClaims(claims, env);
        responseJson(response, 200, { ok: true, launchMode: "portal" }, {
          "set-cookie": `${SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL_SECONDS}${env.NODE_ENV === "production" ? "; Secure" : ""}`,
        });
        return;
      }

      const session = authenticatedTeam(request, env);
      if (request.method === "POST" && url.pathname === "/api/agent-disclosure") {
        const body = await readJson(request);
        if (!verifyMarker({ ...session, challenge: "drift" }, body.marker, env.DRIFT_SESSION_SECRET)) throw Object.assign(new Error("invalid disclosure marker"), { status: 400 });
        const result = await forwardDisclosure({ identity: { ...session, eventId: "ctf26" }, challenge: "drift", label: "DRIFT", agent: body.agent, model: body.model, requestMeta: { userAgent: String(request.headers["user-agent"] || "") } }, env);
        responseJson(response, 202, result);
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/target") {
        responseJson(response, 200, await runHarness("target", session.teamId, null, env));
        return;
      }
      if (request.method === "GET" && url.pathname === "/artifact/drift_vault.so") {
        const path = env.DRIFT_PROGRAM_PATH || join(root, "player-kit", "dist", "drift_vault.so");
        const info = await stat(path);
        response.writeHead(200, {
          "cache-control": "private, max-age=300",
          "content-type": "application/octet-stream",
          "content-length": info.size,
          "content-disposition": 'attachment; filename="drift_vault.so"',
          "x-content-type-options": "nosniff",
        });
        createReadStream(path).pipe(response);
        return;
      }
      if (request.method === "GET" && url.pathname === "/artifact/player-guide.md") {
        const body = await readFile(join(root, "player-kit", "README.md"));
        response.writeHead(200, {
          "cache-control": "private, max-age=300",
          "content-type": "text/markdown; charset=utf-8",
          "content-length": body.length,
          "content-disposition": 'inline; filename="DRIFT-README.md"',
          "x-content-type-options": "nosniff",
        });
        response.end(body);
        return;
      }
      if (request.method === "POST" && (url.pathname === "/api/replay" || url.pathname === "/api/submit")) {
        const kind = url.pathname.endsWith("submit") ? "submit" : "replay";
        await state.rateLimit(session.teamId, kind, Date.now());
        if (active >= maxConcurrency) throw Object.assign(new Error("checker is busy"), { status: 503 });
        const body = await readJson(request);
        exactObject(body, ["steps"], "submission");
        if (!Array.isArray(body.steps)) throw Object.assign(new Error("steps must be an array"), { status: 400 });
        active += 1;
        try {
          const output = await runHarness(kind === "submit" ? "check" : "replay", session.teamId, body, env);
          responseJson(response, 200, output);
        } finally {
          active -= 1;
        }
        return;
      }
      responseJson(response, 404, { ok: false, error: "not found" });
    } catch (error) {
      responseError(response, error);
    }
  });
  server.on("close", () => void state.close());
  return server;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const port = Number(process.env.PORT || 3020);
  createDriftServer().listen(port, "0.0.0.0", () => {
    process.stdout.write(`DRIFT service listening on ${port}\n`);
  });
}
