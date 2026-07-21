import assert from "node:assert/strict";
import test from "node:test";

import { issueParticipantTicket } from "@ctf26/participant-ticket";
import { start } from "../src/server.mjs";

const SECRET = "last-stop-load-ticket-secret-at-least-32-bytes";
const EVENT = "load-event";

test("40 concurrent passages preserve participant identity and reject spam", async (t) => {
  const service = await start({
    PORT: "0",
    SSH_PORT: "0",
    CTF_EVENT_GENERATION: EVENT,
    LAST_STOP_PUBLIC_ORIGIN: "http://127.0.0.1:3005",
    CHALLENGE_TICKET_SECRET: SECRET,
    LAST_STOP_FLAG_SECRET: "last-stop-load-flag-secret-at-least-32-bytes",
    LAST_STOP_LAUNCH_RATE_MAX: "4",
    LAST_STOP_MAX_ACTIVE_VALIDATORS: "8",
  });
  t.after(async () => {
    await Promise.all([
      new Promise((resolve) => service.httpServer.close(resolve)),
      new Promise((resolve) => service.sshServer.close(resolve)),
    ]);
    await service.store.close();
  });
  const origin = `http://127.0.0.1:${service.httpServer.address().port}`;
  let healthCalls = 0;
  const health = service.store.health.bind(service.store);
  service.store.health = async () => { healthCalls += 1; await delay(20); return health(); };
  const healthResponses = await Promise.all(Array.from({ length: 40 }, () => fetch(`${origin}/health`)));
  assert.ok(healthResponses.every(({ status }) => status === 200));
  assert.equal(healthCalls, 1);
  const participants = Array.from({ length: 40 }, (_, index) => `load-${index}`);
  const launches = await Promise.all(participants.map(async (participantId, index) => {
    const response = await fetch(`${origin}/launch?ticket=${encodeURIComponent(ticket(participantId, `launch-${index}`))}`, {
      headers: { accept: "application/json" },
    });
    return { participantId, status: response.status, body: await response.json() };
  }));
  assert.deepEqual(new Set(launches.map(({ status }) => status)), new Set([200]));
  assert.equal(new Set(launches.map(({ body }) => body.password)).size, 40);
  await Promise.all(launches.map(async ({ participantId, body }) => {
    const identity = await service.store.consumeCode(body.password);
    assert.equal(identity.participantId, participantId);
  }));

  const slots = await Promise.all(participants.map((participantId) => service.store.acquireSlot("load-validator", participantId, 1_000, 10_000, 8)));
  assert.equal(slots.filter(Boolean).length, 8);
  assert.equal(await service.store.acquireSlot("load-validator", participants[0], 1_001, 10_000, 8), false);
  await Promise.all(participants.map((participantId) => service.store.releaseSlot("load-validator", participantId)));

  const spam = await Promise.all(Array.from({ length: 6 }, async (_, index) => fetch(
    `${origin}/launch?ticket=${encodeURIComponent(ticket("spammer", `spam-${index}`))}`,
    { headers: { accept: "application/json" } },
  )));
  assert.deepEqual(spam.map(({ status }) => status), [200, 200, 200, 200, 429, 429]);
  assert.equal(spam.at(-1).headers.get("retry-after"), "60");
});

function ticket(participantId, jti) {
  return issueParticipantTicket({ eventId: EVENT, audience: "last-stop", participantId }, SECRET, { jti });
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
