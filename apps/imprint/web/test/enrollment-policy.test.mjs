import assert from "node:assert/strict";
import test from "node:test";

import { enforcePlatformEnrollment } from "../lib/enrollment-policy.mjs";

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
