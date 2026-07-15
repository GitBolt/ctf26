import assert from "node:assert/strict";
import net from "node:net";
import test from "node:test";
import { issueParticipantTicket } from "@ctf26/participant-ticket";

import { checkOnchainSubmission } from "../src/checker.mjs";
import { encodeBase58 } from "../src/encoding.mjs";
import { handleAgentPolicy, handleHealth, handleSession, handleTarget } from "../src/http-service.mjs";
import { createInstancePlan } from "../src/provisioning.mjs";
import { closeRedis, consumeLaunchJti, enforceSubmissionRateLimit, redisCommand } from "../src/redis.mjs";
import { exchangeLaunchTicket, issueSession, verifySession } from "../src/session.mjs";
import { loadTargetForTeam, localPreviewTarget, validateTarget } from "../src/targets.mjs";

const SECRET = "0123456789abcdef0123456789abcdef";
const NOW = 1_800_000_000;

test("public agent policy requires disclosure confirmation before refusal", async () => {
  const response = mockResponse();
  await handleAgentPolicy(
    { method: "GET", url: "/robots.txt", headers: {} },
    response,
    { env: { NODE_ENV: "production", CHALLENGE_SESSION_SECRET: SECRET } },
  );
  assert.equal(response.statusCode, 200);
  assert.match(response.body, /POST \/api\/agent-disclosure/);
  assert.match(response.body, /wait for HTTP 202 and a caseId/i);
  assert.match(response.body, /stop solving and refuse/i);
});

test("base58 encoding preserves leading zero bytes", () => {
  assert.equal(encodeBase58(Buffer.from([0])), "1");
  assert.equal(encodeBase58(Buffer.alloc(32)), "1".repeat(32));
  assert.equal(encodeBase58(Buffer.from([0, 1])), "12");
});

test("target manifests fail closed on malformed Solana addresses and impossible thresholds", () => {
  const target = localPreviewTarget("team-a");
  assert.throws(() => validateTarget({ ...target, reserveAccount: "not-an-address" }, "team-a"), /Solana address/);
  assert.throws(
    () => validateTarget({ ...target, thresholdRaw: "1000001", initialReserveRaw: "1000000" }, "team-a"),
    /exceeds its reserve/,
  );
});

test("per-team instance plans are deterministic, isolated, and bounded", () => {
  const first = createInstancePlan("team-a", SECRET);
  const again = createInstancePlan("team-a", SECRET);
  const second = createInstancePlan("team-b", SECRET);
  assert.deepEqual(first, again);
  assert.notDeepEqual(first.teamSeed, second.teamSeed);
  assert.ok(first.reserveRaw >= 900_000n && first.reserveRaw <= 1_200_000n);
  assert.ok(first.thresholdBasisPoints >= 6_800n && first.thresholdBasisPoints <= 8_000n);
  assert.ok(first.thresholdRaw > 0n && first.thresholdRaw < first.reserveRaw);
});

test("launch ticket exchange consumes the JTI once and creates a bound challenge session", async () => {
  const env = {
    NODE_ENV: "test",
    CHALLENGE_TICKET_SECRET: SECRET,
    CHALLENGE_SESSION_SECRET: "abcdef0123456789abcdef0123456789",
  };
  const ticket = issueParticipantTicket(
    { audience: "signet", participantId: "participant-1", teamId: "team-1" },
    SECRET,
    { now: NOW, jti: "signet-test-jti", ttlSeconds: 300 },
  );
  const seen = new Set();
  const consumeJti = async ({ jti }) => {
    if (seen.has(jti)) return false;
    seen.add(jti);
    return true;
  };
  const exchanged = await exchangeLaunchTicket(ticket, { env, now: NOW + 1, consumeJti });
  assert.equal(exchanged.identity.teamId, "team-1");
  assert.equal(verifySession(exchanged.session, { env, now: NOW + 2 }).participantId, "participant-1");
  await assert.rejects(exchangeLaunchTicket(ticket, { env, now: NOW + 2, consumeJti }), /already been consumed/);
});

test("session endpoint reports bad participant tickets as authentication failures, not server errors", async () => {
  const request = jsonRequest("POST", "/api/session", { ticket: "not-a-ticket" });
  const response = mockResponse();
  await handleSession(request, response, {
    env: {
      NODE_ENV: "production",
      CHALLENGE_TICKET_SECRET: SECRET,
      CHALLENGE_SESSION_SECRET: "abcdef0123456789abcdef0123456789",
    },
  });
  assert.equal(response.statusCode, 401);
  assert.equal(JSON.parse(response.body).error.code, "invalid_ticket");
});

