import assert from "node:assert/strict";
import test from "node:test";

import {
  enforcePlatformEnrollment,
  requireEnrollmentOperator,
} from "../lib/enrollment-policy.mjs";

const adminSecret = "a".repeat(32);

function requestWithSecret(secret) {
  return new Request("https://imprint.example.org/api/admin/enroll/options", {
    headers: { "x-imprint-enrollment-secret": secret },
  });
}

test("requires an enabled enrollment ceremony and the exact operator secret", () => {
  const env = {
    IMPRINT_ENROLLMENT_ENABLED: "true",
    IMPRINT_ENROLLMENT_ADMIN_SECRET: adminSecret,
  };
  assert.doesNotThrow(() =>
    requireEnrollmentOperator(requestWithSecret(adminSecret), env)
  );
  assert.throws(
    () => requireEnrollmentOperator(requestWithSecret("b".repeat(32)), env),
    /unauthorized/
  );
  assert.throws(
    () =>
      requireEnrollmentOperator(requestWithSecret(adminSecret), {
        ...env,
        IMPRINT_ENROLLMENT_ENABLED: "false",
      }),
    /disabled/
  );
});

test("accepts only a verified platform attachment and an approved AAGUID", () => {
  const registrationInfo = {
    credentialDeviceType: "singleDevice",
    aaguid: "12345678-1234-1234-1234-123456789abc",
  };
  const env = {
    IMPRINT_ENROLLMENT_ALLOWED_AAGUIDS: registrationInfo.aaguid,
  };
  assert.doesNotThrow(() =>
    enforcePlatformEnrollment(
      registrationInfo,
      { authenticatorAttachment: "platform" },
      env
    )
  );
  assert.throws(
    () =>
      enforcePlatformEnrollment(
        registrationInfo,
        { authenticatorAttachment: "cross-platform" },
        env
      ),
    /platform authenticator/
  );
  assert.throws(
    () =>
      enforcePlatformEnrollment(
        registrationInfo,
        { authenticatorAttachment: "platform" },
        {
          IMPRINT_ENROLLMENT_ALLOWED_AAGUIDS:
            "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        }
      ),
    /AAGUID is not approved/
  );
});
