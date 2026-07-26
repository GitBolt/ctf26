import { convertCOSEtoPKCS } from "@simplewebauthn/server/helpers";

const PARTICIPANT_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;
const P256_UNCOMPRESSED_POINT_SIZE = 65;
const P256_COMPRESSED_POINT_SIZE = 33;
const CREDENTIAL_FIELDS = new Set([
  "participantId",
  "credentialId",
  "credentialPublicKeyCoseBase64",
  "counter",
  "transports",
  "teamId",
]);

export function requireText(value, label) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} is required`);
  }
  return value.trim();
}

function parseBase64url(value, label) {
  const text = requireText(value, label);
  if (!BASE64URL_PATTERN.test(text)) {
    throw new Error(`${label} must be base64url`);
  }
  return Buffer.from(text, "base64url");
}

export function compressedP256FromCOSE(cosePublicKey) {
  const point = Uint8Array.from(convertCOSEtoPKCS(cosePublicKey));
  if (point.length !== P256_UNCOMPRESSED_POINT_SIZE || point[0] !== 0x04) {
    throw new Error("credential is not an uncompressed P-256 public key");
  }
  const x = point.slice(1, 33);
  const y = point.slice(33, 65);
  return Buffer.concat([
    Buffer.from([y[31] & 1 ? 0x03 : 0x02]),
    Buffer.from(x),
  ]);
}

export function parseCredentialEntry(entry, label = "credential") {
  const index = label;
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    throw new Error(`credential roster entry ${index} must be an object`);
  }
  if (Object.keys(entry).some((field) => !CREDENTIAL_FIELDS.has(field))) {
    throw new Error(
      `credential roster entry ${index} contains unsupported fields`
    );
  }
  if (entry.participantId && entry.teamId) {
    throw new Error(
      `credential roster entry ${index} contains two participant identities`
    );
  }
  // Existing rehearsal credentials predate the individual-only roster. Read
  // their former field as the participant ID so the enrolled hardware remains
  // usable, while every returned and newly enrolled record uses participantId.
  const participantId = requireText(
    entry.participantId || entry.teamId,
    `credential roster entry ${index}.participantId`
  );
  if (!PARTICIPANT_ID_PATTERN.test(participantId)) {
    throw new Error(
      `credential roster entry ${index}.participantId is invalid`
    );
  }

  const credentialId = requireText(
    entry.credentialId,
    `credential roster entry ${index}.credentialId`
  );
  if (!BASE64URL_PATTERN.test(credentialId)) {
    throw new Error(`credential roster entry ${index}.credentialId is invalid`);
  }

  const cosePublicKey = parseBase64url(
    entry.credentialPublicKeyCoseBase64,
    `credential roster entry ${index}.credentialPublicKeyCoseBase64`
  );
  const passkeyPubkey = compressedP256FromCOSE(cosePublicKey);
  if (passkeyPubkey.length !== P256_COMPRESSED_POINT_SIZE) {
    throw new Error(
      `credential roster entry ${index} has an invalid P-256 key`
    );
  }
  const counter = entry.counter ?? 0;
  if (!Number.isSafeInteger(counter) || counter < 0) {
    throw new Error(
      `credential roster entry ${index}.counter must be a non-negative integer`
    );
  }
  const transports = Array.isArray(entry.transports)
    ? entry.transports.filter((value) => typeof value === "string")
    : undefined;
  return Object.freeze({
    participantId,
    credentialId,
    cosePublicKey,
    passkeyPubkey,
    counter,
    transports,
  });
}
