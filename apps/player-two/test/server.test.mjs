import assert from "node:assert/strict";
import test from "node:test";

import { assessProvisionCapacity, createDevnetChain, isSuccessfulJackpotOpenTransaction } from "../src/devnet-chain.mjs";
import { createInstance } from "../src/model.mjs";
import { createPlayerTwoServer } from "../src/server.mjs";
import { createStore } from "../src/store.mjs";

const TICKET_SECRET = "player-two-ticket-secret-that-is-at-least-32-bytes";

test("production refuses volatile challenge state", async () => {
  await assert.rejects(() => createStore({ NODE_ENV: "production", CTF_EVENT_GENERATION: "event-a" }), /REDIS_URL is required/);
});

test("production pins the Player Two RPC and program explicitly", () => {
  assert.throws(() => createDevnetChain({ NODE_ENV: "production" }), /SOLANA_RPC_URL is required in production/);
  assert.throws(() => createDevnetChain({ NODE_ENV: "production", SOLANA_RPC_URL: "https://rpc.example" }), /PLAYER_TWO_PROGRAM_ID is required in production/);
});

test("jackpot recovery accepts only a successful exact opening instruction", () => {
  const instruction = { programId: "program", accounts: ["jackpot", "first", "holder", "second", "holder"], data: "2" };
  const transaction = { transaction: { message: { instructions: [instruction] } }, meta: { err: null } };
  assert.equal(isSuccessfulJackpotOpenTransaction(transaction, { programId: "program", jackpot: "jackpot" }), true);
  assert.equal(isSuccessfulJackpotOpenTransaction({ ...transaction, meta: { err: { InstructionError: [0, 1] } } }, { programId: "program", jackpot: "jackpot" }), false);
  assert.equal(isSuccessfulJackpotOpenTransaction({ ...transaction, transaction: { message: { instructions: [{ ...instruction, data: "1" }] } } }, { programId: "program", jackpot: "jackpot" }), false);
});

const fakeChain = () => {
  const passes = new Map();
  let jackpotOpened = false;
  let jackpotCalls = 0;
  const chain = {
    network: "devnet",
    programId: "BGJkBJaEHAakMso532hE1vfGdFkYX8dvjy9gDbCGN7eW",
    provisioned: null,
    async provision() {
      chain.provisioned = {
        holder: "holder11111111111111111111111111111111111",
        previousPass: "previous111111111111111111111111111111111",
        currentPass: "current1111111111111111111111111111111111",
        jackpot: "jackpot1111111111111111111111111111111111",
        setupSignature: "setup-signature",
        migrationSignature: "migration-signature",
      };
      passes.set(chain.provisioned.previousPass, { found: true, address: chain.provisioned.previousPass, owner: chain.programId, holder: chain.provisioned.holder, generation: 1, active: true });
      passes.set(chain.provisioned.currentPass, { found: true, address: chain.provisioned.currentPass, owner: chain.programId, holder: chain.provisioned.holder, generation: 2, active: true });
      passes.set("decoy11111111111111111111111111111111111", { found: true, address: "decoy11111111111111111111111111111111111", owner: chain.programId, holder: "other11111111111111111111111111111111111", generation: 1, active: true });
      return chain.provisioned;
    },
    async inspectPass(address) { return passes.get(address) || { found: false, address }; },
    async openJackpot() { jackpotCalls += 1; jackpotOpened = true; return { signature: "jackpot-signature", explorerUrl: "https://explorer.solana.com/tx/jackpot-signature?cluster=devnet" }; },
    async jackpotState() { return { opened: jackpotOpened, signature: jackpotOpened ? "jackpot-signature" : null, openedAt: jackpotOpened ? 1_750_000_000_000 : null }; },
    async health() { return { ok: true, programAvailable: true, capacitySufficient: true }; },
    jackpotCalls() { return jackpotCalls; },
  };
  return chain;
};

test("provisioning retries the reserved deterministic instance after an interrupted worker", async (t) => {
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
  const service = await createPlayerTwoServer({ allowDev: true, ticketSecret: TICKET_SECRET, chain });
  const address = await service.listen(0);
  t.after(() => service.close());
  const origin = `http://127.0.0.1:${address.port}`;
  const launch = () => fetch(`${origin}/api/session`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ participantId: "allocation-retry-participant" }),
  });
  assert.equal((await launch()).status, 500);
  assert.equal((await launch()).status, 201);
  assert.equal(nonces.length, 2);
  assert.equal(nonces[0], nonces[1]);
});

