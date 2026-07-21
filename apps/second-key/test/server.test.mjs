import assert from "node:assert/strict";
import test from "node:test";

import { issueParticipantTicket } from "@ctf26/participant-ticket";
import { createSecondKeyChain, estimateSecondKeyCapacity, evaluateSecondKeyPayerCapacity, isSuccessfulPledgeTransaction, isSuccessfulRemovalTransaction } from "../src/chain.mjs";
import { createSecondKeyServer } from "../src/server.mjs";
import { createStore } from "../src/store.mjs";

const TICKET_SECRET = "second-key-ticket-secret-that-is-at-least-32-bytes";

test("production refuses volatile challenge state", async () => {
  await assert.rejects(() => createStore({ NODE_ENV: "production", CTF_EVENT_GENERATION: "event-a" }), /REDIS_URL is required/);
});

test("read capacity stays available while the shared-payer write slot is occupied", async () => {
  const store = await createStore({ CTF_EVENT_GENERATION: "operation-pools" });
  const write = await store.acquireOperation("writer", { ttlMs: 5_000, maxConcurrency: 1, pool: "write" });
  assert.ok(write);
  assert.equal(await store.acquireOperation("second-writer", { ttlMs: 5_000, maxConcurrency: 1, pool: "write" }), null);

  const read = await store.acquireOperation("reader", { ttlMs: 5_000, maxConcurrency: 2, pool: "read" });
  assert.ok(read);
  assert.equal(await store.acquireOperation("writer", { ttlMs: 5_000, maxConcurrency: 2, pool: "read" }), null);

  await store.releaseOperation(read);
  await store.releaseOperation(write);
  assert.ok(await store.acquireOperation("second-writer", { ttlMs: 5_000, maxConcurrency: 1, pool: "write" }));
});

test("unsupported client-selected group identity is rejected", async (t) => {
  const service = await createSecondKeyServer({ chain: fakeChain(), allowDev: true, reportSolve: async () => {} });
  t.after(() => service.close());
  const address = await service.listen();
  const response = await fetch(`http://127.0.0.1:${address.port}/api/session`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ groupId: "unsupported" }),
  });
  assert.equal(response.status, 400);
});

test("production pins the Second Key RPC and program explicitly", () => {
  assert.throws(() => createSecondKeyChain({ NODE_ENV: "production" }), /SOLANA_RPC_URL is required in production/);
  assert.throws(() => createSecondKeyChain({ NODE_ENV: "production", SOLANA_RPC_URL: "https://rpc.example" }), /SECOND_KEY_PROGRAM_ID is required in production/);
});

test("payer capacity budgets every remaining participant and fails closed when underfunded", () => {
  const inputs = {
    expectedParticipants: 50,
    provisionedParticipants: 10,
    mintRent: 2_000_000,
    tokenAccountRent: 2_100_000,
    loanRent: 1_700_000,
    feeBudgetLamports: 100_000,
    capacityBufferBps: 1_000,
  };
  const capacity = estimateSecondKeyCapacity(inputs);
  assert.equal(capacity.perParticipantLamports, 48_000_000);
  assert.equal(capacity.remainingParticipants, 40);
  assert.equal(capacity.baseRemainingBalance, 1_920_000_000);
  assert.equal(capacity.requiredRemainingBalance, 2_112_000_000);
  assert.deepEqual(capacity.components, {
    walletFundingLamports: 30_000_000,
    mintRentLamports: 2_000_000,
    tokenAccountsRentLamports: 4_200_000,
    loanRentLamports: 1_700_000,
    advanceLamports: 10_000_000,
    feeBudgetLamports: 100_000,
  });
  assert.equal(evaluateSecondKeyPayerCapacity({ ...inputs, balance: 2_111_999_999, minimumPayerBalance: 100_000_000 }).ok, false);
  assert.equal(evaluateSecondKeyPayerCapacity({ ...inputs, balance: 2_112_000_000, minimumPayerBalance: 100_000_000 }).ok, true);
});

