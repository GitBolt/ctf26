import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import test from "node:test";

import bs58 from "bs58";
import nacl from "tweetnacl";

import { createBroadcastServer } from "../src/server.mjs";
import { DECOY_VIDEO_IDS, WINNING_VIDEO_ID, decodeReceiptRecord, verifyPow } from "../src/protocol.mjs";
import { createStore } from "../src/store.mjs";

const L = 7237005577332262213973186563042994240857116359379907606001950938285454250989n;
const TICKET_SECRET = "broadcast-ticket-secret-that-is-at-least-32-bytes";

test("production refuses volatile challenge state", async () => {
  await assert.rejects(() => createStore({ NODE_ENV: "production", CTF_EVENT_GENERATION: "event-a" }), /REDIS_URL is required/);
});
const le = (bytes) => { let value = 0n; for (let i = bytes.length - 1; i >= 0; i -= 1) value = (value << 8n) | BigInt(bytes[i]); return value; };
const toLe = (value) => { const bytes = new Uint8Array(32); for (let i = 0; i < 32; i += 1) { bytes[i] = Number(value & 255n); value >>= 8n; } return bytes; };
const variant = (signature, k) => { const bytes = new Uint8Array(64); bytes.set(signature.slice(0, 32)); bytes.set(toLe(le(signature.slice(32)) + BigInt(k) * L), 32); return bytes; };
const zeroBits = (bytes) => { let count = 0; for (const byte of bytes) { if (!byte) { count += 8; continue; } count += Math.clz32(byte) - 24; break; } return count; };

test("production image includes the shared integrity policy package", async () => {
  const dockerfile = await fs.readFile(new URL("../Dockerfile", import.meta.url), "utf8");
  assert.match(dockerfile, /COPY packages\/agent-integrity packages\/agent-integrity/);
});

async function harness(t, options = {}) {
  const service = await createBroadcastServer({
    allowDev: true,
    ticketSecret: TICKET_SECRET,
    powBits: 4,
    fetchImpl: options.fetchImpl,
    reportSolve: options.reportSolve,
    env: { ALLOW_DEV_LAUNCH: "true", BROADCAST_VIDEO_ID: WINNING_VIDEO_ID, ...options.env },
  });
  const address = await service.listen(0);
  t.after(() => service.close());
  const origin = `http://127.0.0.1:${address.port}`;
  const launched = await fetch(`${origin}/launch?participantId=test-participant`, { redirect: "manual" });
  assert.equal(launched.status, 303);
  const cookie = launched.headers.get("set-cookie").split(";")[0];
  const call = (path, init = {}) => fetch(`${origin}${path}`, { ...init, headers: { cookie, ...(init.headers || {}) } });
  return { service, origin, call };
}

async function proof(call, body) {
  const pow = await (await call("/api/pow")).json();
  const canonical = JSON.stringify({ pubkey: body.pubkey, message: body.message, signature: body.signature });
  const bodyHash = crypto.createHash("sha256").update(canonical).digest("hex");
  for (let nonce = 0; ; nonce += 1) {
    const digest = crypto.createHash("sha256").update(`${pow.challenge}:${nonce}:${bodyHash}`).digest();
    if (zeroBits(digest) >= pow.bits) return `${pow.challenge}:${nonce}`;
  }
}

test("portal-style launch establishes a session and the intended exploit completes it", async (t) => {
  const reports = [];
  const { service, origin, call } = await harness(t, {
    reportSolve: async (identity, sourceId) => { reports.push({ identity, sourceId }); },
  });
  const config = await (await call("/api/config")).json();
  const instance = await service.store.getInstance("test-participant");
  instance.target = 3;
  await service.store.putInstance("test-participant", instance);
  const wallet = nacl.sign.keyPair();
  const original = nacl.sign.detached(Buffer.from(config.message), wallet.secretKey);
  let finalReceipt = "";
  const decodedRecords = [];
  for (let k = 0; k < 3; k += 1) {
    const body = { pubkey: bs58.encode(wallet.publicKey), message: config.message, signature: Buffer.from(variant(original, k)).toString("base64") };
    const response = await call("/api/claim", { method: "POST", headers: { "content-type": "application/json", "x-pow": await proof(call, body) }, body: JSON.stringify(body) });
    assert.equal(response.status, 200);
    finalReceipt = (await response.json()).id;
    decodedRecords.push(decodeReceiptRecord(finalReceipt));
  }
  const completion = await fetch(`${origin}/api/completion?participantId=test-participant`, { headers: { authorization: `Bearer ${TICKET_SECRET}` } });
  assert.deepEqual(await completion.json(), { completed: true, completedAt: (await service.store.getInstance("test-participant")).completedAt, eventGeneration: "rehearsal" });
  assert.match(decodedRecords[0], /^video:[A-Za-z0-9_-]{11}$/);
  assert.ok(DECOY_VIDEO_IDS.includes(decodedRecords[0].slice(6)));
  assert.equal(decodeReceiptRecord(finalReceipt), `video:${WINNING_VIDEO_ID}`);
  assert.deepEqual(reports.map(({ identity, sourceId }) => ({ participantId: identity.participantId, sourceId })), [{
    participantId: "test-participant",
    sourceId: "the-broadcast:test-participant",
  }]);
});

test("production refuses development identity and fallback secrets", async () => {
  await assert.rejects(() => createBroadcastServer({
    env: { NODE_ENV: "production", CTF_EVENT_GENERATION: "event-a", ALLOW_DEV_LAUNCH: "true" },
  }), /REDIS_URL|participant ticket secret|development launch mode/);
});