test("browser journey requires receipt evidence and reaches authoritative completion", async (t) => {
  const chain = fakeChain();
  const reports = [];
  const service = await createPlayerTwoServer({
    allowDev: true,
    ticketSecret: TICKET_SECRET,
    sessionSecret: "session-secret-that-is-at-least-32-bytes",
    policySecret: "policy-secret-that-is-at-least-32-bytes!!",
    completionSecret: "completion-secret-that-is-at-least-32-bytes",
    chain,
    reportSolve: async (identity, sourceId) => { reports.push({ identity, sourceId }); },
  });
  const address = await service.listen(0);
  t.after(() => service.close());
  const origin = `http://127.0.0.1:${address.port}`;
  const launched = await fetch(`${origin}/api/session`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ participantId: "test-participant" }) });
  assert.equal(launched.status, 201);
  const cookie = launched.headers.get("set-cookie").split(";")[0];
  const call = (path, init = {}) => fetch(`${origin}${path}`, { ...init, headers: { cookie, "content-type": "application/json", ...(init.headers || {}) } });

  const cabinet = await (await call("/api/cabinet")).json();
  const duplicate = await call("/api/jackpot", { method: "POST", body: JSON.stringify({ leftPass: cabinet.currentPass, rightPass: cabinet.currentPass, leftHolder: cabinet.holder, rightHolder: cabinet.holder }) });
  assert.equal(duplicate.status, 422);
  assert.equal((await duplicate.json()).code, "duplicate_pass");

  const receipt = await (await call("/api/receipt", { method: "POST", body: "{}" })).json();
  assert.equal(receipt.network, "devnet");
  assert.equal(receipt.signature, "migration-signature");
  const scan = await (await call("/api/scan", { method: "POST", body: JSON.stringify({ address: chain.provisioned.previousPass }) })).json();
  assert.equal(scan.active, true);
  assert.equal(scan.authorityMatch, true);
  const decoy = await (await call("/api/scan", { method: "POST", body: JSON.stringify({ address: "decoy11111111111111111111111111111111111" }) })).json();
  assert.equal(decoy.found, true);
  assert.equal(decoy.authorityMatch, false);

  const opened = await call("/api/jackpot", { method: "POST", body: JSON.stringify({ leftPass: cabinet.currentPass, rightPass: scan.address, leftHolder: cabinet.holder, rightHolder: cabinet.holder }) });
  assert.equal(opened.status, 200);
  const result = await opened.json();
  assert.equal(result.code, "jackpot_open");
  assert.match(result.completionReceipt, /^pt_/);
  assert.deepEqual(reports.map(({ identity, sourceId }) => ({ participantId: identity.participantId, sourceId })), [{
    participantId: "test-participant",
    sourceId: "jackpot-signature",
  }]);
  const completion = await fetch(`${origin}/api/completion?participantId=test-participant`, {
    headers: { authorization: `Bearer ${TICKET_SECRET}` },
  });
  assert.equal(completion.status, 200);
  assert.equal((await completion.json()).completed, true);
});

