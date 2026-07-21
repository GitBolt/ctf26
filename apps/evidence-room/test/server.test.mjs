import assert from "node:assert/strict";
import test from "node:test";

import { issueParticipantTicket } from "@ctf26/participant-ticket";
import { estimateEvidenceRoomCapacity, isAllocationTransaction, isExpectedFactoryInitializationFailure, isSuccessfulCloseTransaction } from "../src/chain.mjs";
import { createEvidenceRoomServer } from "../src/server.mjs";
import { createStore } from "../src/store.mjs";

const TICKET_SECRET = "evidence-room-ticket-secret-that-is-at-least-32-bytes";

test("production refuses volatile challenge state", async () => {
  await assert.rejects(() => createStore({ NODE_ENV: "production" }), /CTF_EVENT_GENERATION|REDIS_URL is required/);
});

test("unsupported client-selected group identity is rejected", async (t) => {
  const service = await createEvidenceRoomServer({ chain: fakeChain(), allowDev: true, reportSolve: async () => {} });
  const address = await service.listen();
  t.after(() => service.close());
  const response = await fetch(`http://127.0.0.1:${address.port}/api/session`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ groupId: "unsupported" }),
  });
  assert.equal(response.status, 400);
});

test("capacity planning reserves four cases per expected participant plus buffer", () => {
  const estimate = estimateEvidenceRoomCapacity({
    expectedParticipants: 50,
    maxBatches: 4,
    tokenRent: 2_039_280,
    mintRent: 1_461_600,
    systemRent: 890_880,
    capacityBufferBps: 1_000,
  });
  assert.deepEqual(estimate, {
    perBatch: 6_431_040,
    perParticipant: 57_185_760,
    baseTotal: 2_859_288_000,
    requiredBalance: 3_145_216_800,
  });
});

function fakeChain() {
  let serial = 0;
  const inspected = new Map();
  const chain = {
    network: "devnet", rpcUrl: "http://fake-rpc",
    async provision(participantId) { return { wallet: `wallet-${participantId}`, factoryMint: `mint-${participantId}`, factoryAuthority: "factory", provisionSignature: "provision" }; },
    walletSecret() { return [1, 2, 3]; },
    async allocate(participantId, nonce, sequence) { serial += 1; return { allocationSignature: `allocation-${serial}`, target: `target-${sequence}`, accounts: [`target-${sequence}`, `decoy-a-${sequence}`, `decoy-b-${sequence}`, `decoy-c-${sequence}`], decoys: [`decoy-a-${sequence}`, `decoy-b-${sequence}`, `decoy-c-${sequence}`] }; },
    async inspect(address) {
      if (!address.startsWith("target-")) return { exists: true, address };
      const count = (inspected.get(address) || 0) + 1; inspected.set(address, count);
      return count === 1 ? { exists: true, address, token: { state: 1, authority: "wallet-evidence-participant", mint: "mint-evidence-participant" } } : { exists: false, address };
    },
    async hasExternalActivity() { return false; },
    async findClose(address) { return { signature: `close-${address}`, slot: 43, blockTime: Math.floor(Date.now() / 1_000) }; },
    async finalize() { return { ok: false, failure: "already-initialized", signature: "factory-failure", slot: 42 }; },
    async health() { return { ok: true, balance: 1 }; },
  };
  return chain;
}

test("only the finalized Token account-already-in-use error is an intended factory failure", () => {
  assert.equal(isExpectedFactoryInitializationFailure({ InstructionError: [0, { Custom: 6 }] }), true);
  assert.equal(isExpectedFactoryInitializationFailure({ InstructionError: [0, { Custom: 1 }] }), false);
  assert.equal(isExpectedFactoryInitializationFailure("BlockhashNotFound"), false);
});

test("close evidence must be a successful transaction and may be an inner instruction", () => {
  const close = { program: "spl-token", parsed: { type: "closeAccount", info: { account: "target", destination: "wallet" } } };
  const transaction = { transaction: { message: { instructions: [] } }, meta: { err: null, innerInstructions: [{ instructions: [close] }] } };
  assert.equal(isSuccessfulCloseTransaction(transaction, { address: "target", destination: "wallet" }), true);
  assert.equal(isSuccessfulCloseTransaction({ ...transaction, meta: { ...transaction.meta, err: { InstructionError: [0, 1] } } }, { address: "target", destination: "wallet" }), false);
});

