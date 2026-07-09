import { convertCOSEtoPKCS } from "@simplewebauthn/server/helpers";
import { sha256 } from "@noble/hashes/sha256";

const P256_UNCOMPRESSED_POINT_SIZE = 65;

function normalizedAAGUID(value) {
  return String(value || "")
    .trim()
    .replace(/^\{/, "")
    .replace(/\}$/, "")
    .toLowerCase();
}

export function compressedP256FromVerifiedRegistration(verification) {
  const cosePublicKey = verification?.registrationInfo?.credential?.publicKey;
  if (!verification?.verified || !cosePublicKey) {
    throw new Error(
      "verified registration did not contain a credential public key"
    );
  }

  // This point comes from the credentialPublicKey embedded in the attested
  // authenticator data that verifyRegistrationResponse() verified. Never use
  // response.publicKey: that is a client-supplied convenience field and is not
  // part of the attestation verification result.
  const point = Uint8Array.from(convertCOSEtoPKCS(cosePublicKey));
  if (point.length !== P256_UNCOMPRESSED_POINT_SIZE || point[0] !== 0x04) {
    throw new Error(
      "verified credential is not an uncompressed P-256 public key"
    );
  }

  const x = point.slice(1, 33);
  const y = point.slice(33, 65);
  const prefix = y[31] & 1 ? 0x03 : 0x02;
  return Buffer.concat([Buffer.from([prefix]), Buffer.from(x)]);
}

export function rpIDHashFromVerifiedRegistration(verification) {
  const rpID = verification?.registrationInfo?.rpID;
  if (!verification?.verified || !rpID) {
    throw new Error("verified registration did not contain a matched RP ID");
  }
  return Buffer.from(sha256(Buffer.from(rpID, "utf8")));
}

export function enforceRegistrationPolicy(registrationInfo, env = process.env) {
  if (!registrationInfo)
    throw new Error("registration information is required");

  if (
    env.IMPRINT_REQUIRE_ATTESTATION === "true" &&
    registrationInfo.fmt === "none"
  ) {
    throw new Error("authenticator attestation is required");
  }

  if (
    env.IMPRINT_REQUIRE_DEVICE_BOUND_PASSKEY === "true" &&
    (registrationInfo.credentialDeviceType !== "singleDevice" ||
      registrationInfo.credentialBackedUp)
  ) {
    throw new Error("a non-backed-up, device-bound passkey is required");
  }

  const allowedAAGUIDs = String(env.IMPRINT_ALLOWED_AAGUIDS || "")
    .split(",")
    .map(normalizedAAGUID)
    .filter(Boolean);
  if (
    allowedAAGUIDs.length > 0 &&
    !allowedAAGUIDs.includes(normalizedAAGUID(registrationInfo.aaguid))
  ) {
    throw new Error("authenticator AAGUID is not allowed");
  }
}
