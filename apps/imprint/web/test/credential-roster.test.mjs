import assert from "node:assert/strict";
import test from "node:test";
import { p256 } from "@noble/curves/p256";

import { parseCredentialEntry } from "../lib/credential-roster.mjs";

function coseP256PublicKey(compressedPublicKey) {
  const point = Buffer.from(
    p256.ProjectivePoint.fromHex(compressedPublicKey).toRawBytes(false)
  );
  const x = point.subarray(1, 33);
  const y = point.subarray(33, 65);
  return Buffer.concat([
    Buffer.from([0xa5, 0x01, 0x02, 0x03, 0x26, 0x20, 0x01, 0x21, 0x58, 0x20]),
    x,
    Buffer.from([0x22, 0x58, 0x20]),
    y,
  ]);
}

function entry(participantId, secretByte) {
  const secretKey = Buffer.alloc(32);
  secretKey[31] = secretByte;
  const publicKey = Buffer.from(p256.getPublicKey(secretKey, true));
  return {
    participantId,
    credentialId: `credential-${secretByte}`,
    credentialPublicKeyCoseBase64:
      coseP256PublicKey(publicKey).toString("base64url"),
    counter: 0,
    transports: ["internal"],
  };
}

test("derives the on-chain P-256 key from a verified WebAuthn COSE key", () => {
  const credential = parseCredentialEntry(entry("participant-a", 1));
  assert.equal(credential.passkeyPubkey.length, 33);
  assert.match(
    credential.passkeyPubkey.toString("hex").slice(0, 2),
    /^(02|03)$/
  );
});

test("rejects malformed dynamic credential records", () => {
  assert.throws(
    () =>
      parseCredentialEntry({ ...entry("participant-a", 1), participantId: "" }),
    /participantId is required/
  );
  assert.throws(
    () =>
      parseCredentialEntry({
        ...entry("participant-a", 1),
        credentialPublicKeyCoseBase64: "not base64!",
      }),
    /must be base64url/
  );
});