test("allocation reconciliation only accepts the complete atomic factory transaction", () => {
  const create = (newAccount) => ({ program: "system", parsed: { type: "createAccount", info: { newAccount } } });
  const transaction = { transaction: { message: { instructions: [create("a"), create("b"), create("c"), create("d")] } }, meta: { err: null } };
  assert.equal(isAllocationTransaction(transaction, ["a", "b", "c", "d"]), true);
  assert.equal(isAllocationTransaction(transaction, ["a", "b", "c", "missing"]), false);
  assert.equal(isAllocationTransaction({ ...transaction, meta: { err: "failed" } }, ["a", "b", "c", "d"]), false);
});

test("provisioning retries the reserved deterministic participant instance", async (t) => {
  const chain = fakeChain();
  const provision = chain.provision.bind(chain);
  const nonces = [];
  let interrupted = true;
  chain.provision = async (participantId, nonce) => {
    nonces.push(nonce);
    if (interrupted) {
      interrupted = false;
      throw new Error("transport failed after provisioning");
    }
    return provision(participantId, nonce);
  };
  const service = await createEvidenceRoomServer({ chain, allowDev: true, reportSolve: async () => {} });
  const address = await service.listen();
  t.after(() => service.close());
  const origin = `http://127.0.0.1:${address.port}`;
  const launch = () => fetch(`${origin}/api/session`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ participantId: "provision-retry-participant" }),
  });
  assert.equal((await launch()).status, 500);
  assert.equal((await launch()).status, 201);
  assert.equal(nonces.length, 2);
  assert.equal(nonces[0], nonces[1]);
});

test("a replayed portal ticket releases scarce admission capacity for the next participant", async (t) => {
  const eventId = "ticket-admission-event";
  const store = await createStore({ CTF_EVENT_GENERATION: eventId });
  await store.consumeTicket("already-consumed", Math.floor(Date.now() / 1_000) + 600);
  let provisions = 0;
  const chain = fakeChain();
  const provision = chain.provision.bind(chain);
  chain.provision = async (...args) => { provisions += 1; return provision(...args); };
  const service = await createEvidenceRoomServer({ store, chain, allowDev: false, ticketSecret: TICKET_SECRET, reportSolve: async () => {} });
  const address = await service.listen();
  t.after(() => service.close());
  const origin = `http://127.0.0.1:${address.port}`;
  const launch = (ticket) => fetch(`${origin}/api/session`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ticket }),
  });
  const replayed = issueParticipantTicket({ eventId, audience: "evidence-room", participantId: "replayed-participant" }, TICKET_SECRET, { jti: "already-consumed" });
  assert.equal((await launch(replayed)).status, 401);
  const valid = issueParticipantTicket({ eventId, audience: "evidence-room", participantId: "valid-participant" }, TICKET_SECRET, { jti: "valid-ticket" });
  assert.equal((await launch(valid)).status, 201);
  assert.equal(provisions, 1);
  const browser = await (await fetch(`${origin}/app.js`)).text();
  assert.match(browser, /SESSION_ATTEMPTS = 12/);
  assert.match(browser, /error\.status !== 429/);
});

test("an allocation intent survives a transport failure and is reconciled by the scheduler", async (t) => {
  const chain = fakeChain();
  const allocate = chain.allocate;
  let attempts = 0;
  chain.allocate = async (...args) => {
    attempts += 1;
    if (attempts === 1) throw new Error("connection reset after broadcast");
    return allocate(...args);
  };
  const service = await createEvidenceRoomServer({ chain, allowDev: true, reportSolve: async () => {} });
  const address = await service.listen(); const origin = `http://127.0.0.1:${address.port}`;
  t.after(() => service.close());
  const launched = await fetch(`${origin}/api/session`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ participantId: "intent-participant" }) });
  const cookie = launched.headers.get("set-cookie").split(";")[0];
  const pending = await fetch(`${origin}/api/batches`, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: "{}" });
  assert.equal(pending.status, 202);
  assert.equal((await service.store.getInstance("intent-participant")).batches[0].status, "allocating");
  await service.tick();
  const recovered = await service.store.getInstance("intent-participant");
  assert.equal(recovered.batches[0].status, "allocated");
  assert.equal(recovered.batches[0].allocationSignature, "allocation-1");
});

