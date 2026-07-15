import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";

import bs58 from "bs58";
import nacl from "tweetnacl";

import { createGenesisServer } from "../src/server.mjs";
import { DECOY_VIDEO_IDS, WINNING_VIDEO_ID, decodeReceiptRecord } from "../src/protocol.mjs";

const L = 7237005577332262213973186563042994240857116359379907606001950938285454250989n;
const le = (bytes) => { let value = 0n; for (let i = bytes.length - 1; i >= 0; i -= 1) value = (value << 8n) | BigInt(bytes[i]); return value; };
const toLe = (value) => { const bytes = new Uint8Array(32); for (let i = 0; i < 32; i += 1) { bytes[i] = Number(value & 255n); value >>= 8n; } return bytes; };
const variant = (signature, k) => { const bytes = new Uint8Array(64); bytes.set(signature.slice(0, 32)); bytes.set(toLe(le(signature.slice(32)) + BigInt(k) * L), 32); return bytes; };
const zeroBits = (bytes) => { let count = 0; for (const byte of bytes) { if (!byte) { count += 8; continue; } count += Math.clz32(byte) - 24; break; } return count; };

async function harness(t) {
  const service = await createGenesisServer({ allowDev: true, powBits: 4, env: { ALLOW_DEV_LAUNCH: "true", ST_GENESIS_VIDEO_ID: WINNING_VIDEO_ID } });
  const address = await service.listen(0);
  t.after(() => service.close());
  const origin = `http://127.0.0.1:${address.port}`;
  const launched = await fetch(`${origin}/launch?teamId=test-team`, { redirect: "manual" });
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
  const { service, origin, call } = await harness(t);
  const config = await (await call("/api/config")).json();
  const instance = await service.store.getInstance("test-team");
  instance.target = 3;
  await service.store.putInstance("test-team", instance);
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
  const completion = await fetch(`${origin}/api/completion?teamId=test-team`, { headers: { authorization: "Bearer dev-st-genesis-completion-secret-32b" } });
  assert.deepEqual(await completion.json(), { completed: true, completedAt: (await service.store.getInstance("test-team")).completedAt });
  assert.match(decodedRecords[0], /^video:[A-Za-z0-9_-]{11}$/);
  assert.ok(DECOY_VIDEO_IDS.includes(decodedRecords[0].slice(6)));
  assert.equal(decodeReceiptRecord(finalReceipt), `video:${WINNING_VIDEO_ID}`);
});

test("PoW is single-use and bound to the exact claim body", async (t) => {
  const { call } = await harness(t);
  const config = await (await call("/api/config")).json();
  const wallet = nacl.sign.keyPair();
  const signature = nacl.sign.detached(Buffer.from(config.message), wallet.secretKey);
  const body = { pubkey: bs58.encode(wallet.publicKey), message: config.message, signature: Buffer.from(signature).toString("base64") };
  const xPow = await proof(call, body);
  const changed = { ...body, signature: Buffer.from(new Uint8Array(64)).toString("base64") };
  assert.equal((await call("/api/claim", { method: "POST", headers: { "content-type": "application/json", "x-pow": xPow }, body: JSON.stringify(changed) })).status, 429);
  assert.equal((await call("/api/claim", { method: "POST", headers: { "content-type": "application/json", "x-pow": xPow }, body: JSON.stringify(body) })).status, 429);
});

test("the editable workbench remains neutral and machine-readable hints stay absent", async (t) => {
  const { call, origin } = await harness(t);
  const landing = await (await call("/")).text();
  const styles = await (await call("/style.css")).text();
  assert.match(landing, /Sign the claim message with your wallet key and submit it to claim\./);
  assert.match(landing, /\$ST is a fictional token, minted for a security exercise\./);
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
