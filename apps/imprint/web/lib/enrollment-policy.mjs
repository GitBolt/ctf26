import crypto from "node:crypto";

const AAGUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function normalizedAAGUID(value) {
  return String(value || "")
    .trim()
    .replace(/^\{/, "")
    .replace(/\}$/, "")
    .toLowerCase();
}

export function requireEnrollmentOperator(request, env = process.env) {
  if (env.IMPRINT_ENROLLMENT_ENABLED !== "true") {
    throw new Error("event passkey enrollment is disabled");
  }
  const secret = env.IMPRINT_ENROLLMENT_ADMIN_SECRET;
  if (typeof secret !== "string" || Buffer.byteLength(secret) < 32) {
    throw new Error(
      "IMPRINT_ENROLLMENT_ADMIN_SECRET must contain at least 32 bytes"
    );
  }
  const supplied = request.headers.get("x-imprint-enrollment-secret") || "";
  const suppliedBytes = Buffer.from(supplied);
  const expectedBytes = Buffer.from(secret);
  if (
    suppliedBytes.length !== expectedBytes.length ||
    !crypto.timingSafeEqual(suppliedBytes, expectedBytes)
  ) {
    throw new Error("event passkey enrollment is unauthorized");
  }
}

export function enforcePlatformEnrollment(
  registrationInfo,
  response,
  env = process.env
) {
  if (!registrationInfo)
    throw new Error("a verified platform passkey is required");
  if (response?.authenticatorAttachment !== "platform") {
    throw new Error(
      "enrollment requires a platform authenticator on this device"
    );
  }
  // Enrollment is an organizer-controlled ceremony. Platform credentials may use
  // fmt:none and may be synced; the admin secret and in-person biometric prompt
  // are the trust boundary. Public/player registration remains disabled.
  if (
    registrationInfo.credentialDeviceType !== "singleDevice" &&
    registrationInfo.credentialDeviceType !== "multiDevice"
  ) {
    throw new Error("unsupported passkey device type");
  }
  const allowed = String(env.IMPRINT_ENROLLMENT_ALLOWED_AAGUIDS || "")
    .split(",")
    .map(normalizedAAGUID)
    .filter(Boolean);
  if (allowed.some((value) => !AAGUID_PATTERN.test(value))) {
    throw new Error(
      "IMPRINT_ENROLLMENT_ALLOWED_AAGUIDS contains an invalid AAGUID"
    );
  }
  if (
    allowed.length &&
    !allowed.includes(normalizedAAGUID(registrationInfo.aaguid))
  ) {
    throw new Error("passkey AAGUID is not approved for this event");
  }
}
