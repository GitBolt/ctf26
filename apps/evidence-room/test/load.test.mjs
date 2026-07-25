import assert from "node:assert/strict";
import test from "node:test";

import { issueParticipantTicket } from "@ctf26/participant-ticket";
import { createEvidenceRoomServer } from "../src/server.mjs";

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const TICKET_SECRET = "evidence-room-load-ticket-secret-at-least-32-bytes";
const EVENT = "evidence-room-load-event";

test("one unauthenticated flood cannot deny 50 isolated participants while provisioning and batch spam stay bounded", async (t) => {
  let active = 0;
  let maximum = 0;
  let provisionCalls = 0;
  let allocationCalls = 0;
  let healthCalls = 0;
  const enter = async (ms) => {
    active += 1;
    maximum = Math.max(maximum, active);
    await wait(ms);
    active -= 1;
  };
  const chain = {
    network: "devnet",
    async provision(participantId) {
      provisionCalls += 1;
      await enter(75);
      return { wallet: `wallet-${participantId}`, factoryMint: `mint-${participantId}`, factoryAuthority: "factory", provisionSignature: `provision-${participantId}` };
    },
    walletSecret() { return [1, 2, 3]; },
    async allocate(participantId, nonce, sequence) {
      allocationCalls += 1;
      await enter(30);
      return { allocationSignature: `allocation-${participantId}-${sequence}`, target: `target-${participantId}-${sequence}`, accounts: [], decoys: [] };
    },
    async inspect(address) { return { exists: true, address }; },
    async finalize() { return { ok: true, signature: "finalized", slot: 1 }; },
    async findClose() { return null; },
    async hasExternalActivity() { return false; },
    async health() { healthCalls += 1; await wait(10); return { ok: true, balance: 9_000_000_000 }; },
  };
  const service = await createEvidenceRoomServer({
    chain,
    allowDev: false,
    ticketSecret: TICKET_SECRET,
    env: { CTF_EVENT_GENERATION: EVENT },
    reportSolve: async () => {},
    preAuthIpLimit: 8,
    preAuthGlobalLimit: 200,
    sessionLimit: 200,
    participantOperationLimit: 100,
    globalOperationLimit: 10_000,
    maxExpensiveConcurrency: 1,
    operationTimeoutMs: 1_000,
    operationLeaseMs: 2_000,
    healthCacheMs: 15_000,
  });
  const address = await service.listen();
  t.after(() => service.close());
  const origin = `http://127.0.0.1:${address.port}`;

  const health = await Promise.all(Array.from({ length: 50 }, () => fetch(`${origin}/health`)));
  assert.ok(health.every((response) => response.status === 200));
  assert.equal(healthCalls, 1);
  const browser = await (await fetch(`${origin}/app.js`)).text();
  assert.match(browser, /SESSION_ATTEMPTS = 12/);
  assert.match(browser, /error\.status !== 429/);

  const invalidFlood = await Promise.all(Array.from({ length: 120 }, () => fetch(`${origin}/api/session`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.77" },
    body: JSON.stringify({ ticket: "not-a-ticket" }),
  })));
  assert.equal(invalidFlood.filter((response) => response.status === 401).length, 8);
  assert.equal(invalidFlood.filter((response) => response.status === 429).length, 112);

  const participantIds = Array.from({ length: 50 }, (_, index) => `load-participant-${index}`);
  const tickets = new Map(participantIds.map((participantId, index) => [participantId, issueParticipantTicket({ eventId: EVENT, audience: "evidence-room", participantId }, TICKET_SECRET, { jti: `load-${index}` })]));
  const participantIps = new Map(participantIds.map((participantId, index) => [participantId, `198.51.100.${index + 1}`]));
  const launch = (participantId, ticket = tickets.get(participantId)) => fetch(`${origin}/api/session`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": participantIps.get(participantId) },
    body: JSON.stringify({ ticket }),
  });
  const admissionBlocker = await service.store.acquireOperation("load-blocker", {
    ttlMs: 5_000,
    maxConcurrency: 1,
  });
  assert.ok(admissionBlocker);
  const firstWave = await Promise.all(participantIds.map((participantId) => launch(participantId)));
  const rejected = firstWave.filter((response) => response.status === 429);
  assert.equal(rejected.length, participantIds.length, JSON.stringify(firstWave.map(({ status }) => status)));
  assert.ok(rejected.every((response) => response.headers.get("retry-after") === "2"));
  await service.store.releaseOperation(admissionBlocker);

  const cookies = new Map();
  for (let index = 0; index < participantIds.length; index += 1) {
    const response = await launch(participantIds[index]);
    assert.equal(response.status, 201);
    cookies.set(participantIds[index], response.headers.get("set-cookie").split(";", 1)[0]);
  }
  assert.equal((await launch(participantIds[0])).status, 401);
  assert.equal(provisionCalls, 50);
  assert.equal(maximum, 1);
  for (const participantId of participantIds) {
    const instance = await service.store.getInstance(participantId);
    assert.equal(instance.participantId, participantId);
    assert.equal(instance.wallet, `wallet-${participantId}`);
  }

  const spamParticipant = participantIds[0];
  const spam = () => fetch(`${origin}/api/batches`, {
    method: "POST",
    headers: { cookie: cookies.get(spamParticipant), "content-type": "application/json" },
    body: "{}",
  });
  const spamWave = await Promise.all(Array.from({ length: 12 }, spam));
  assert.equal(spamWave.filter((response) => response.status === 201).length, 1);
  assert.ok(spamWave.filter((response) => response.status === 429).every((response) => response.headers.get("retry-after") === "2"));
  assert.equal(allocationCalls, 1);
  assert.equal((await service.store.getInstance(spamParticipant)).batches.length, 1);
  assert.equal(maximum, 1);
});