test("a generic factory failure leaves the batch pending for a safe retry", async (t) => {
  const chain = fakeChain();
  chain.finalize = async () => ({ ok: false, error: "RPC 429" });
  const service = await createEvidenceRoomServer({ chain, allowDev: true, reportSolve: async () => {} });
  const address = await service.listen(); const origin = `http://127.0.0.1:${address.port}`;
  t.after(() => service.close());
  const launched = await fetch(`${origin}/api/session`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ participantId: "transport-participant" }) });
  const cookie = launched.headers.get("set-cookie").split(";")[0];
  await fetch(`${origin}/api/batches`, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: "{}" });
  const instance = await service.store.getInstance("transport-participant");
  instance.batches[0].initializeAt = 0;
  await service.store.putInstance("transport-participant", instance);
  await service.tick();
  assert.equal((await service.store.getInstance("transport-participant")).batches[0].status, "allocated");
});

test("a participant receives a live instance and one verified capture completes it", async (t) => {
  const service = await createEvidenceRoomServer({ chain: fakeChain(), allowDev: true, reportSolve: async () => {} });
  const address = await service.listen(); const origin = `http://127.0.0.1:${address.port}`;
  t.after(() => service.close());
  assert.equal((await fetch(`${origin}/bank-scene.js`)).status, 200);
  assert.equal((await fetch(`${origin}/three.module.js`)).status, 200);
  assert.equal((await fetch(`${origin}/three.core.js`)).status, 200);
  const launched = await fetch(`${origin}/api/session`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ participantId: "evidence-participant" }) });
  assert.equal(launched.status, 201);
  const cookie = launched.headers.get("set-cookie").split(";")[0];
  const auth = { cookie, "content-type": "application/json" };
  const created = await fetch(`${origin}/api/batches`, { method: "POST", headers: auth, body: "{}" });
  assert.equal(created.status, 201);
  const instance = await service.store.getInstance("evidence-participant");
  instance.batches.at(-1).initializeAt = 0;
  await service.store.putInstance("evidence-participant", instance);
  await service.tick();
  const state = await fetch(`${origin}/api/state`, { headers: { cookie } }).then((response) => response.json());
  assert.equal(state.resolvedCases, 1);
  assert.ok(state.completedAt);
  assert.equal((await fetch(`${origin}/api/batches`, { method: "POST", headers: auth, body: "{}" })).status, 409);
});

test("a participant's operator key remains available after a fresh session", async (t) => {
  const service = await createEvidenceRoomServer({ chain: fakeChain(), allowDev: true, reportSolve: async () => {} });
  const address = await service.listen(); const origin = `http://127.0.0.1:${address.port}`;
  t.after(() => service.close());
  const launched = await fetch(`${origin}/api/session`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ participantId: "wallet-participant" }) });
  const cookie = launched.headers.get("set-cookie").split(";")[0];
  const first = await fetch(`${origin}/api/event-wallet`, { headers: { cookie } });
  assert.equal(first.status, 200);
  const firstKey = await first.json();
  assert.match(firstKey.secretKey, /^[1-9A-HJ-NP-Za-km-z]+$/);
  const relaunched = await fetch(`${origin}/api/session`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ participantId: "wallet-participant" }) });
  const freshCookie = relaunched.headers.get("set-cookie").split(";")[0];
  const second = await fetch(`${origin}/api/event-wallet`, { headers: { cookie: freshCookie } });
  assert.equal(second.status, 200);
  assert.deepEqual(await second.json(), firstKey);
});

test("state reads stay available when the chain RPC is temporarily unavailable", async (t) => {
  const chain = fakeChain();
  chain.inspect = async () => { throw new Error("429 Too Many Requests"); };
  const service = await createEvidenceRoomServer({ chain, allowDev: true, reportSolve: async () => {} });
  const address = await service.listen(); const origin = `http://127.0.0.1:${address.port}`;
  t.after(() => service.close());
  const launched = await fetch(`${origin}/api/session`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ participantId: "rpc-participant" }) });
  const cookie = launched.headers.get("set-cookie").split(";")[0];
  assert.equal((await fetch(`${origin}/api/batches`, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: "{}" })).status, 201);
  const response = await fetch(`${origin}/api/state`, { headers: { cookie } });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).batches[0].status, "allocated");
});

