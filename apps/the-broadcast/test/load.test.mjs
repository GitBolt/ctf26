import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";

import bs58 from "bs58";
import nacl from "tweetnacl";

import { createBroadcastServer } from "../src/server.mjs";
import { createStore } from "../src/store.mjs";

const SECRET = "broadcast-load-ticket-secret-at-least-32-bytes";

test("40 participant sessions stay isolated and claim spam has hard bounds", async (t) => {
  const backing = await createStore({ CTF_EVENT_GENERATION: "load-event" });
  let slowClaims = false;
  let activeWrites = 0;
  let peakWrites = 0;
  let healthCalls = 0;
  const store = {
    ...backing,
    async putInstance(participantId, value) {
      if (slowClaims && value.signatures?.length) {
        activeWrites += 1; peakWrites = Math.max(peakWrites, activeWrites);
        try { await delay(100); }
        finally { activeWrites -= 1; }
      }
      return backing.putInstance(participantId, value);
    },
    async health() { healthCalls += 1; await delay(20); return backing.health(); },
  };
  const service = await createBroadcastServer({
    allowDev: true,
    ticketSecret: SECRET,
    powBits: 1,
    store,
    env: {
      ALLOW_DEV_LAUNCH: "true",
      CTF_EVENT_GENERATION: "load-event",
      BROADCAST_SESSION_RATE_MAX: "4",
      BROADCAST_POW_RATE_MAX: "3",
      BROADCAST_MAX_ACTIVE_CLAIMS: "6",
    },
  });
  const address = await service.listen(0);
  t.after(() => service.close());
  const origin = `http://127.0.0.1:${address.port}`;
  const healthResponses = await Promise.all(Array.from({ length: 40 }, () => fetch(`${origin}/health`)));
  assert.ok(healthResponses.every(({ status }) => status === 200));
  assert.equal(healthCalls, 1);
  const participants = Array.from({ length: 40 }, (_, index) => `load-${index}`);

  const launched = await Promise.all(participants.map(async (participantId) => {
    const response = await fetch(`${origin}/launch?participantId=${participantId}`, { redirect: "manual" });
    return { participantId, status: response.status, cookie: response.headers.get("set-cookie")?.split(";")[0] || "" };
  }));
  assert.ok(launched.every(({ status, cookie }) => status === 303 && cookie));
  const cookies = new Map(launched.map(({ participantId, cookie }) => [participantId, cookie]));

  const claims = await Promise.all(participants.map(async (participantId) => {
    const cookie = cookies.get(participantId);
    const configResponse = await fetch(`${origin}/api/config`, { headers: { cookie } });
    const config = await configResponse.json();
    assert.equal(config.participantId, participantId);
    assert.match(config.message, new RegExp(`Participant: ${participantId}`));
    const wallet = nacl.sign.keyPair();
    const body = {
      pubkey: bs58.encode(wallet.publicKey),
      message: config.message,
      signature: Buffer.from(nacl.sign.detached(Buffer.from(config.message), wallet.secretKey)).toString("base64"),
    };
    const pow = await (await fetch(`${origin}/api/pow`, { headers: { cookie } })).json();
    return { participantId, cookie, body, proof: solvePow(pow, body) };
  }));

  slowClaims = true;
  const responses = await Promise.all(claims.map(({ cookie, body, proof }) => fetch(`${origin}/api/claim`, {
    method: "POST",
    headers: { cookie, "content-type": "application/json", "x-pow": proof },
    body: JSON.stringify(body),
  })));
  const accepted = responses.filter(({ status }) => status === 200).length;
  const busy = responses.filter(({ status }) => status === 429).length;
  assert.ok(accepted >= 6 && accepted < 40);
  assert.equal(accepted + busy, 40);
  assert.ok(peakWrites <= 6);

  const repeated = claims[0];
  const repeatedPows = await Promise.all([0, 1].map(async () => (await fetch(`${origin}/api/pow`, { headers: { cookie: repeated.cookie } })).json()));
  const overlapping = await Promise.all(repeatedPows.map((pow) => fetch(`${origin}/api/claim`, {
    method: "POST",
    headers: { cookie: repeated.cookie, "content-type": "application/json", "x-pow": solvePow(pow, repeated.body) },
    body: JSON.stringify(repeated.body),
  })));
  assert.deepEqual(overlapping.map(({ status }) => status).sort(), [200, 429]);

  const spamLaunch = await fetch(`${origin}/launch?participantId=spammer`, { redirect: "manual" });
  const spamCookie = spamLaunch.headers.get("set-cookie").split(";")[0];
  const spam = [];
  for (let index = 0; index < 5; index += 1) spam.push(await fetch(`${origin}/api/pow`, { headers: { cookie: spamCookie } }));
  assert.deepEqual(spam.map(({ status }) => status), [200, 200, 200, 429, 429]);
  assert.equal(spam.at(-1).headers.get("retry-after"), "60");

  const oversized = await fetch(`${origin}/api/claim`, {
    method: "POST",
    headers: { cookie: spamCookie, "content-type": "application/json" },
    body: JSON.stringify({ padding: "x".repeat(25_000) }),
  });
  assert.equal(oversized.status, 413);
});

function solvePow(pow, body) {
  const canonical = JSON.stringify({ pubkey: body.pubkey, message: body.message, signature: body.signature });
  const bodyHash = crypto.createHash("sha256").update(canonical).digest("hex");
  for (let nonce = 0; ; nonce += 1) {
    const digest = crypto.createHash("sha256").update(`${pow.challenge}:${nonce}:${bodyHash}`).digest();
    if (leadingZeroBits(digest) >= pow.bits) return `${pow.challenge}:${nonce}`;
  }
}

function leadingZeroBits(bytes) {
  let count = 0;
  for (const byte of bytes) {
    if (byte === 0) { count += 8; continue; }
    count += Math.clz32(byte) - 24;
    break;
  }
  return count;
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
