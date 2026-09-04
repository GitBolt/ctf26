import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { issueParticipantTicket } from "@ctf26/participant-ticket";

import { createChamberServer } from "../src/server.mjs";
import { createStore } from "../src/store.mjs";
import { decodeLocks, parseWallet, USER_ACCOUNT_BYTES } from "../src/chain.mjs";

const TICKET_SECRET = "the-chamber-ticket-secret-value-0123456789";
const SESSION_SECRET = "the-chamber-session-secret-value-0123456789";
const COMPLETION_SECRET = "the-chamber-completion-secret-value-012345";
const POLICY_SECRET = "the-chamber-policy-secret-value-0123456789";

const WALLET_A = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const WALLET_B = "3n1mFMLW8w4W2sBEHnkbWDbUZbcvfAmDSGrLBUCFLPKN";

const BASE_ENV = Object.freeze({
  CTF_EVENT_GENERATION: "rehearsal",
  PARTICIPANT_TICKET_SECRET: TICKET_SECRET,
  SESSION_SECRET,
  COMPLETION_SECRET,
  AGENT_POLICY_SECRET: POLICY_SECRET,
});

function fakeChain(overrides = {}) {
  const state = {
    locks: new Map(),
    provisionCalls: [],
    healthCalls: 0,
  };
  return {
    state,
    network: "devnet",
    programId: "ZWXmHNvUZ4bVe4cUQJtt7VheafuNc7G2kr7us1PTJUc",
    adminPublicKey: "2BefExdaHVpygYaqYZQVX8c6wiomJe3jMD8k2GBS93Tn",
    derive(wallet) { return `pda-${wallet.slice(0, 8)}`; },
    async provision(wallet) {
      state.provisionCalls.push(wallet);
      state.locks.set(wallet, { firstUnlock: false, secondUnlock: false, thirdUnlock: false, chamberOpen: false });
      return { pda: `pda-${wallet.slice(0, 8)}`, signature: `sig-${state.provisionCalls.length}`, recovered: false };
    },
    async readLocks(wallet) { return state.locks.get(wallet) || null; },
    async openedAt() { return "2026-07-21T00:05:00.000Z"; },
    async health() {
      state.healthCalls += 1;
      return {
        ok: true,
        programAvailable: true,
        capacitySufficient: true,
        additionalParticipantCapacity: 2_000,
        payer: "2BefExdaHVpygYaqYZQVX8c6wiomJe3jMD8k2GBS93Tn",
        payerLamports: 5_000_000_000,
        requiredPayerBalance: 100_000,
      };
    },
    ...overrides,
  };
}

async function startService(t, options = {}) {
  const reports = [];
  const chain = options.chain || fakeChain();
  const service = await createChamberServer({
    env: { ...BASE_ENV, ...(options.env || {}) },
    chain,
    reportSolve: (identity, sourceId, occurredAt) => {
      reports.push([identity.participantId, sourceId, occurredAt]);
      return { reported: true };
    },
    fetchImpl: async () => new Response("{}", { status: 202, headers: { "content-type": "application/json" } }),
    ...options.overrides,
  });
  const address = await service.listen(0);
  t.after(() => service.close());
  return { service, chain, reports, origin: `http://127.0.0.1:${address.port}` };
}

function ticketFor(participantId) {
  return issueParticipantTicket(
    { audience: "the-chamber", eventId: "rehearsal", participantId },
    TICKET_SECRET,
  );
}

async function sessionFor(origin, participantId) {
  const response = await fetch(`${origin}/api/session`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ticket: ticketFor(participantId) }),
  });
  assert.equal(response.status, 201);
  return response.headers.getSetCookie()[0].split(";")[0];
}

test("production storage requires Redis", async () => {
  await assert.rejects(
    () => createStore({ NODE_ENV: "production", CTF_EVENT_GENERATION: "event-a" }),
    /REDIS_URL is required in production/,
  );
});