test("resolved failures can be retried until the funded case limit", async (t) => {
  const chain = fakeChain();
  chain.inspect = async (address) => ({ exists: true, address });
  chain.finalize = async () => ({ ok: true, signature: "factory-success" });
  const service = await createEvidenceRoomServer({ chain, allowDev: true, batchCooldownMs: 1, maxBatches: 2, reportSolve: async () => {} });
  const address = await service.listen(); const origin = `http://127.0.0.1:${address.port}`;
  t.after(() => service.close());
  const launched = await fetch(`${origin}/api/session`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ participantId: "retry-participant" }) });
  const cookie = launched.headers.get("set-cookie").split(";")[0];
  const headers = { cookie, "content-type": "application/json" };
  assert.equal((await fetch(`${origin}/api/batches`, { method: "POST", headers, body: "{}" })).status, 201);
  const instance = await service.store.getInstance("retry-participant");
  instance.batches[0].initializeAt = 0;
  instance.batches[0].allocatedAt = new Date(0).toISOString();
  await service.store.putInstance("retry-participant", instance);
  await service.tick();
  assert.equal((await fetch(`${origin}/api/batches`, { method: "POST", headers, body: "{}" })).status, 201);
  const second = await service.store.getInstance("retry-participant");
  second.batches[1].initializeAt = 0;
  second.batches[1].allocatedAt = new Date(0).toISOString();
  await service.store.putInstance("retry-participant", second);
  await service.tick();
  const exhausted = await fetch(`${origin}/api/batches`, { method: "POST", headers, body: "{}" });
  assert.equal(exhausted.status, 429);
  assert.equal((await exhausted.json()).error, "case limit reached; ask an event operator for help");
  const state = await fetch(`${origin}/api/state`, { headers: { cookie } }).then((response) => response.json());
  assert.equal(state.casesRemaining, 0);
});

test("an unresolved failed batch expires instead of permanently bricking a participant", async (t) => {
  const chain = fakeChain();
  chain.inspect = async (address) => ({ exists: true, address });
  const service = await createEvidenceRoomServer({ chain, allowDev: true, reportSolve: async () => {} });
  const address = await service.listen(); const origin = `http://127.0.0.1:${address.port}`;
  t.after(() => service.close());
  const launched = await fetch(`${origin}/api/session`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ participantId: "failed-participant" }) });
  const cookie = launched.headers.get("set-cookie").split(";")[0];
  const headers = { cookie, "content-type": "application/json" };
  await fetch(`${origin}/api/batches`, { method: "POST", headers, body: "{}" });
  const instance = await service.store.getInstance("failed-participant");
  instance.batches[0].initializeAt = 0;
  instance.batches[0].resolveBy = 0;
  instance.batches[0].allocatedAt = new Date(0).toISOString();
  await service.store.putInstance("failed-participant", instance);
  await service.tick();
  const state = await fetch(`${origin}/api/state`, { headers: { cookie } }).then((response) => response.json());
  assert.equal(state.batches[0].status, "invalid");
  assert.equal((await fetch(`${origin}/api/batches`, { method: "POST", headers, body: "{}" })).status, 201);
});

test("verified outside interference receives a bounded budget credit", async (t) => {
  const chain = fakeChain();
  chain.inspect = async (address) => address.startsWith("target-")
    ? { exists: true, address, token: { state: 1, authority: "other-wallet", mint: "other-mint" } }
    : { exists: true, address };
  chain.activity = async () => ({ external: true, participantSigned: false, signatures: ["outsider"] });
  const service = await createEvidenceRoomServer({ chain, allowDev: true, maxBatches: 1, interferenceCredits: 1, batchCooldownMs: 1, reportSolve: async () => {} });
  const address = await service.listen(); const origin = `http://127.0.0.1:${address.port}`;
  t.after(() => service.close());
  const launched = await fetch(`${origin}/api/session`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ participantId: "interference-participant" }) });
  const cookie = launched.headers.get("set-cookie").split(";")[0];
  const headers = { cookie, "content-type": "application/json" };
  assert.equal((await fetch(`${origin}/api/batches`, { method: "POST", headers, body: "{}" })).status, 201);
  await service.tick();
  let state = await fetch(`${origin}/api/state`, { headers: { cookie } }).then((response) => response.json());
  assert.equal(state.batches[0].status, "interfered");
  assert.equal(state.casesRemaining, 1);
  assert.equal((await fetch(`${origin}/api/batches`, { method: "POST", headers, body: "{}" })).status, 201);
  await service.tick();
  state = await fetch(`${origin}/api/state`, { headers: { cookie } }).then((response) => response.json());
  assert.equal(state.batches[1].status, "interfered");
  assert.equal(state.casesRemaining, 0);
});

