import assert from "node:assert/strict";
import test from "node:test";
import {
  expectedWebAuthnOrigin,
  expectedWebAuthnRpID,
} from "../lib/webauthn-config.mjs";

const request = { url: "http://localhost:3002/api/passkey/options" };

test("local development derives WebAuthn configuration from the request", () => {
  const env = { NODE_ENV: "development" };
  assert.equal(expectedWebAuthnOrigin(request, env), "http://localhost:3002");
  assert.equal(expectedWebAuthnRpID(request, env), "localhost");
});

test("production requires explicit origin and RP ID configuration", () => {
  const env = { NODE_ENV: "production" };
  assert.throws(
    () => expectedWebAuthnOrigin(request, env),
    /IMPRINT_EXPECTED_ORIGIN is required/
  );
  assert.throws(
    () => expectedWebAuthnRpID(request, env),
    /IMPRINT_RP_ID is required/
  );
});

test("configured values are normalized and malformed values are rejected", () => {
  const env = {
    NODE_ENV: "production",
    IMPRINT_EXPECTED_ORIGIN: "https://imprint.example.org",
    IMPRINT_RP_ID: "IMPRINT.EXAMPLE.ORG",
  };
  assert.equal(
    expectedWebAuthnOrigin(request, env),
    "https://imprint.example.org"
  );
  assert.equal(expectedWebAuthnRpID(request, env), "imprint.example.org");

  assert.throws(
    () =>
      expectedWebAuthnRpID(request, {
        NODE_ENV: "production",
        IMPRINT_RP_ID: "https://imprint.example.org",
      }),
    /must be a hostname/
  );
});
