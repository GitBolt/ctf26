import assert from "node:assert/strict";
import test from "node:test";

import { issueParticipantTicket } from "@ctf26/participant-ticket";
import { createSignetServer } from "../src/server.mjs";
import { createTargetInventory } from "../src/targets.mjs";

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const TICKET_SECRET = "signet-load-ticket-secret-that-is-long-enough-01";
const env = {
  NODE_ENV: "test",
  ALLOW_LOCAL_DEMO: "false",
  CTF_EVENT_GENERATION: "signet-load-event",
  CHALLENGE_TICKET_SECRET: TICKET_SECRET,
  CHALLENGE_SESSION_SECRET: "signet-load-session-secret-that-is-long-enough-1",
  FLAG_SECRET: "signet-load-flag-secret-that-is-long-enough-0001",
  SIGNET_SESSION_LIMIT_PER_MINUTE: "1000",
  SIGNET_SUBMIT_LIMIT_PER_MINUTE: "100",
  SIGNET_TARGET_LIMIT_PER_MINUTE: "100",
  SIGNET_GLOBAL_SUBMIT_LIMIT_PER_MINUTE: "10000",
  SIGNET_GLOBAL_TARGET_LIMIT_PER_MINUTE: "10000",
  SIGNET_MAX_CONCURRENCY: "4",
  SIGNET_SUBMIT_LEASE_SECONDS: "45",
};

test("an invalid-ticket source cannot consume admission for 40 legitimate launches", async (t) => {
  const floodEnv = {
    ...env,
    CTF_EVENT_GENERATION: "signet-session-flood-event",
    SIGNET_SESSION_ATTEMPT_LIMIT_PER_IP_PER_MINUTE: "25",
    // Above 40 legitimate launches plus the 25 attempts admitted from one source,
    // but below the 200-request flood. This fails if rejected source attempts
    // are allowed to consume the global attempt bucket.
    SIGNET_GLOBAL_SESSION_ATTEMPT_LIMIT_PER_MINUTE: "80",
    SIGNET_SESSION_LIMIT_PER_MINUTE: "41",
    SIGNET_PARTICIPANT_SESSION_LIMIT_PER_MINUTE: "2",
  };
  const server = createSignetServer({ env: floodEnv, reportSolve: async () => {} });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const launch = (ticket, source) => fetch(`${origin}/api/session`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": source },
    body: JSON.stringify({ ticket }),
  });

  const invalid = await Promise.all(Array.from({ length: 200 }, () => launch("not-a-ticket", "198.51.100.9")));
  assert.equal(invalid.filter((response) => response.status === 401).length, 25);
  assert.equal(invalid.filter((response) => response.status === 429).length, 175);

  const tickets = Array.from({ length: 40 }, (_, index) => issueParticipantTicket(
    { audience: "signet", eventId: floodEnv.CTF_EVENT_GENERATION, participantId: `flood-legitimate-${index}` },
    TICKET_SECRET,
    { jti: `signet-flood-legitimate-${index}` },
  ));
  const legitimate = await Promise.all(tickets.map((launchTicket, index) => launch(launchTicket, `203.0.113.${index + 1}`)));
  assert.ok(legitimate.every((response) => response.status === 200));

  const replay = await launch(tickets[0], "203.0.113.1");
  assert.equal(replay.status, 401);
  assert.equal((await replay.json()).error.code, "invalid_ticket");
});