test("completion uses the successful finalized close block time", async (t) => {
  const blockTime = 1_750_000_000;
  const reports = [];
  const chain = fakeChain();
  chain.findClose = async (address) => ({ signature: `close-${address}`, slot: 43, blockTime });
  const service = await createEvidenceRoomServer({ chain, allowDev: true, reportSolve: async (...args) => reports.push(args) });
  const address = await service.listen(); const origin = `http://127.0.0.1:${address.port}`;
  t.after(() => service.close());
  const launched = await fetch(`${origin}/api/session`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ participantId: "evidence-participant" }) });
  const cookie = launched.headers.get("set-cookie").split(";")[0];
  await fetch(`${origin}/api/batches`, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: "{}" });
  const instance = await service.store.getInstance("evidence-participant");
  instance.batches[0].initializeAt = 0;
  await service.store.putInstance("evidence-participant", instance);
  await service.tick();
  const expected = new Date(blockTime * 1_000).toISOString();
  assert.equal((await service.store.getInstance("evidence-participant")).completedAt, expected);
  assert.equal(reports[0][2], expected);
});

test("scheduler serializes participant work that shares the factory payer", async (t) => {
  const chain = fakeChain();
  let active = 0;
  let maximum = 0;
  let inspected = 0;
  chain.inspect = async (address) => {
    active += 1;
    inspected += 1;
    maximum = Math.max(maximum, active);
    await new Promise((resolve) => setTimeout(resolve, 25));
    active -= 1;
    return { exists: true, address };
  };
  const service = await createEvidenceRoomServer({ chain, allowDev: true, schedulerConcurrency: 2, windowMs: 60_000, reportSolve: async () => {} });
  const address = await service.listen(); const origin = `http://127.0.0.1:${address.port}`;
  t.after(() => service.close());
  for (const participantId of ["fair-a", "fair-b", "fair-c"]) {
    const launched = await fetch(`${origin}/api/session`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ participantId }) });
    const cookie = launched.headers.get("set-cookie").split(";")[0];
    await fetch(`${origin}/api/batches`, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: "{}" });
  }
  await service.tick();
  assert.equal(maximum, 1);
  assert.equal(inspected, 3);
});

test("health fails closed when the chain dependency is unavailable", async (t) => {
  const chain = fakeChain();
  chain.health = async () => { throw new Error("RPC unavailable"); };
  const service = await createEvidenceRoomServer({ chain, allowDev: true, reportSolve: async () => {} });
  const address = await service.listen(); const origin = `http://127.0.0.1:${address.port}`;
  t.after(() => service.close());
  const response = await fetch(`${origin}/health`);
  assert.equal(response.status, 503);
  const health = await response.json();
  assert.equal(health.ok, false);
  assert.equal(health.chain.ok, false);
  assert.equal(health.store.ok, true);
});

test("health fails closed when the factory payer cannot cover expected participants", async (t) => {
  const chain = fakeChain();
  chain.health = async () => ({
    ok: false,
    balance: 2_000_000_000,
    requiredBalance: 3_145_216_800,
    estimatedLamportsPerParticipant: 57_185_760,
    expectedParticipants: 50,
  });
  const service = await createEvidenceRoomServer({ chain, allowDev: true, reportSolve: async () => {} });
  const address = await service.listen();
  t.after(() => service.close());
  const response = await fetch(`http://127.0.0.1:${address.port}/health`);
  assert.equal(response.status, 503);
  const health = await response.json();
  assert.equal(health.chain.requiredBalance, 3_145_216_800);
  assert.equal(health.chain.estimatedLamportsPerParticipant, 57_185_760);
});

test("production refuses development identity and fallback secrets", async () => {
  await assert.rejects(() => createEvidenceRoomServer({
    env: { NODE_ENV: "production", CTF_EVENT_GENERATION: "event-a", ALLOW_DEV_LAUNCH: "true" },
    chain: fakeChain(),
  }), /CTF_EVENT_GENERATION|REDIS_URL|PARTICIPANT_TICKET_SECRET|development launch mode/);
});
