import assert from "node:assert/strict";
import test from "node:test";

import { Keypair } from "@solana/web3.js";

import { issueParticipantTicket } from "@ctf26/participant-ticket";

import { createChamberServer } from "../src/server.mjs";

const TICKET_SECRET = "the-chamber-ticket-secret-value-0123456789";
const SESSION_SECRET = "the-chamber-session-secret-value-0123456789";
const COMPLETION_SECRET = "the-chamber-completion-secret-value-012345";
const POLICY_SECRET = "the-chamber-policy-secret-value-0123456789";

const PARTICIPANTS = 40;

// The service rejects anything that is not a real on-curve address, so the load
// run uses genuine keypairs rather than synthetic base58 strings.
const WALLETS = Array.from({ length: PARTICIPANTS }, () => Keypair.generate().publicKey.toBase58());

function fakeChain(state) {
  return {
    network: "devnet",
    programId: "Ekw4Zx3Nu9zTvCYsuzn1ubHNtgWjRAtm8PMUNavgmPXj",
    adminPublicKey: "2pqmreJiLwbPMwCbwBH2rexfeWs7J6zpTaJcZCRv7AGZ",
    derive(wallet) { return `pda-${wallet.slice(0, 8)}`; },
    async provision(wallet) {
      state.provisionCalls += 1;
      state.active += 1;
      state.maximum = Math.max(state.maximum, state.active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      state.active -= 1;
      state.locks.set(wallet, { firstUnlock: false, secondUnlock: false, thirdUnlock: false, chamberOpen: false });
      return { pda: `pda-${wallet.slice(0, 8)}`, signature: `sig-${state.provisionCalls}`, recovered: false };
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
        payer: "2pqmreJiLwbPMwCbwBH2rexfeWs7J6zpTaJcZCRv7AGZ",
        payerLamports: 5_000_000_000,
        requiredPayerBalance: 100_000,
      };
    },
  };
}

test("the chamber holds its contracts under event-day load", async (t) => {
  const state = { locks: new Map(), provisionCalls: 0, healthCalls: 0, active: 0, maximum: 0 };
  const service = await createChamberServer({
    env: {
      CTF_EVENT_GENERATION: "rehearsal",
      PARTICIPANT_TICKET_SECRET: TICKET_SECRET,
      SESSION_SECRET,
      COMPLETION_SECRET,
      AGENT_POLICY_SECRET: POLICY_SECRET,
      THE_CHAMBER_PREAUTH_IP_LIMIT_PER_MINUTE: "8",
    },
    chain: fakeChain(state),
    reportSolve: () => ({ reported: true }),
    fetchImpl: async () => new Response("{}", { status: 202, headers: { "content-type": "application/json" } }),
  });
  const address = await service.listen(0);
  const origin = `http://127.0.0.1:${address.port}`;
  t.after(() => service.close());

  // Readiness probes collapse onto one cached chain read.
  const probes = await Promise.all(Array.from({ length: 40 }, () => fetch(`${origin}/health`)));
  assert.ok(probes.every((response) => response.status === 200));
  assert.equal(state.healthCalls, 1, "concurrent readiness probes must share one chain read");

  // A flood of invalid tickets from one address is admitted up to the per-IP
  // budget and then shed, never reaching the chain.
  const flood = await Promise.all(Array.from({ length: 120 }, () => fetch(`${origin}/api/session`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-real-ip": "203.0.113.7" },
    body: JSON.stringify({ ticket: "v1.not-a-real-ticket.signature" }),
  })));
  const unauthorized = flood.filter((response) => response.status === 401);
  const shed = flood.filter((response) => response.status === 429);
  assert.equal(unauthorized.length, 8, "the per-IP budget admits exactly the configured number");
  assert.equal(shed.length, 112);
  assert.equal(shed[0].headers.get("retry-after"), "60");
  assert.equal(state.provisionCalls, 0, "rejected launches must never touch the chain");

  // Every real participant provisions exactly once, and chain work stays serial.
  const cookies = [];
  for (let index = 0; index < PARTICIPANTS; index += 1) {
    const ticket = issueParticipantTicket(
      { audience: "the-chamber", eventId: "rehearsal", participantId: `load-${index}` },
      TICKET_SECRET,
    );
    const response = await fetch(`${origin}/api/session`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-real-ip": `198.51.100.${index + 1}` },
      body: JSON.stringify({ ticket }),
    });
    assert.equal(response.status, 201, "one abusive address must not shed real launches");
    cookies.push(response.headers.getSetCookie()[0].split(";")[0]);
  }

  const registrations = await Promise.all(cookies.map((cookie, index) => fetch(`${origin}/api/register`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ wallet: WALLETS[index] }),
  })));
  const created = registrations.filter((response) => response.status === 201);
  const deferred = registrations.filter((response) => response.status === 429);
  assert.equal(created.length + deferred.length, PARTICIPANTS, "every launch is either provisioned or cleanly deferred");
  assert.equal(state.provisionCalls, created.length, "no wallet is provisioned twice");
  assert.equal(state.maximum, 1, "chain writes stay serialized behind the operation lease");

  // A consumed launch ticket cannot be replayed after the rush.
  const replayed = issueParticipantTicket(
    { audience: "the-chamber", eventId: "rehearsal", participantId: "load-0" },
    TICKET_SECRET,
    { jti: "jti_load_replay_probe" },
  );
  const firstUse = await fetch(`${origin}/api/session`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ticket: replayed }),
  });
  assert.equal(firstUse.status, 201);
  const secondUse = await fetch(`${origin}/api/session`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ticket: replayed }),
  });
  assert.equal(secondUse.status, 401);
});