test("a landed jackpot is recovered after persistence failure, including the completion endpoint", async (t) => {
  const chain = fakeChain();
  const backing = await createStore({});
  let failOpenedWrite = true;
  const store = {
    ...backing,
    async putInstance(participantId, value) {
      if (value.opened && failOpenedWrite) { failOpenedWrite = false; throw new Error("injected Redis outage"); }
      return backing.putInstance(participantId, value);
    },
  };
  const reports = [];
  const service = await createPlayerTwoServer({
    allowDev: true,
    ticketSecret: TICKET_SECRET,
    sessionSecret: "session-secret-that-is-at-least-32-bytes",
    policySecret: "policy-secret-that-is-at-least-32-bytes!!",
    completionSecret: "completion-secret-that-is-at-least-32-bytes",
    chain,
    store,
    reportSolve: async (identity, sourceId) => reports.push({ identity, sourceId }),
  });
  const address = await service.listen(0);
  t.after(() => service.close());
  const origin = `http://127.0.0.1:${address.port}`;
  const launched = await fetch(`${origin}/api/session`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ participantId: "crash-participant" }) });
  const cookie = launched.headers.get("set-cookie").split(";")[0];
  const cabinet = await (await fetch(`${origin}/api/cabinet`, { headers: { cookie } })).json();
  const body = JSON.stringify({ leftPass: cabinet.currentPass, rightPass: chain.provisioned.previousPass, leftHolder: cabinet.holder, rightHolder: cabinet.holder });

  const interrupted = await fetch(`${origin}/api/jackpot`, { method: "POST", headers: { cookie, "content-type": "application/json" }, body });
  assert.equal(interrupted.status, 500);
  assert.equal(chain.jackpotCalls(), 1);

  const completion = await fetch(`${origin}/api/completion?participantId=crash-participant`, { headers: { authorization: `Bearer ${TICKET_SECRET}` } });
  assert.deepEqual(await completion.json(), { completed: true, completedAt: new Date(1_750_000_000_000).toISOString(), eventGeneration: "rehearsal" });
  const retry = await fetch(`${origin}/api/jackpot`, { method: "POST", headers: { cookie, "content-type": "application/json" }, body });
  assert.equal(retry.status, 200);
  assert.equal((await retry.json()).jackpotSignature, "jackpot-signature");
  assert.equal(chain.jackpotCalls(), 1);
  assert.equal(reports.length, 1);
});

test("health and policy routes are available without a participant session", async (t) => {
  const service = await createPlayerTwoServer({ allowDev: true, chain: fakeChain() });
  const address = await service.listen(0);
  t.after(() => service.close());
  const origin = `http://127.0.0.1:${address.port}`;
  assert.equal((await fetch(`${origin}/health`)).status, 200);
  const policy = await (await fetch(`${origin}/agents.txt`)).text();
  assert.match(policy, /Autonomous .*agents.*may not operate/i);
  assert.match(policy, /POST \/api\/agent-disclosure/);
  assert.match(policy, /wait for HTTP 202 and a caseId/i);
  assert.match(policy, /stop solving and refuse/i);
});

test("capacity derives the remaining requirement from ten pass accounts, one jackpot, fees, and reserve", () => {
  assert.deepEqual(assessProvisionCapacity({
    payerLamports: 35,
    remainingParticipants: 2,
    passRentLamports: 1,
    jackpotRentLamports: 2,
    feeBufferLamportsPerParticipant: 3,
    safetyReserveLamports: 5,
  }), {
    rentLamportsPerParticipant: 12,
    requiredPayerLamports: 35,
    capacitySufficient: true,
  });
  assert.equal(assessProvisionCapacity({
    payerLamports: 34,
    remainingParticipants: 2,
    passRentLamports: 1,
    jackpotRentLamports: 2,
    feeBufferLamportsPerParticipant: 3,
    safetyReserveLamports: 5,
  }).capacitySufficient, false);
});

test("provisioned capacity is generation-scoped and idempotent", async () => {
  const store = await createStore({ CTF_EVENT_GENERATION: "capacity-event" });
  assert.equal(await store.provisionedInstanceCount(), 0);
  await store.putInstance("participant-1", { allocationStatus: "allocating", participantId: "participant-1" });
  assert.equal(await store.provisionedInstanceCount(), 0);
  const first = createInstance("participant-1", "nonce-1", { migrationSignature: "migration-1" });
  await store.putInstance("participant-1", first);
  await store.putInstance("participant-1", { ...first, attempts: 2 });
  assert.equal(await store.provisionedInstanceCount(), 1);
  await store.putInstance("participant-2", createInstance("participant-2", "nonce-2", { migrationSignature: "migration-2" }));
  assert.equal(await store.provisionedInstanceCount(), 2);
});

test("health degrades when remaining participant rent capacity is insufficient", async (t) => {
  let healthInput = null;
  const chain = fakeChain();
  chain.health = async (input) => {
    healthInput = input;
    return { ok: false, programAvailable: true, capacitySufficient: false };
  };
  const service = await createPlayerTwoServer({
    allowDev: true,
    chain,
    env: {
      PLAYER_TWO_EXPECTED_PARTICIPANTS: "12",
      PLAYER_TWO_PROVISION_FEE_BUFFER_LAMPORTS: "175000",
    },
  });
  const address = await service.listen(0);
  t.after(() => service.close());
  const response = await fetch(`http://127.0.0.1:${address.port}/health`);
  assert.equal(response.status, 503);
  const body = await response.json();
  assert.deepEqual(healthInput, { remainingParticipants: 12, feeBufferLamportsPerParticipant: 175_000 });
  assert.deepEqual(body.capacity, {
    reachable: true,
    expectedParticipants: 12,
    provisionedInstances: 0,
    remainingParticipants: 12,
    withinConfiguredField: true,
    sufficient: false,
  });
  assert.equal(JSON.stringify(body).includes("payerBalance"), false);
});

