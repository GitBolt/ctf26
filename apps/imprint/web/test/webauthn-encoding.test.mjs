import assert from "node:assert/strict";
import test from "node:test";
import { p256 } from "@noble/curves/p256";

import {
  base64UrlToBuffer,
  parseDERSignature,
} from "../lib/webauthn-encoding.mjs";

test("decodes only canonical unpadded base64url", () => {
  const bytes = Buffer.alloc(32, 0xab);
  const encoded = bytes.toString("base64url");
  assert.deepEqual(base64UrlToBuffer(encoded), bytes);
  assert.throws(() => base64UrlToBuffer(`${encoded}=`), /canonical base64url/);
  assert.throws(() => base64UrlToBuffer("abc!"), /canonical base64url/);
});

test("converts a valid DER P-256 signature to canonical compact low-S form", () => {
  const secret = Buffer.alloc(32);
  secret[31] = 7;
  const signature = p256.sign(Buffer.alloc(32, 3), secret, { prehash: true });
  const compact = parseDERSignature(signature.toDERRawBytes());
  assert.equal(compact.length, 64);
  const parsed = p256.Signature.fromCompact(compact);
  assert.equal(parsed.hasHighS(), false);
});

test("rejects trailing bytes, malformed lengths, and non-minimal integers", () => {
  const valid = Buffer.from("3006020101020101", "hex");
  assert.equal(parseDERSignature(valid).length, 64);
  assert.throws(
    () => parseDERSignature(Buffer.concat([valid, Buffer.from([0])])),
    /sequence length/
  );
  assert.throws(
    () => parseDERSignature(Buffer.from("3080060201010000", "hex")),
    /invalid DER length/
  );
  assert.throws(
    () => parseDERSignature(Buffer.from("300702020001020101", "hex")),
    /not minimally encoded/
  );
});
