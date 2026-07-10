import { convertCOSEtoPKCS } from "@simplewebauthn/server/helpers";

const TEAM_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;
const P256_UNCOMPRESSED_POINT_SIZE = 65;
const P256_COMPRESSED_POINT_SIZE = 33;

function requireText(value, label) {
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
  return Buffer.concat([Buffer.from([y[31] & 1 ? 0x03 : 0x02]), Buffer.from(x)]);
}

export function parseCredentialRoster(raw = process.env.IMPRINT_CREDENTIAL_ROSTER_JSON) {
  if (!raw) {
    throw new Error("IMPRINT_CREDENTIAL_ROSTER_JSON is required");
  }
  let entries;
  try {
    entries = JSON.parse(raw);
  } catch {
    throw new Error("IMPRINT_CREDENTIAL_ROSTER_JSON must be valid JSON");
  }
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new Error("IMPRINT_CREDENTIAL_ROSTER_JSON must contain at least one credential");
  }

  const teams = new Set();
  const credentialIds = new Set();
  const passkeyPubkeys = new Set();
  return entries.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(`credential roster entry ${index} must be an object`);
    }
    const teamId = requireText(entry.teamId, `credential roster entry ${index}.teamId`);
    if (!TEAM_ID_PATTERN.test(teamId) || teams.has(teamId)) {
      throw new Error(`credential roster entry ${index}.teamId is invalid or duplicated`);
    }
    teams.add(teamId);

    const credentialId = requireText(
      entry.credentialId,
      `credential roster entry ${index}.credentialId`,
    );
    if (!BASE64URL_PATTERN.test(credentialId) || credentialIds.has(credentialId)) {
      throw new Error(`credential roster entry ${index}.credentialId is invalid or duplicated`);
    }
    credentialIds.add(credentialId);

    const cosePublicKey = parseBase64url(
      entry.credentialPublicKeyCoseBase64,
      `credential roster entry ${index}.credentialPublicKeyCoseBase64`,
    );
    const passkeyPubkey = compressedP256FromCOSE(cosePublicKey);
    if (passkeyPubkey.length !== P256_COMPRESSED_POINT_SIZE) {
      throw new Error(`credential roster entry ${index} has an invalid P-256 key`);
    }
    const publicKeyHex = passkeyPubkey.toString("hex");
    if (passkeyPubkeys.has(publicKeyHex)) {
      throw new Error(`credential roster entry ${index} reuses a passkey public key`);
    }
    passkeyPubkeys.add(publicKeyHex);

    const counter = entry.counter ?? 0;
    if (!Number.isSafeInteger(counter) || counter < 0) {
      throw new Error(`credential roster entry ${index}.counter must be a non-negative integer`);
    }
    const transports = Array.isArray(entry.transports)
      ? entry.transports.filter((value) => typeof value === "string")
      : undefined;
    return Object.freeze({
      teamId,
      credentialId,
      cosePublicKey,
      passkeyPubkey,
      counter,
      transports,
    });
  });
}

export function credentialForTeam(teamId, env = process.env) {
  const credential = parseCredentialRoster(env.IMPRINT_CREDENTIAL_ROSTER_JSON).find(
    (entry) => entry.teamId === teamId,
  );
  if (!credential) {
    throw new Error("no event-issued security key is assigned to this team");
  }
  return credential;
}
