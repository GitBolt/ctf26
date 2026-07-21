import assert from "node:assert/strict";
import test from "node:test";

import { issueParticipantTicket } from "@ctf26/participant-ticket";
import { createPlayerTwoServer } from "../src/server.mjs";

const SECRET = "player-two-load-ticket-secret-at-least-32-bytes";
const EVENT = "load-event";

test("40 participants are isolated while chain concurrency and spam stay bounded", async (t) => {
  const chain = loadChain();
  const service = await createPlayerTwoServer({
    allowDev: false,
    ticketSecret: SECRET,
    chain,
    env: {
      CTF_EVENT_GENERATION: EVENT,
      PLAYER_TWO_SESSION_RATE_MAX: "4",
      PLAYER_TWO_MAX_ACTIVE_PROVISIONS: "1",
      PLAYER_TWO_MAX_ACTIVE_CHAIN_ACTIONS: "6",
      PLAYER_TWO_EXPECTED_PARTICIPANTS: "41",
      PLAYER_TWO_PROVISION_FEE_BUFFER_LAMPORTS: "150000",
    },
  });
  const address = await service.listen(0);
  t.after(() => service.close());
  const origin = `http://127.0.0.1:${address.port}`;
  const healthResponses = await Promise.all(Array.from({ length: 40 }, () => fetch(`${origin}/health`)));
  assert.ok(healthResponses.every(({ status }) => status === 200));
  assert.equal(chain.healthCalls(), 1);
  const browser = await (await fetch(`${origin}/app.js`)).text();
  assert.match(browser, /SESSION_ATTEMPTS = 12/);
  assert.match(browser, /error\.status !== 429/);
  const participants = Array.from({ length: 40 }, (_, index) => `load-${index}`);
  const tickets = new Map(participants.map((participantId, index) => [participantId, ticket(participantId, `launch-${index}`)]));
  const launch = async (participantId, launchTicket = tickets.get(participantId)) => {
    const response = await fetch(`${origin}/api/session`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ticket: launchTicket }),
    });
    return { participantId, status: response.status, retryAfter: response.headers.get("retry-after"), cookie: response.headers.get("set-cookie")?.split(";")[0] || "", body: await response.clone().json().catch(() => ({})) };
  };

  const firstWave = await Promise.all(participants.map((participantId) => launch(participantId)));
  const admitted = firstWave.filter(({ status }) => status === 201);
  const busy = firstWave.filter(({ status }) => status === 429);
  assert.ok(admitted.length >= 1 && admitted.length < 40, JSON.stringify(firstWave.slice(0, 3)));
  assert.equal(admitted.length + busy.length, 40);
  assert.ok(firstWave.filter(({ status }) => status === 429).every(({ retryAfter }) => retryAfter === "2"));
  assert.ok(chain.maxProvision() <= 1);

  const sessions = new Map(admitted.map(({ participantId, cookie }) => [participantId, cookie]));
  const rejected = busy.map(({ participantId }) => participantId);
  for (const participantId of rejected) {
    const retried = await launch(participantId);
    assert.equal(retried.status, 201);
    sessions.set(retried.participantId, retried.cookie);
  }
  assert.equal(sessions.size, 40);
  await Promise.all(participants.map(async (participantId) => {
    const instance = await service.store.getInstance(participantId);
    assert.equal(instance.participantId, participantId);
    assert.match(instance.previousPass, new RegExp(participantId));
  }));

  const scans = await Promise.all(participants.map(async (participantId) => {
    const instance = await service.store.getInstance(participantId);
    return fetch(`${origin}/api/scan`, {
      method: "POST",
      headers: { cookie: sessions.get(participantId), "content-type": "application/json" },
      body: JSON.stringify({ address: instance.previousPass }),
    });
  }));
  const completedScans = scans.filter(({ status }) => status === 200).length;
  const busyScans = scans.filter(({ status }) => status === 429).length;
  assert.ok(completedScans >= 6 && completedScans < 40);
  assert.equal(completedScans + busyScans, 40);
  assert.ok(chain.maxScan() <= 6);

  const repeatedParticipant = participants[0];
  const repeatedInstance = await service.store.getInstance(repeatedParticipant);
  const overlapping = await Promise.all([0, 1].map(() => fetch(`${origin}/api/scan`, {
    method: "POST",
    headers: { cookie: sessions.get(repeatedParticipant), "content-type": "application/json" },
    body: JSON.stringify({ address: repeatedInstance.previousPass }),
  })));
  assert.deepEqual(overlapping.map(({ status }) => status).sort(), [200, 429]);

  const spam = [];
  for (let index = 0; index < 6; index += 1) spam.push(await launch("spammer", ticket("spammer", `spam-${index}`)));
  assert.deepEqual(spam.map(({ status }) => status), [201, 201, 201, 201, 429, 429]);
  assert.equal(spam.at(-1).retryAfter, "60");

  const oversized = await fetch(`${origin}/api/session`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ participantId: "large", padding: "x".repeat(20_000) }),
  });
  assert.equal(oversized.status, 413);
});

function ticket(participantId, jti) {
  return issueParticipantTicket({ eventId: EVENT, audience: "player-two", participantId }, SECRET, { jti });
}

function loadChain() {
  const instances = new Map();
  let activeProvision = 0;
  let peakProvision = 0;
  let activeScan = 0;
  let peakScan = 0;
  let healthCalls = 0;
  return {
    network: "devnet",
    programId: "BGJkBJaEHAakMso532hE1vfGdFkYX8dvjy9gDbCGN7eW",
    async provision(participantId) {
      activeProvision += 1; peakProvision = Math.max(peakProvision, activeProvision);
      try {
        await delay(100);
        const value = {
          holder: `holder-${participantId}`,
          previousPass: `previous-${participantId}`,
          currentPass: `current-${participantId}`,
          jackpot: `jackpot-${participantId}`,
          setupSignature: `setup-${participantId}`,
          migrationSignature: `migration-${participantId}`,
        };
        instances.set(participantId, value);
        return value;
      } finally { activeProvision -= 1; }
    },
    async inspectPass(address) {
      activeScan += 1; peakScan = Math.max(peakScan, activeScan);
      try {
        await delay(100);
        const owner = [...instances.values()].find(({ previousPass }) => previousPass === address);
        return owner ? { found: true, address, holder: owner.holder, generation: 1, active: true } : { found: false, address };
      } finally { activeScan -= 1; }
    },
    async jackpotState() { return { opened: false }; },
    async openJackpot() { throw new Error("unused"); },
    async health() { healthCalls += 1; await delay(20); return { ok: true, programAvailable: true, capacitySufficient: true }; },
    healthCalls: () => healthCalls,
    maxProvision: () => peakProvision,
    maxScan: () => peakScan,
  };
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