test("health supplies the generation-scoped provision count and exposes an underfunded field", async (t) => {
  const store = await createStore({ CTF_EVENT_GENERATION: "capacity-event" });
  await store.putInstance("allocated-participant", {
    participantId: "allocated-participant",
    wallet: "wallet111",
    mint: "mint111",
    loan: "loan111",
  });
  const chain = fakeChain();
  let observedProvisioned = null;
  chain.health = async ({ provisionedParticipants }) => {
    observedProvisioned = provisionedParticipants;
    return { ok: false, balance: 99, requiredBalance: 100, capacity: { provisionedParticipants } };
  };
  const service = await createSecondKeyServer({ chain, store, allowDev: true, reportSolve: async () => {} });
  t.after(() => service.close());
  const address = await service.listen();
  const response = await fetch(`http://127.0.0.1:${address.port}/health`);
  assert.equal(response.status, 503);
  assert.equal(observedProvisioned, 1);
  const body = await response.json();
  assert.equal(body.requiredBalance, 100);
  assert.equal(body.capacity.provisionedParticipants, 1);
});

function fakeChain() {
  let pledged = false;
  let recovered = false;
  let pledgeCalls = 0;
  return {
    network: "devnet",
    rpcUrl: "https://api.devnet.solana.com",
    programId: "NcPgcz4zQ2CKZK6evWYwGC6iFcdji2Yrw65nCoto5rn",
    async provision() { return { wallet: "wallet111", mint: "mint111", source: "source111", vault: "vault111", vaultAuthority: "authority111", loan: "loan111", programId: this.programId, certificate: "cert111" }; },
    async pledge() { pledgeCalls += 1; pledged = true; return "pledge-signature"; },
    async inspect() { return { sourceBalance: recovered || !pledged ? 1 : 0, vaultBalance: pledged && !recovered ? 1 : 0, outstanding: pledged, advanceLamports: pledged ? 10_000_000 : 0, walletBalance: 20_000_000 }; },
    async findPledge() { return pledged ? { signature: "pledge-signature", pledgedAt: "2026-07-21T00:00:00.000Z" } : null; },
    async findRemoval() { return recovered ? { signature: "removal-signature", completedAt: "2026-07-21T00:01:00.000Z" } : null; },
    walletSecret() { return [1, 2, 3, 4]; },
    async health() { return { ok: true, balance: 1 }; },
    recover() { recovered = true; },
    pledgeCalls() { return pledgeCalls; },
  };
}

test("provisioning retries the reserved deterministic case after an interrupted worker", async (t) => {
  const chain = fakeChain();
  const provision = chain.provision.bind(chain);
  const nonces = [];
  let interrupt = true;
  chain.provision = async (participantId, nonce) => {
    nonces.push(nonce);
    if (interrupt) {
      interrupt = false;
      throw new Error("worker interrupted after allocation");
    }
    return provision(participantId, nonce);
  };
  const service = await createSecondKeyServer({ chain, allowDev: true, ticketSecret: TICKET_SECRET });
  const address = await service.listen(0);
  t.after(() => service.close());
  const origin = `http://127.0.0.1:${address.port}`;
  const launchRequest = () => fetch(`${origin}/api/session`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ participantId: "allocation-retry-participant" }),
  });
  assert.equal((await launchRequest()).status, 500);
  assert.equal((await launchRequest()).status, 201);
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
  const service = await createSecondKeyServer({ store, chain, allowDev: false, ticketSecret: TICKET_SECRET, env: { CTF_EVENT_GENERATION: eventId }, reportSolve: async () => {} });
  const address = await service.listen();
  t.after(() => service.close());
  const origin = `http://127.0.0.1:${address.port}`;
  const launch = (ticket) => fetch(`${origin}/api/session`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ticket }),
  });
  const replayed = issueParticipantTicket({ eventId, audience: "second-key", participantId: "replayed-participant" }, TICKET_SECRET, { jti: "already-consumed" });
  assert.equal((await launch(replayed)).status, 401);
  const valid = issueParticipantTicket({ eventId, audience: "second-key", participantId: "valid-participant" }, TICKET_SECRET, { jti: "valid-ticket" });
  assert.equal((await launch(valid)).status, 201);
  assert.equal(provisions, 1);
  const browser = await (await fetch(`${origin}/app.js`)).text();
  assert.match(browser, /SESSION_ATTEMPTS = 12/);
  assert.match(browser, /error\.status !== 429/);
});

