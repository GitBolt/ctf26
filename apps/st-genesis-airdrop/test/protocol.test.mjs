import assert from "node:assert/strict";
import test from "node:test";

import bs58 from "bs58";
import nacl from "tweetnacl";

import { DECOY_VIDEO_IDS, WINNING_VIDEO_ID, createInstance, decodeReceiptRecord, ordinaryReceipt, parseAndVerifyClaim, recordClaim, solveReceipt, videoId } from "../src/protocol.mjs";

const L = 7237005577332262213973186563042994240857116359379907606001950938285454250989n;
function littleEndian(bytes) { let value = 0n; for (let i = bytes.length - 1; i >= 0; i -= 1) value = (value << 8n) | BigInt(bytes[i]); return value; }
function encodeLittleEndian(value, size) { const bytes = new Uint8Array(size); for (let i = 0; i < size; i += 1) { bytes[i] = Number(value & 255n); value >>= 8n; } return bytes; }
function variant(signature, k) { const result = new Uint8Array(64); result.set(signature.slice(0, 32)); result.set(encodeLittleEndian(littleEndian(signature.slice(32)) + BigInt(k) * L, 32), 32); return result; }

test("one Solana wallet authorization produces fifteen accepted byte-distinct variants", () => {
  const instance = createInstance("team-crypto", { target: 12, nonce: "fixed-instance", now: 1 });
  const wallet = nacl.sign.keyPair();
  const signature = nacl.sign.detached(Buffer.from(instance.message), wallet.secretKey);
  const seen = new Set();
  let current = instance;
  for (let k = 0; k <= 14; k += 1) {
    const bytes = variant(signature, k);
    const body = { pubkey: bs58.encode(wallet.publicKey), message: instance.message, signature: Buffer.from(bytes).toString("base64") };
    const verified = parseAndVerifyClaim(current, body);
    assert.equal(verified.ok, true);
    seen.add(verified.signatureKey);
    current = recordClaim(current, verified, { videoId: WINNING_VIDEO_ID, randomByte: 0, now: 2 }).instance;
  }
  assert.equal(seen.size, 15);
  assert.equal(current.signatures.length, 15);
  assert.ok(current.completedAt);
});

test("all ordinary receipts decode into the six original fake video alternatives", () => {
  const records = DECOY_VIDEO_IDS.map((id, index) => {
    assert.equal(decodeReceiptRecord(ordinaryReceipt(index)), `video:${id}`);
    return decodeReceiptRecord(ordinaryReceipt(index));
  });
  assert.equal(new Set(records).size, 6);
  assert.ok(records.every((record) => !record.includes("https://")));
});

test("the solved receipt uses the same video record shape as every decoy", () => {
  const instance = createInstance("team-receipt", { target: 1, nonce: "fixed", now: 1 });
  const wallet = nacl.sign.keyPair();
  const signature = nacl.sign.detached(Buffer.from(instance.message), wallet.secretKey);
  const verified = parseAndVerifyClaim(instance, { pubkey: bs58.encode(wallet.publicKey), message: instance.message, signature: Buffer.from(signature).toString("base64") });
  const result = recordClaim(instance, verified, { videoId: WINNING_VIDEO_ID, now: 2 });
  assert.equal(decodeReceiptRecord(result.receipt), `video:${WINNING_VIDEO_ID}`);
  assert.equal(decodeReceiptRecord(solveReceipt("https://youtu.be/Zg97oEONXk4")), `video:${WINNING_VIDEO_ID}`);
  assert.equal(videoId("https://www.youtube.com/watch?v=Zg97oEONXk4"), WINNING_VIDEO_ID);
});
