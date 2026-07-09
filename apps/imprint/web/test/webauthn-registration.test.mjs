import assert from "node:assert/strict";
import test from "node:test";
import { p256 } from "@noble/curves/p256";
import { sha256 } from "@noble/hashes/sha256";
import {
  compressedP256FromVerifiedRegistration,
  enforceRegistrationPolicy,
  rpIDHashFromVerifiedRegistration,
} from "../lib/webauthn-registration.mjs";

function coseP256PublicKey(compressedPublicKey) {
  const point = Buffer.from(
    p256.ProjectivePoint.fromHex(compressedPublicKey).toRawBytes(false)
  );
  const x = point.subarray(1, 33);
  const y = point.subarray(33, 65);

  // COSE_Key: { 1: 2 (EC2), 3: -7 (ES256), -1: 1 (P-256), -2: x, -3: y }
  return Buffer.concat([
    Buffer.from([0xa5, 0x01, 0x02, 0x03, 0x26, 0x20, 0x01, 0x21, 0x58, 0x20]),
    x,
    Buffer.from([0x22, 0x58, 0x20]),
    y,
  ]);
}

function registrationFor(secretByte, overrides = {}) {
  const secretKey = Buffer.alloc(32);
  secretKey[31] = secretByte;
  const publicKey = Buffer.from(p256.getPublicKey(secretKey, true));
  return {
    publicKey,
    verification: {
      verified: true,
      registrationInfo: {
        fmt: "packed",
        aaguid: "12345678-1234-1234-1234-123456789abc",
        credential: {
          id: `credential-${secretByte}`,
          publicKey: coseP256PublicKey(publicKey),
        },
        credentialDeviceType: "singleDevice",
        credentialBackedUp: false,
        rpID: "localhost",
        ...overrides,
      },
    },
  };
}

test("derives the registered key solely from the verified credential COSE key", () => {
  const attested = registrationFor(1);
  const clientSupplied = registrationFor(2);

  const registrationResponse = {
    response: {
      publicKey: clientSupplied.publicKey.toString("base64url"),
    },
  };
  assert.notDeepEqual(clientSupplied.publicKey, attested.publicKey);
  assert.ok(registrationResponse.response.publicKey);
  assert.deepEqual(
    compressedP256FromVerifiedRegistration(attested.verification),
    attested.publicKey
  );
});

test("rejects a result that was not verified", () => {
  assert.throws(
    () => compressedP256FromVerifiedRegistration({ verified: false }),
    /verified registration did not contain a credential public key/
  );
});

test("derives the RP ID hash from the RP ID matched during verification", () => {
  const { verification } = registrationFor(3, { rpID: "ctf.example" });
  assert.deepEqual(
    rpIDHashFromVerifiedRegistration(verification),
    Buffer.from(sha256("ctf.example"))
  );
});

test("supports an optional production authenticator policy without breaking local defaults", () => {
  const { verification } = registrationFor(4);
  const info = verification.registrationInfo;

  assert.doesNotThrow(() => enforceRegistrationPolicy(info, {}));
  assert.doesNotThrow(() =>
    enforceRegistrationPolicy(info, {
      IMPRINT_REQUIRE_ATTESTATION: "true",
      IMPRINT_REQUIRE_DEVICE_BOUND_PASSKEY: "true",
      IMPRINT_ALLOWED_AAGUIDS: "12345678-1234-1234-1234-123456789ABC",
    })
  );
  assert.throws(
    () =>
      enforceRegistrationPolicy(info, {
        IMPRINT_ALLOWED_AAGUIDS: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      }),
    /AAGUID is not allowed/
  );
  assert.throws(
    () =>
      enforceRegistrationPolicy(
        { ...info, fmt: "none" },
        { IMPRINT_REQUIRE_ATTESTATION: "true" }
      ),
    /attestation is required/
  );
  assert.throws(
    () =>
      enforceRegistrationPolicy(
        {
          ...info,
          credentialDeviceType: "multiDevice",
          credentialBackedUp: true,
        },
        { IMPRINT_REQUIRE_DEVICE_BOUND_PASSKEY: "true" }
      ),
    /device-bound passkey is required/
  );
});