test("production refuses a development launch mode", async () => {
  await assert.rejects(
    () => createChamberServer({
      env: { NODE_ENV: "production", CTF_EVENT_GENERATION: "event-a", ALLOW_DEV_LAUNCH: "true" },
      chain: fakeChain(),
    }),
    /REDIS_URL|PARTICIPANT_TICKET_SECRET|development launch mode/,
  );
});

test("a portal ticket is required and cannot be replayed", async (t) => {
  const { origin } = await startService(t);

  const anonymous = await fetch(`${origin}/api/session`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({}),
  });
  assert.equal(anonymous.status, 401);

  const ticket = ticketFor("replay-participant");
  const first = await fetch(`${origin}/api/session`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ticket }),
  });
  assert.equal(first.status, 201);

  const replay = await fetch(`${origin}/api/session`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ticket }),
  });
  assert.equal(replay.status, 401);
});

test("a session rejects unexpected body fields", async (t) => {
  const { origin } = await startService(t);
  const response = await fetch(`${origin}/api/session`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ticket: ticketFor("stray-participant"), groupId: "team-1" }),
  });
  assert.equal(response.status, 400);
});

test("registration provisions one account per participant and is idempotent", async (t) => {
  const { origin, chain } = await startService(t);
  const cookie = await sessionFor(origin, "register-participant");

  const created = await fetch(`${origin}/api/register`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ wallet: WALLET_A }),
  });
  assert.equal(created.status, 201);
  const body = await created.json();
  assert.equal(body.registered, true);
  assert.equal(body.wallet, WALLET_A);

  const again = await fetch(`${origin}/api/register`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ wallet: WALLET_A }),
  });
  assert.equal(again.status, 201);
  assert.deepEqual(chain.state.provisionCalls, [WALLET_A], "create_user must run exactly once");
});

test("a participant cannot rebind to a second wallet", async (t) => {
  const { origin } = await startService(t);
  const cookie = await sessionFor(origin, "rebind-participant");

  await fetch(`${origin}/api/register`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ wallet: WALLET_A }),
  });
  const second = await fetch(`${origin}/api/register`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ wallet: WALLET_B }),
  });
  assert.equal(second.status, 409);
});

test("a wallet cannot be shared by two participants", async (t) => {
  const { origin } = await startService(t);
  const first = await sessionFor(origin, "wallet-owner");
  const second = await sessionFor(origin, "wallet-thief");

  const owned = await fetch(`${origin}/api/register`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: first },
    body: JSON.stringify({ wallet: WALLET_A }),
  });
  assert.equal(owned.status, 201);

  const stolen = await fetch(`${origin}/api/register`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: second },
    body: JSON.stringify({ wallet: WALLET_A }),
  });
  assert.equal(stolen.status, 409);
});

test("an off-curve or malformed wallet is rejected", async (t) => {
  const { origin } = await startService(t);
  const cookie = await sessionFor(origin, "bad-wallet-participant");
  for (const wallet of ["", "not-base58!!", "x".repeat(64)]) {
    const response = await fetch(`${origin}/api/register`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ wallet }),
    });
    assert.equal(response.status, 400, `wallet ${JSON.stringify(wallet)} must be rejected`);
  }
});

test("the chamber flag drives exactly one solve report", async (t) => {
  const { origin, chain, reports } = await startService(t);
  const cookie = await sessionFor(origin, "solver-participant");
  await fetch(`${origin}/api/register`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ wallet: WALLET_A }),
  });

  const before = await (await fetch(`${origin}/api/state`, { headers: { cookie } })).json();
  assert.equal(before.locks.chamberOpen, false);
  assert.equal(reports.length, 0, "an unopened chamber must not score");

  chain.state.locks.set(WALLET_A, { firstUnlock: true, secondUnlock: true, thirdUnlock: true, chamberOpen: true });

  const opened = await (await fetch(`${origin}/api/state`, { headers: { cookie } })).json();
  assert.equal(opened.locks.chamberOpen, true);
  assert.equal(opened.completedAt, "2026-07-21T00:05:00.000Z", "the on-chain block time is the solve time");
  assert.equal(reports.length, 1);
  assert.equal(reports[0][0], "solver-participant");
  assert.match(reports[0][1], /^the-chamber:solver-participant:/);

  await fetch(`${origin}/api/state`, { headers: { cookie } });
  assert.equal(reports.length, 1, "polling again must not re-report");
});