test("40 participant sessions stay isolated while checker work and spam are bounded", async (t) => {
  let activeReports = 0;
  let maximumReports = 0;
  const reports = [];
  const server = createSignetServer({
    env,
    reportSolve: async (event) => {
      activeReports += 1;
      maximumReports = Math.max(maximumReports, activeReports);
      await wait(30);
      reports.push(event);
      activeReports -= 1;
    },
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  const origin = `http://127.0.0.1:${server.address().port}`;

  const participantIds = Array.from({ length: 40 }, (_, index) => `load-participant-${index}`);
  const cookies = new Map();
  await Promise.all(participantIds.map(async (participantId) => {
    const ticket = issueParticipantTicket(
      { audience: "signet", eventId: env.CTF_EVENT_GENERATION, participantId },
      TICKET_SECRET,
      { jti: `signet-load-ticket-${participantId}` },
    );
    const response = await fetch(`${origin}/api/session`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ticket }),
    });
    assert.equal(response.status, 200);
    cookies.set(participantId, response.headers.get("set-cookie").split(";", 1)[0]);
  }));

  for (const participantId of participantIds) {
    const response = await fetch(`${origin}/api/target`, { headers: { cookie: cookies.get(participantId) } });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.identity.participantId, participantId);
    assert.equal(body.target.instanceId, `signet-${participantId}`);
  }

  const submit = (participantId) => fetch(`${origin}/api/submit`, {
    method: "POST",
    headers: { cookie: cookies.get(participantId), "content-type": "application/json" },
    body: JSON.stringify({ signature: "demo-drain" }),
  });
  const firstWave = await Promise.all(participantIds.map(submit));
  assert.equal(firstWave.filter((response) => response.status === 200).length, 4);
  assert.ok(firstWave.filter((response) => response.status === 429).every((response) => response.headers.get("retry-after") === "2"));
  assert.equal(maximumReports, 4);

  for (let index = 0; index < participantIds.length; index += 1) {
    if (firstWave[index].status === 200) continue;
    assert.equal((await submit(participantIds[index])).status, 200);
  }
  for (const participantId of participantIds) {
    const completion = await fetch(`${origin}/api/completion?participantId=${participantId}`, {
      headers: { authorization: `Bearer ${TICKET_SECRET}` },
    });
    assert.equal(completion.status, 200);
    assert.equal((await completion.json()).completed, true);
  }

  const spamParticipant = participantIds[0];
  const beforeSpam = reports.find((event) => event.participantId === spamParticipant);
  const spamWave = await Promise.all(Array.from({ length: 12 }, () => submit(spamParticipant)));
  assert.equal(spamWave.filter((response) => response.status === 200).length, 1);
  assert.ok(spamWave.filter((response) => response.status === 429).every((response) => response.headers.get("retry-after") === "2"));
  const afterSpam = reports.filter((event) => event.participantId === spamParticipant).at(-1);
  assert.equal(afterSpam.sourceId, beforeSpam.sourceId);
  assert.equal(afterSpam.occurredAt, beforeSpam.occurredAt);
  assert.equal(maximumReports, 4);
});

test("public health spam coalesces Redis and RPC probes", async (t) => {
  const productionEnv = {
    NODE_ENV: "production",
    CTF_EVENT_GENERATION: "signet-health-load-event",
    CHALLENGE_TICKET_SECRET: TICKET_SECRET,
    CHALLENGE_SESSION_SECRET: "signet-health-session-secret-that-is-long-enough",
    FLAG_SECRET: "signet-health-flag-secret-that-is-long-enough-001",
    KV_REST_API_URL: "https://redis.invalid",
    KV_REST_API_TOKEN: "redis-token",
    SOLANA_RPC_URL: "https://rpc.invalid",
    SIGNET_HEALTH_CACHE_MS: "15000",
  };
  let redisCalls = 0;
  let rpcCalls = 0;
  const inventory = createTargetInventory(["load-participant-0"], { env: productionEnv });
  const fetchImpl = async (url, options) => {
    await wait(10);
    if (String(url).includes("redis.invalid")) {
      redisCalls += 1;
      const command = JSON.parse(options.body);
      return {
        ok: true,
        async json() {
          return { result: command[0] === "PING" ? "PONG" : JSON.stringify(inventory) };
        },
      };
    }
    rpcCalls += 1;
    return { ok: true, async json() { return { result: "ok" }; } };
  };
  const server = createSignetServer({ env: productionEnv, fetchImpl });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const responses = await Promise.all(Array.from({ length: 40 }, () => fetch(`${origin}/api/health`)));
  assert.ok(responses.every((response) => response.status === 200));
  assert.equal(redisCalls, 2);
  assert.equal(rpcCalls, 1);
});