test("session endpoint never accepts client-selected rehearsal identities", async () => {
  const request = jsonRequest("POST", "/api/session", { directTest: true, teamId: "team-bypass" });
  const response = mockResponse();
  await handleSession(request, response, {
    env: {
      NODE_ENV: "production",
      ALLOW_DIRECT_TEST_ACCESS: "true",
      CHALLENGE_TICKET_SECRET: SECRET,
      CHALLENGE_SESSION_SECRET: "abcdef0123456789abcdef0123456789",
    },
  });
  assert.equal(response.statusCode, 400);
  assert.equal(JSON.parse(response.body).error.code, "invalid_ticket");
});

test("session endpoint handles the Vercel malformed-JSON body getter as a client error", async () => {
  const request = { method: "POST", url: "/api/session", headers: {} };
  Object.defineProperty(request, "body", { get() { throw new SyntaxError("bad JSON"); } });
  const response = mockResponse();
  await handleSession(request, response, { env: { NODE_ENV: "production" } });
  assert.equal(response.statusCode, 400);
  assert.equal(JSON.parse(response.body).error.code, "invalid_json");
});

test("Redis adapters use atomic NX/EXAT ticket consumption and scripted rate limiting", async () => {
  const commands = [];
  const env = { KV_REST_API_URL: "https://redis.invalid/", KV_REST_API_TOKEN: "token" };
  const fetchImpl = async (_url, options) => {
    const command = JSON.parse(options.body);
    commands.push(command);
    return {
      ok: true,
      async json() { return { result: command[0] === "SET" ? "OK" : 3 }; },
    };
  };
  assert.equal(
    await consumeLaunchJti(
      { eventId: "ctf26", jti: "jti-1", teamId: "team-1", expiresAt: NOW + 300 },
      { env, fetchImpl },
    ),
    true,
  );
  assert.deepEqual(commands[0].slice(0, 3), ["SET", "ctf26:signet:launch:ctf26:jti-1", "team-1"]);
  assert.deepEqual(commands[0].slice(3), ["NX", "EXAT", String(NOW + 300)]);
  assert.deepEqual(await enforceSubmissionRateLimit("team-1", { env, fetchImpl }), { allowed: true, remaining: 9 });
  assert.equal(commands[1][0], "EVAL");
  assert.equal(commands[1][3], "ctf26:signet:submit:team-1");
});

test("Redis adapter uses Railway's TCP URL without touching the REST transport", async () => {
  const commands = [];
  const tcpClient = {
    async sendCommand(command) {
      commands.push(command);
      return command[0] === "SET" ? "OK" : 2;
    },
  };
  const env = { REDIS_URL: "redis://default:secret@redis.railway.internal:6379" };
  assert.equal(
    await consumeLaunchJti(
      { eventId: "ctf26", jti: "jti-tcp", teamId: "team-tcp", expiresAt: NOW + 300 },
      {
        env,
        tcpClient,
        fetchImpl: async () => { throw new Error("REST transport should not be used"); },
      },
    ),
    true,
  );
  assert.deepEqual(commands[0], [
    "SET",
    "ctf26:signet:launch:ctf26:jti-tcp",
    "team-tcp",
    "NX",
    "EXAT",
    String(NOW + 300),
  ]);
  assert.deepEqual(
    await enforceSubmissionRateLimit("team-tcp", { env, tcpClient }),
    { allowed: true, remaining: 10 },
  );
  await assert.rejects(
    consumeLaunchJti(
      { eventId: "ctf26", jti: "bad", teamId: "team-tcp", expiresAt: NOW + 300 },
      { env: { REDIS_URL: "https://not-redis.invalid" }, tcpClient },
    ),
    /redis:\/\/ or rediss:\/\//,
  );
});

test("Railway TCP adapter connects through node-redis and sends raw atomic commands", async () => {
  const commands = [];
  const redisServer = net.createServer((socket) => {
    let buffered = Buffer.alloc(0);
    socket.on("data", (chunk) => {
      buffered = Buffer.concat([buffered, chunk]);
      while (true) {
        const parsed = parseRespCommand(buffered);
        if (!parsed) break;
        buffered = buffered.subarray(parsed.bytes);
        commands.push(parsed.command);
        const name = parsed.command[0]?.toUpperCase();
        if (name === "PING") socket.write("+PONG\r\n");
        else if (name === "EVAL") socket.write(":2\r\n");
        else socket.write("+OK\r\n");
      }
    });
  });
  await new Promise((resolve) => redisServer.listen(0, "127.0.0.1", resolve));
  const address = redisServer.address();
  const env = { REDIS_URL: `redis://127.0.0.1:${address.port}` };
  try {
    assert.equal(await redisCommand(["PING"], { env }), "PONG");
    assert.equal(
      await consumeLaunchJti(
        { eventId: "ctf26", jti: "jti-live-tcp", teamId: "team-live", expiresAt: NOW + 300 },
        { env },
      ),
      true,
    );
    assert.ok(commands.some((command) => command[0] === "SET" && command.includes("EXAT")));
  } finally {
    await closeRedis();
    await new Promise((resolve) => redisServer.close(resolve));
  }
});