async function launch(service, participantId = "desk-participant") {
  const address = await service.listen(0);
  const origin = `http://127.0.0.1:${address.port}`;
  const response = await fetch(`${origin}/api/session`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ participantId }) });
  assert.equal(response.status, 201);
  return { origin, cookie: response.headers.get("set-cookie").split(";")[0] };
}

test("the desk completes only after collateral leaves the vault while the advance stays open", async (t) => {
  const chain = fakeChain();
  const reports = [];
  const service = await createSecondKeyServer({ chain, allowDev: true, ticketSecret: TICKET_SECRET, reportSolve: async (identity, sourceId) => reports.push({ identity, sourceId }) });
  t.after(() => service.close());
  const { origin, cookie } = await launch(service);
  const call = (path, init = {}) => fetch(`${origin}${path}`, { ...init, headers: { cookie, "content-type": "application/json", ...(init.headers || {}) } });

  assert.equal((await (await call("/api/state")).json()).outstanding, false);
  assert.equal((await call("/api/pledge", { method: "POST", body: "{}" })).status, 201);
  let state = await (await call("/api/state")).json();
  assert.equal(state.outstanding, true);
  assert.equal(state.vaultBalance, 1);
  assert.equal(state.completedAt, null);
  assert.equal(state.mint, "mint111");
  assert.equal(state.programId, chain.programId);
  assert.equal(state.wallet, "wallet111");
  assert.equal(state.vaultAuthority, "authority111");

  chain.recover();
  state = await (await call("/api/state")).json();
  assert.equal(state.outstanding, true);
  assert.equal(state.vaultBalance, 0);
  assert.equal(state.sourceBalance, 1);
  assert.equal(state.completedAt, "2026-07-21T00:01:00.000Z");
  assert.equal(state.removalSignature, "removal-signature");
  assert.equal(reports.length, 1);
  const completion = await fetch(`${origin}/api/completion?participantId=desk-participant`, {
    headers: { authorization: `Bearer ${TICKET_SECRET}` },
  });
  assert.equal(completion.status, 200);
  assert.deepEqual(await completion.json(), { completed: true, completedAt: "2026-07-21T00:01:00.000Z", eventGeneration: "rehearsal" });
});

test("removal evidence must succeed and supports parsed inner Token-2022 instructions", () => {
  const instruction = {
    programId: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
    parsed: { type: "transferChecked", info: { source: "vault", destination: "source", authority: "wallet", tokenAmount: { amount: "1" } } },
  };
  const transaction = { transaction: { message: { instructions: [] } }, meta: { err: null, innerInstructions: [{ instructions: [instruction] }] } };
  assert.equal(isSuccessfulRemovalTransaction(transaction, { vault: "vault", source: "source", wallet: "wallet" }), true);
  assert.equal(isSuccessfulRemovalTransaction({ ...transaction, meta: { ...transaction.meta, err: { InstructionError: [0, 1] } } }, { vault: "vault", source: "source", wallet: "wallet" }), false);
});

test("pledge recovery requires the successful exact lending instruction", () => {
  const instruction = {
    programId: "program",
    accounts: ["loan", "wallet", "source", "vault", "mint", "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"],
    data: "2",
  };
  const transaction = { transaction: { message: { instructions: [instruction] } }, meta: { err: null, innerInstructions: [] } };
  const expected = { programId: "program", loan: "loan", wallet: "wallet", source: "source", vault: "vault", mint: "mint" };
  assert.equal(isSuccessfulPledgeTransaction(transaction, expected), true);
  assert.equal(isSuccessfulPledgeTransaction({ ...transaction, meta: { err: { InstructionError: [0, 1] }, innerInstructions: [] } }, expected), false);
  assert.equal(isSuccessfulPledgeTransaction({ ...transaction, transaction: { message: { instructions: [{ ...instruction, data: "1" }] } } }, expected), false);
});