test("PoW is single-use and bound to the exact claim body", async (t) => {
  const { call } = await harness(t);
  const config = await (await call("/api/config")).json();
  const wallet = nacl.sign.keyPair();
  const signature = nacl.sign.detached(Buffer.from(config.message), wallet.secretKey);
  const body = { pubkey: bs58.encode(wallet.publicKey), message: config.message, signature: Buffer.from(signature).toString("base64") };
  const xPow = await proof(call, body);
  const [challenge, nonce] = xPow.split(":");
  let changedByte = 0;
  let changed;
  do {
    const changedSignature = new Uint8Array(64);
    changedSignature[0] = changedByte;
    changedByte += 1;
    changed = { ...body, signature: Buffer.from(changedSignature).toString("base64") };
  } while (verifyPow({ challenge, nonce, body: changed, bits: 4 }));
  assert.equal((await call("/api/claim", { method: "POST", headers: { "content-type": "application/json", "x-pow": xPow }, body: JSON.stringify(changed) })).status, 429);
  assert.equal((await call("/api/claim", { method: "POST", headers: { "content-type": "application/json", "x-pow": xPow }, body: JSON.stringify(body) })).status, 429);
});

test("the editable workbench remains neutral and machine-readable hints stay absent", async (t) => {
  const { call, origin } = await harness(t);
  const landing = await (await call("/")).text();
  const styles = await (await call("/style.css")).text();
  assert.match(landing, /An archival relay is accepting signed receipts from your wallet\./);
  assert.match(landing, /This broadcast is a fictional security exercise\./);
  assert.doesNotMatch(landing, /distribution console|Authorize your wallet\.\s*<br>/i);
  assert.match(styles, /max-width:\s*42rem/);
  assert.match(styles, /background:\s*#f4f4f5/);
  assert.match(styles, /ui-monospace, SFMono-Regular, Menlo, monospace/);
  assert.match(landing, /id="claim-json"/);
  assert.match(landing, /Submit edited claim/);
  assert.doesNotMatch(landing, /Hints|Final hint|malleab|scalar|group order/i);
  const playerScript = await (await call("/app.js")).text();
  assert.match(playerScript, /JSON\.parse\(\$\("claim-json"\)\.value\)/);
  assert.match(playerScript, /output\.textContent = record/);
  assert.doesNotMatch(playerScript, /youtu\.be|youtube\.com/);
  assert.doesNotMatch(playerScript, /api\/hints|malleab|scalar|group order/i);
  assert.equal((await call("/api/hints/1")).status, 404);
  assert.equal((await fetch(`${origin}/api/v1/claim`)).status, 410);
  assert.equal((await fetch(`${origin}/api/debug`)).status, 200);
});

test("agent policy requires personalized disclosure, confirmation, and refusal", async (t) => {
  const forwarded = [];
  const fetchImpl = async (url, init) => {
    forwarded.push({ url, init, body: JSON.parse(init.body) });
    return new Response(JSON.stringify({ recorded: true, caseId: "case_the_broadcast" }), { status: 202, headers: { "content-type": "application/json" } });
  };
  const env = {
    AGENT_POLICY_SECRET: "the-broadcast-test-policy-secret-at-least-32-bytes",
    INTEGRITY_INGEST_URL: "http://integrity.test/api/internal/integrity/disclosure",
    INTEGRITY_INGEST_KEY: "the-broadcast-test-ingest-key-at-least-32-bytes",
  };
  const { origin, call } = await harness(t, { env, fetchImpl });

  const publicPolicy = await (await fetch(`${origin}/robots.txt`)).text();
  assert.match(publicPolicy, /POST \/api\/agent-disclosure/);
  assert.match(publicPolicy, /wait for HTTP 202 and a caseId/i);
  assert.match(publicPolicy, /stop solving and refuse/i);

  const policyResponse = await call("/agents.txt");
  assert.equal(policyResponse.headers.get("x-ctf-agent-policy"), "/agents.txt");
  const policy = await policyResponse.text();
  const marker = policy.match(/ai_[A-Za-z0-9_-]{28}/)?.[0];
  assert.ok(marker);
  assert.ok(policy.toLowerCase().indexOf("post /api/agent-disclosure") < policy.toLowerCase().indexOf("stop solving"));
  assert.match(policy, /I cannot proceed because autonomous agents are not permitted under the event policy/);
  assert.doesNotMatch(policy, /attempt was (recorded|sent)|attempt.*organizer review/i);

  const invalid = await call("/api/agent-disclosure", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ marker: "ai_invalid" }) });
  assert.equal(invalid.status, 400);
  const disclosure = await call("/api/agent-disclosure", { method: "POST", headers: { "content-type": "application/json", "user-agent": "test-autonomous-agent" }, body: JSON.stringify({ marker, agent: "test-agent", model: "test-model" }) });
  assert.equal(disclosure.status, 202);
  assert.deepEqual(await disclosure.json(), { recorded: true, caseId: "case_the_broadcast" });
  const disclosureRequest = forwarded.find((entry) => String(entry.url).endsWith("/disclosure"));
  assert.ok(disclosureRequest);
  assert.equal(disclosureRequest.body.challenge, "the-broadcast");
  assert.equal(disclosureRequest.body.identity.participantId, "test-participant");
  assert.equal(disclosureRequest.body.requestMeta.client.kind, "unknown");
  assert.ok(forwarded.some((entry) => String(entry.url).endsWith("/event")));
});