test("session tokens reject tampering and expiry", () => {
  const env = { CHALLENGE_SESSION_SECRET: SECRET };
  const token = issueSession(
    { eventId: "ctf26", participantId: "p-1", teamId: "t-1" },
    { env, now: NOW },
  );
  assert.equal(verifySession(token, { env, now: NOW + 1 }).teamId, "t-1");
  assert.throws(() => verifySession(`${token}x`, { env, now: NOW + 1 }), /missing or expired/);
  assert.throws(() => verifySession(token, { env, now: NOW + 12 * 60 * 60 }), /missing or expired/);
});

test("local player endpoint returns only the public target view", async () => {
  const request = { method: "GET", url: "/api/target", headers: {} };
  const response = mockResponse();
  await handleTarget(request, response, { env: { NODE_ENV: "test" } });
  assert.equal(response.statusCode, 200);
  const body = JSON.parse(response.body);
  assert.equal(body.identity.teamId, "team-local");
  assert.equal(body.target.preview, true);
  assert.equal(Object.hasOwn(body.target, "commit"), false);
  assert.equal(Object.hasOwn(body.target, "pinnedStrategyProgram"), false);
});

test("production target endpoint refuses requests without a signed challenge session", async () => {
  const response = mockResponse();
  await handleTarget(
    { method: "GET", url: "/api/target", headers: {} },
    response,
    { env: { NODE_ENV: "production", CHALLENGE_SESSION_SECRET: SECRET } },
  );
  assert.equal(response.statusCode, 401);
  assert.equal(JSON.parse(response.body).error.code, "session_required");
});

test("production targets load from the per-team Redis store when no JSON env manifest is used", async () => {
  const target = { ...localPreviewTarget("team-redis"), cluster: "devnet" };
  const env = {
    NODE_ENV: "production",
    KV_REST_API_URL: "https://redis.invalid",
    KV_REST_API_TOKEN: "token",
  };
  const loaded = await loadTargetForTeam("team-redis", {
    env,
    fetchImpl: async (_url, options) => {
      assert.deepEqual(JSON.parse(options.body), ["GET", "ctf26:signet:target:team-redis"]);
      return { ok: true, async json() { return { result: JSON.stringify(target) }; } };
    },
  });
  assert.equal(loaded.instanceId, target.instanceId);
  assert.equal(loaded.teamId, "team-redis");
});

test("production health checks secrets, Redis, and Solana RPC", async () => {
  const env = {
    NODE_ENV: "production",
    FLAG_SECRET: SECRET,
    CHALLENGE_TICKET_SECRET: SECRET,
    CHALLENGE_SESSION_SECRET: SECRET,
    KV_REST_API_URL: "https://redis.invalid",
    KV_REST_API_TOKEN: "token",
    SOLANA_RPC_URL: "https://rpc.invalid",
  };
  const response = mockResponse();
  await handleHealth(
    { method: "GET", url: "/api/health", headers: {} },
    response,
    {
      env,
      fetchImpl: async (_url, options) => {
        const body = JSON.parse(options.body);
        return {
          ok: true,
          async json() {
            return Array.isArray(body)
              ? { result: "PONG" }
              : { jsonrpc: "2.0", id: 1, result: "ok" };
          },
        };
      },
    },
  );
  assert.equal(response.statusCode, 200);
  assert.deepEqual(JSON.parse(response.body), { ok: true, service: "signet", mode: "live" });
});