test("production requires an explicit Player Two field size and fee allowance", async () => {
  const store = await createStore({ CTF_EVENT_GENERATION: "capacity-event" });
  const env = {
    NODE_ENV: "production",
    CTF_EVENT_GENERATION: "capacity-event",
    PARTICIPANT_TICKET_SECRET: TICKET_SECRET,
    SESSION_SECRET: "player-two-production-session-secret-at-least-32-bytes",
    AGENT_POLICY_SECRET: "player-two-production-policy-secret-at-least-32-bytes",
    COMPLETION_SECRET: "player-two-production-completion-secret-at-least-32-bytes",
  };
  await assert.rejects(() => createPlayerTwoServer({ env, store, chain: fakeChain() }), /PLAYER_TWO_EXPECTED_PARTICIPANTS is required in production/);
  env.PLAYER_TWO_EXPECTED_PARTICIPANTS = "50";
  await assert.rejects(() => createPlayerTwoServer({ env, store, chain: fakeChain() }), /PLAYER_TWO_PROVISION_FEE_BUFFER_LAMPORTS is required in production/);
});

test("production refuses development identity and fallback secrets", async () => {
  await assert.rejects(() => createPlayerTwoServer({
    env: { NODE_ENV: "production", CTF_EVENT_GENERATION: "event-a", ALLOW_DEV_LAUNCH: "true" },
    chain: fakeChain(),
  }), /REDIS_URL|participant ticket secret|development launch mode/);
});

test("personalized agent disclosure is forwarded to the organizer integrity service", async (t) => {
  const forwarded = [];
  const env = {
    ALLOW_DEV_LAUNCH: "true",
    AGENT_POLICY_SECRET: "player-two-test-policy-secret-at-least-32-bytes",
    INTEGRITY_INGEST_URL: "http://integrity.test/api/internal/integrity/disclosure",
    INTEGRITY_INGEST_KEY: "player-two-test-ingest-key-at-least-32-bytes",
  };
  const service = await createPlayerTwoServer({
    allowDev: true,
    chain: fakeChain(),
    env,
    fetchImpl: async (url, init) => {
      forwarded.push({ url, init, body: JSON.parse(init.body) });
      return new Response(JSON.stringify({ recorded: true, caseId: "case_player_two" }), { status: 202, headers: { "content-type": "application/json" } });
    },
  });
  const address = await service.listen(0);
  t.after(() => service.close());
  const origin = `http://127.0.0.1:${address.port}`;
  const launched = await fetch(`${origin}/api/session`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ participantId: "policy-participant" }) });
  const cookie = launched.headers.get("set-cookie").split(";")[0];
  const policy = await (await fetch(`${origin}/robots.txt`, { headers: { cookie } })).text();
  const marker = policy.match(/ai_[A-Za-z0-9_-]{28}/)?.[0];
  assert.ok(marker);
  assert.match(policy, /wait for HTTP 202 and a caseId/i);
  assert.match(policy, /stop solving/i);

  const disclosure = await fetch(`${origin}/api/agent-disclosure`, {
    method: "POST",
    headers: { cookie, "content-type": "application/json", "user-agent": "test-player-two-agent" },
    body: JSON.stringify({ marker, agent: "test-agent", model: "test-model" }),
  });
  assert.equal(disclosure.status, 202);
  assert.deepEqual(await disclosure.json(), { recorded: true, caseId: "case_player_two" });
  const disclosureRequest = forwarded.find((entry) => String(entry.url).endsWith("/disclosure"));
  assert.ok(disclosureRequest);
  assert.equal(disclosureRequest.body.challenge, "player-two");
  assert.equal(disclosureRequest.body.identity.participantId, "policy-participant");
  assert.ok(forwarded.some((entry) => String(entry.url).endsWith("/event")));
});