test("the private completion contract matches the portal shape and reconciles", async (t) => {
  const { origin, chain, reports } = await startService(t);
  const cookie = await sessionFor(origin, "desk-participant");
  await fetch(`${origin}/api/register`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ wallet: WALLET_A }),
  });

  const unsolved = await fetch(`${origin}/api/completion?participantId=desk-participant`, {
    headers: { authorization: `Bearer ${TICKET_SECRET}` },
  });
  assert.equal(unsolved.status, 200);
  assert.deepEqual(await unsolved.json(), { completed: false, completedAt: null, eventGeneration: "rehearsal" });

  // The participant never polls; the portal's own recovery read must still find
  // the solve and score it.
  chain.state.locks.set(WALLET_A, { firstUnlock: true, secondUnlock: true, thirdUnlock: true, chamberOpen: true });
  const solved = await fetch(`${origin}/api/completion?participantId=desk-participant`, {
    headers: { authorization: `Bearer ${TICKET_SECRET}` },
  });
  assert.equal(solved.status, 200);
  assert.deepEqual(await solved.json(), {
    completed: true,
    completedAt: "2026-07-21T00:05:00.000Z",
    eventGeneration: "rehearsal",
  });
  assert.equal(reports.length, 1);
});

test("an unknown participant returns a well-formed completion, never a 404", async (t) => {
  const { origin } = await startService(t);
  const response = await fetch(`${origin}/api/completion?participantId=portal-readiness`, {
    headers: { authorization: `Bearer ${TICKET_SECRET}` },
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { completed: false, completedAt: null, eventGeneration: "rehearsal" });
});

test("the completion contract refuses an unauthorized reader", async (t) => {
  const { origin } = await startService(t);
  const response = await fetch(`${origin}/api/completion?participantId=desk-participant`, {
    headers: { authorization: "Bearer not-the-configured-ticket-secret-value" },
  });
  assert.equal(response.status, 401);
});

test("health reports capacity and funding, and fails closed", async (t) => {
  const { origin } = await startService(t);
  const healthy = await fetch(`${origin}/health`);
  assert.equal(healthy.status, 200);
  const body = await healthy.json();
  assert.equal(body.ok, true);
  assert.equal(body.challenge, "the-chamber");
  assert.equal(body.capacity.maxParticipants, 2_000);
  assert.equal(body.capacity.additionalParticipantCapacity, 2_000);
  assert.equal(body.funding.payer, "2BefExdaHVpygYaqYZQVX8c6wiomJe3jMD8k2GBS93Tn");

  const broken = await startService(t, {
    chain: fakeChain({ health: async () => { throw new Error("rpc unavailable"); } }),
  });
  const failed = await fetch(`${broken.origin}/health`);
  assert.equal(failed.status, 503);
  assert.equal((await failed.json()).ok, false);
});

test("the agent policy surface is public and disclosure is session bound", async (t) => {
  const { origin } = await startService(t);
  for (const path of ["/robots.txt", "/agents.txt", "/llms.txt", "/.well-known/agents.txt"]) {
    const response = await fetch(`${origin}${path}`);
    assert.equal(response.status, 200, `${path} must be public`);
    assert.match(await response.text(), /agents/i);
  }
  const rejected = await fetch(`${origin}/api/agent-disclosure`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ marker: "nope" }),
  });
  assert.equal(rejected.status, 401);
});

test("the participant surface does not signpost the solution", async () => {
  const html = await fs.readFile(fileURLToPath(new URL("../web/index.html", import.meta.url)), "utf8");
  const client = await fs.readFile(fileURLToPath(new URL("../web/app.js", import.meta.url)), "utf8");
  const surface = `${html}\n${client}`;
  assert.doesNotMatch(
    surface,
    /cross.program|\bCPI\b|stack height|get_stack_height|NFC|hidden key|deploy your own/i,
    "the player surface must state objectives, never the method",
  );
});