test("a landed pledge is recovered after persistence failure and every read path stays idempotent", async (t) => {
  const chain = fakeChain();
  const backing = await createStore({});
  let failPledgeWrite = true;
  const store = {
    ...backing,
    async putInstance(participantId, value) {
      if (value.pledgeSignature && failPledgeWrite) { failPledgeWrite = false; throw new Error("injected Redis outage"); }
      return backing.putInstance(participantId, value);
    },
  };
  const reports = [];
  const service = await createSecondKeyServer({ chain, store, allowDev: true, ticketSecret: TICKET_SECRET, reportSolve: async (...args) => reports.push(args) });
  t.after(() => service.close());
  const { origin, cookie } = await launch(service, "pledge-crash-participant");
  const call = (path, init = {}) => fetch(`${origin}${path}`, { ...init, headers: { cookie, "content-type": "application/json", ...(init.headers || {}) } });

  assert.equal((await call("/api/pledge", { method: "POST", body: "{}" })).status, 500);
  assert.equal(chain.pledgeCalls(), 1);
  chain.recover();
  for (let index = 0; index < 2; index += 1) {
    const completion = await fetch(`${origin}/api/completion?participantId=pledge-crash-participant`, { headers: { authorization: `Bearer ${TICKET_SECRET}` } });
    assert.equal((await completion.json()).completed, true);
  }
  const state = await (await call("/api/state")).json();
  assert.equal(state.pledgeSignature, "pledge-signature");
  const retry = await call("/api/pledge", { method: "POST", body: "{}" });
  assert.equal(retry.status, 200);
  assert.deepEqual(await retry.json(), { signature: "pledge-signature", recovered: false });
  assert.equal(chain.pledgeCalls(), 1);
  assert.equal(reports.length, 1);
});

test("completion recovery discovers a finished chain state without another browser poll", async (t) => {
  const chain = fakeChain();
  const service = await createSecondKeyServer({ chain, allowDev: true, ticketSecret: TICKET_SECRET, reportSolve: async () => {} });
  t.after(() => service.close());
  const { origin, cookie } = await launch(service, "recovery-participant");
  await fetch(`${origin}/api/pledge`, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: "{}" });
  chain.recover();
  const completion = await fetch(`${origin}/api/completion?participantId=recovery-participant`, {
    headers: { authorization: `Bearer ${TICKET_SECRET}` },
  });
  assert.equal(completion.status, 200);
  assert.equal((await completion.json()).completed, true);
});

test("the participant wallet file can be reopened from a fresh ticketed session", async (t) => {
  const service = await createSecondKeyServer({ chain: fakeChain(), allowDev: true, reportSolve: async () => {} });
  t.after(() => service.close());
  const { origin, cookie } = await launch(service, "key-participant");
  const first = await fetch(`${origin}/api/wallet-keypair`, { headers: { cookie } });
  assert.equal(first.status, 200);
  const firstKey = await first.json();
  assert.equal((await fetch(`${origin}/api/wallet-keypair`, { headers: { cookie } })).status, 200);
  assert.equal((await fetch(`${origin}/api/operator-key`, { headers: { cookie } })).status, 404);
  const relaunched = await fetch(`${origin}/api/session`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ participantId: "key-participant" }) });
  const freshCookie = relaunched.headers.get("set-cookie").split(";")[0];
  const second = await fetch(`${origin}/api/wallet-keypair`, { headers: { cookie: freshCookie } });
  assert.equal(second.status, 200);
  assert.deepEqual(await second.json(), firstKey);
});

test("health and the integrity policy are public", async (t) => {
  const service = await createSecondKeyServer({ chain: fakeChain(), allowDev: true, reportSolve: async () => {} });
  t.after(() => service.close());
  const address = await service.listen(0);
  const origin = `http://127.0.0.1:${address.port}`;
  assert.equal((await fetch(`${origin}/health`)).status, 200);
  assert.match(await (await fetch(`${origin}/agents.txt`)).text(), /Autonomous .*agents.*may not operate/i);
  const participantHtml = await (await fetch(origin)).text();
  assert.doesNotMatch(participantHtml, /permanent delegate|token-2022|operator key|act on behalf/i);
});

test("production refuses development identity and fallback secrets", async () => {
  await assert.rejects(() => createSecondKeyServer({
    env: { NODE_ENV: "production", CTF_EVENT_GENERATION: "event-a", ALLOW_DEV_LAUNCH: "true" },
    chain: fakeChain(),
  }), /REDIS_URL|PARTICIPANT_TICKET_SECRET|development launch mode/);
});
