const AAGUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function normalizedAAGUID(value) {
  return String(value || "").trim().replace(/^\{/, "").replace(/\}$/, "").toLowerCase();
}

export function requireEnrollmentOperator(request, env = process.env) {
  if (env.IMPRINT_ENROLLMENT_ENABLED !== "true") {
    throw new Error("event security-key enrollment is disabled");
  }
  const secret = env.IMPRINT_ENROLLMENT_ADMIN_SECRET;
  if (typeof secret !== "string" || Buffer.byteLength(secret) < 32) {
    throw new Error("IMPRINT_ENROLLMENT_ADMIN_SECRET must contain at least 32 bytes");
  }
  if (request.headers.get("x-imprint-enrollment-secret") !== secret) {
    throw new Error("event security-key enrollment is unauthorized");
  }
}

export function enforceHardwareEnrollment(registrationInfo, env = process.env) {
  if (!registrationInfo || registrationInfo.fmt === "none") {
    throw new Error("direct hardware attestation is required for event enrollment");
  }
  if (
    registrationInfo.credentialDeviceType !== "singleDevice" ||
    registrationInfo.credentialBackedUp
  ) {
    throw new Error("a non-backed-up, single-device security key is required");
  }
  const allowed = String(env.IMPRINT_ENROLLMENT_ALLOWED_AAGUIDS || "")
    .split(",")
    .map(normalizedAAGUID)
    .filter(Boolean);
  if (!allowed.length || allowed.some((value) => !AAGUID_PATTERN.test(value))) {
    throw new Error("IMPRINT_ENROLLMENT_ALLOWED_AAGUIDS must contain approved hardware AAGUIDs");
  }
  if (!allowed.includes(normalizedAAGUID(registrationInfo.aaguid))) {
    throw new Error("security key AAGUID is not approved for this event");
  }
}