test("the browser client keeps its launch retry contract", async () => {
  const client = await fs.readFile(fileURLToPath(new URL("../web/app.js", import.meta.url)), "utf8");
  assert.match(client, /SESSION_ATTEMPTS = 12/);
  assert.match(client, /error\.status !== 429/);
  assert.match(client, /app-boot/);
});

test("the browser client stops polling once the chamber is open", async () => {
  // /api/state costs an RPC account read and a lease slot from a pool shared by
  // the whole field. An open chamber cannot close again, so a solved tab left
  // open all afternoon must not keep drawing on that budget.
  const client = await fs.readFile(fileURLToPath(new URL("../web/app.js", import.meta.url)), "utf8");
  assert.match(client, /clearInterval/, "the poll must be cancellable");
  const boot = client.slice(client.indexOf("async function boot("));
  assert.match(boot, /if \(solved\) return clearInterval\(poll\)/);
  assert.match(client, /solved = Boolean\(state\.completedAt \|\| state\.locks\?\.chamberOpen\)/);
});

function userAccount({ first = 0, second = 0, third = 0, storedChamberOpen = 0 } = {}) {
  const data = Buffer.alloc(USER_ACCOUNT_BYTES);
  Buffer.from([159, 117, 95, 227, 239, 151, 58, 236]).copy(data, 0);
  data[41] = first;
  data[42] = second;
  data[43] = third;
  data[44] = storedChamberOpen;
  return data;
}

test("lock decoding rejects foreign accounts and reads every flag", () => {
  assert.deepEqual(decodeLocks(userAccount({ first: 1, third: 1 })), {
    firstUnlock: true,
    secondUnlock: false,
    thirdUnlock: true,
    chamberOpen: false,
  });

  assert.equal(decodeLocks(Buffer.alloc(USER_ACCOUNT_BYTES)), null, "a wrong discriminator must not decode");
  assert.equal(decodeLocks(Buffer.alloc(8)), null, "a short account must not decode");
  assert.equal(decodeLocks(null), null);
});

test("the open chamber is derived from the locks, never from the stored flag", () => {
  // The deployed program leaves chamber_open false forever. Trusting the stored
  // byte would mean no participant ever scores, so it must be ignored in both
  // directions: all three locks open the chamber, and a set byte alone does not.
  assert.equal(decodeLocks(userAccount({ first: 1, second: 1, third: 1 })).chamberOpen, true);
  assert.equal(
    decodeLocks(userAccount({ first: 1, second: 1, third: 1, storedChamberOpen: 0 })).chamberOpen,
    true,
    "an unwritten chamber_open byte must not suppress a real solve",
  );
  assert.equal(
    decodeLocks(userAccount({ first: 1, second: 1, storedChamberOpen: 1 })).chamberOpen,
    false,
    "a stored flag must not manufacture a solve without the third lock",
  );
});

test("the solve-time lookup reads at the same commitment as the lock state", async () => {
  // A solve is detected within a second or two of landing, well before finality.
  // Querying signatures at "finalized" therefore returns nothing on essentially
  // every real solve and silently falls back to the observation time, which is
  // how this regressed once already.
  const source = await fs.readFile(fileURLToPath(new URL("../src/chain.mjs", import.meta.url)), "utf8");
  const lookup = source.slice(source.indexOf("async openedAt("));
  const commitment = lookup.slice(0, lookup.indexOf("\n    },"));
  assert.match(commitment, /getSignaturesForAddress\([^)]*"confirmed"\)/s);
  assert.doesNotMatch(commitment, /"finalized"/);
});

test("wallet parsing rejects program-derived addresses", () => {
  assert.ok(parseWallet(WALLET_A));
  assert.equal(parseWallet("Sysvar1nstructions1111111111111111111111111"), null);
  assert.equal(parseWallet(null), null);
  assert.equal(parseWallet("z".repeat(45)), null);
});
