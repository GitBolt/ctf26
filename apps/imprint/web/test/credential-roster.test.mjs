import assert from "node:assert/strict";
import test from "node:test";
import { p256 } from "@noble/curves/p256";

import {
  credentialForTeam,
  parseCredentialRoster,
} from "../lib/credential-roster.mjs";

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

function entry(teamId, secretByte) {
  const secretKey = Buffer.alloc(32);
  secretKey[31] = secretByte;
  const publicKey = Buffer.from(p256.getPublicKey(secretKey, true));
  return {
    teamId,
    credentialId: `credential-${secretByte}`,
    credentialPublicKeyCoseBase64:
      coseP256PublicKey(publicKey).toString("base64url"),
    counter: 0,
    transports: ["usb"],
  };
}

test("derives the on-chain P-256 key exclusively from an organizer roster COSE key", () => {
  const roster = parseCredentialRoster(JSON.stringify([entry("team-a", 1)]));
  assert.equal(roster.length, 1);
  assert.equal(roster[0].passkeyPubkey.length, 33);
  assert.match(
    roster[0].passkeyPubkey.toString("hex").slice(0, 2),
    /^(02|03)$/
  );
});

test("requires one unique, valid physical-key record for every team", () => {
  const first = entry("team-a", 1);
  assert.throws(
    () =>
      parseCredentialRoster(
        JSON.stringify([first, { ...first, credentialId: "credential-2" }])
      ),
    /teamId is invalid or duplicated/
  );
  assert.throws(
    () =>
      parseCredentialRoster(
        JSON.stringify([
          { ...first, credentialPublicKeyCoseBase64: "not base64!" },
        ])
      ),
    /must be base64url/
  );
  const found = credentialForTeam("team-a", {
    IMPRINT_CREDENTIAL_ROSTER_JSON: JSON.stringify([first]),
  });
  assert.equal(found.credentialId, first.credentialId);
  assert.throws(
    () =>
      credentialForTeam("team-b", {
        IMPRINT_CREDENTIAL_ROSTER_JSON: JSON.stringify([first]),
      }),
    /no event-issued security key/
  );
});