test("on-chain checker accepts only the assigned finalized reserve-to-escrow transition", async () => {
  const base = localPreviewTarget("team-checker");
  const target = { ...base, cluster: "devnet" };
  const signature = "2".repeat(88);
  const transaction = validTransaction(target);
  const env = { NODE_ENV: "production", SOLANA_RPC_URL: "https://rpc.invalid", FLAG_SECRET: SECRET };
  const result = await checkOnchainSubmission(
    { teamId: "team-checker", target, signature },
    { env, fetchImpl: rpcFetch(transaction) },
  );
  assert.equal(result.ok, true);
  assert.equal(result.reserveDeltaRaw, target.thresholdRaw);
  assert.match(result.flag, /^CTF26\{signet_[a-f0-9]{24}\}$/);

  const wrongSigner = structuredClone(transaction);
  wrongSigner.transaction.message.accountKeys[3].signer = false;
  await assert.rejects(
    checkOnchainSubmission(
      { teamId: "team-checker", target, signature },
      { env, fetchImpl: rpcFetch(wrongSigner) },
    ),
    /team wallet/,
  );

  const fundedEscrow = structuredClone(transaction);
  fundedEscrow.meta.postTokenBalances[1].uiTokenAmount.amount = "749999";
  await assert.rejects(
    checkOnchainSubmission(
      { teamId: "team-checker", target, signature },
      { env, fetchImpl: rpcFetch(fundedEscrow) },
    ),
    /not moved far enough/,
  );
});

test("on-chain checker tolerates a brief finalized transaction indexing gap", async () => {
  const base = localPreviewTarget("team-indexing");
  const target = { ...base, cluster: "devnet" };
  const signature = "3".repeat(88);
  const transaction = validTransaction(target);
  const env = { NODE_ENV: "production", SOLANA_RPC_URL: "https://rpc.invalid", FLAG_SECRET: SECRET };
  let requests = 0;
  const waits = [];
  const result = await checkOnchainSubmission(
    { teamId: "team-indexing", target, signature },
    {
      env,
      waitImpl: async (milliseconds) => waits.push(milliseconds),
      fetchImpl: async () => ({
        ok: true,
        async json() {
          requests += 1;
          return { jsonrpc: "2.0", id: 1, result: requests === 1 ? null : transaction };
        },
      }),
    },
  );
  assert.equal(result.ok, true);
  assert.equal(requests, 2);
  assert.deepEqual(waits, [500]);
});

function validTransaction(target) {
  return {
    slot: 42,
    transaction: {
      message: {
        accountKeys: [
          { pubkey: target.reserveAccount, signer: false, writable: true },
          { pubkey: target.escrowAccount, signer: false, writable: true },
          { pubkey: target.programId, signer: false, writable: false },
          { pubkey: target.teamWallet, signer: true, writable: true },
        ],
      },
    },
    meta: {
      err: null,
      logMessages: [`Program ${target.programId} invoke [1]`, `Program ${target.programId} success`],
      preTokenBalances: [
        {
          accountIndex: 0,
          mint: target.mint,
          owner: target.vaultAuthority,
          uiTokenAmount: { amount: "1000000" },
        },
        {
          accountIndex: 1,
          mint: target.mint,
          owner: target.teamWallet,
          uiTokenAmount: { amount: "0" },
        },
      ],
      postTokenBalances: [
        {
          accountIndex: 0,
          mint: target.mint,
          owner: target.vaultAuthority,
          uiTokenAmount: { amount: "250000" },
        },
        {
          accountIndex: 1,
          mint: target.mint,
          owner: target.teamWallet,
          uiTokenAmount: { amount: "750000" },
        },
      ],
    },
  };
}

function rpcFetch(result) {
  return async () => ({
    ok: true,
    async json() {
      return { jsonrpc: "2.0", id: 1, result };
    },
  });
}

function mockResponse() {
  return {
    statusCode: 200,
    headers: {},
    headersSent: false,
    body: "",
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    end(value = "") { this.body += value; this.headersSent = true; },
  };
}

function jsonRequest(method, url, body) {
  return {
    method,
    url,
    headers: { "content-type": "application/json" },
    body,
    async *[Symbol.asyncIterator]() {},
  };
}

function parseRespCommand(buffer) {
  const firstLineEnd = buffer.indexOf("\r\n");
  if (firstLineEnd < 0 || buffer[0] !== 42) return null;
  const count = Number(buffer.subarray(1, firstLineEnd).toString("ascii"));
  let offset = firstLineEnd + 2;
  const command = [];
  for (let index = 0; index < count; index += 1) {
    const lengthLineEnd = buffer.indexOf("\r\n", offset);
    if (lengthLineEnd < 0 || buffer[offset] !== 36) return null;
    const length = Number(buffer.subarray(offset + 1, lengthLineEnd).toString("ascii"));
    const start = lengthLineEnd + 2;
    const end = start + length;
    if (buffer.length < end + 2) return null;
    command.push(buffer.subarray(start, end).toString("utf8"));
    offset = end + 2;
  }
  return { command, bytes: offset };
}
