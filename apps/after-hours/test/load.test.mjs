import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";

import { issueParticipantTicket } from "@ctf26/participant-ticket";
import { handleInteraction } from "../src/discord.mjs";
import { start } from "../src/server.mjs";

const SECRET = "after-hours-load-ticket-secret-at-least-32-bytes";
const EVENT = "load-event";

test("40 participants stay isolated while launch spam and global work are bounded", async (t) => {
  const { server, store } = await start({
    PORT: "0",
    CTF_EVENT_GENERATION: EVENT,
    AFTER_HOURS_PUBLIC_ORIGIN: "http://127.0.0.1:3006",
    AFTER_HOURS_RPC_URL: "https://rpc.invalid",
    AFTER_HOURS_STORE_OWNER: "11111111111111111111111111111111",
    AFTER_HOURS_NIGHT_MINT: "Fkwatju4DW2cgknrwQc4byBGAdKL44zcAkG4JVNuEjFb",
    AFTER_HOURS_NIGHT_TREASURY_KEYPAIR: encodedEd25519Keypair(),
    DISCORD_APPLICATION_ID: "1526903167424528485",
    DISCORD_APPLICATION_PUBLIC_KEY: "a".repeat(64),
    AFTER_HOURS_FLAG_SECRET: "after-hours-load-flag-secret-at-least-32-bytes",
    CHALLENGE_TICKET_SECRET: SECRET,
    AFTER_HOURS_LAUNCH_RATE_MAX: "4",
    AFTER_HOURS_MAX_ACTIVE_OPERATIONS: "8",
    AFTER_HOURS_EXPECTED_PARTICIPANTS: "40",
    AFTER_HOURS_MIN_TREASURY_LAMPORTS: "100000000",
  }, {
    nightDistributor: {
      mint: "Fkwatju4DW2cgknrwQc4byBGAdKL44zcAkG4JVNuEjFb",
      inventory: async () => ({ nightBaseUnits: 280_000_000n, payerLamports: 100_000_000n }),
    },
  });
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await store.close();
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  let healthCalls = 0;
  const health = store.health.bind(store);
  store.health = async () => { healthCalls += 1; await delay(20); return health(); };
  const healthResponses = await Promise.all(Array.from({ length: 40 }, () => fetch(`${origin}/health`)));
  assert.ok(healthResponses.every(({ status }) => status === 200));
  assert.equal(healthCalls, 1);
  const participants = Array.from({ length: 40 }, (_, index) => `load-${index}`);
  const launches = await Promise.all(participants.map(async (participantId, index) => {
    const response = await fetch(`${origin}/launch?ticket=${encodeURIComponent(ticket(participantId, `launch-${index}`))}`);
    const html = await response.text();
    return { participantId, status: response.status, passage: html.match(/passage:([A-Za-z0-9_-]{12})/)?.[1] };
  }));
  assert.deepEqual(new Set(launches.map(({ status }) => status)), new Set([200]));
  assert.equal(new Set(launches.map(({ passage }) => passage)).size, 40);

  await Promise.all(launches.map(async ({ participantId, passage }, index) => {
    const bound = await store.bindPassage(passage, String(10_000_000 + index));
    assert.equal(bound.identity.participantId, participantId);
  }));

  let activeDistributions = 0;
  let peakDistributions = 0;
  const distributionAttempts = await Promise.all(launches.map((_, index) => handleInteraction({
    type: 2,
    context: 0,
    guild_id: "777",
    member: { user: { id: String(10_000_000 + index) } },
    data: { name: "afterhours", options: [{ type: 1, name: "allotment", options: [{ name: "wallet", value: `wallet-${index}` }] }] },
  }, {
    store,
    now: () => 1_000,
    config: { nightMint: "load-mint", commandRateMax: 30, maxActiveDistributions: 1 },
    nightDistributor: { issue: async (wallet) => {
      activeDistributions += 1; peakDistributions = Math.max(peakDistributions, activeDistributions);
      try { await delay(30); return { signature: `signature-${wallet}`, tokenAccount: `account-${wallet}` }; }
      finally { activeDistributions -= 1; }
    } },
  })));
  const deferred = distributionAttempts.filter((outcome) => outcome.deferred);
  assert.equal(deferred.length, 1);
  await Promise.all(deferred.map((outcome) => outcome.deferred()));
  assert.equal(peakDistributions, 1);

  const slots = await Promise.all(participants.map((participantId) => store.acquireSlot("load-chain", participantId, 1_000, 10_000, 8)));
  assert.equal(slots.filter(Boolean).length, 8);
  assert.equal(await store.acquireSlot("load-chain", participants[0], 1_001, 10_000, 8), false);
  await Promise.all(participants.map((participantId) => store.releaseSlot("load-chain", participantId)));

  const spam = await Promise.all(Array.from({ length: 6 }, async (_, index) => fetch(
    `${origin}/launch?ticket=${encodeURIComponent(ticket("spammer", `spam-${index}`))}`,
  )));
  assert.deepEqual(spam.map(({ status }) => status), [200, 200, 200, 200, 429, 429]);
  assert.equal(spam.at(-1).headers.get("retry-after"), "60");
});

function ticket(participantId, jti) {
  return issueParticipantTicket({ eventId: EVENT, audience: "after-hours", participantId }, SECRET, { jti });
}

function encodedEd25519Keypair() {
  const { privateKey } = crypto.generateKeyPairSync("ed25519");
  const jwk = privateKey.export({ format: "jwk" });
  return Buffer.concat([Buffer.from(jwk.d, "base64url"), Buffer.from(jwk.x, "base64url")]).toString("base64");
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
