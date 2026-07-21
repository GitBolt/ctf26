import { PublicKey } from "@solana/web3.js";

const PARTICIPANT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const MAX_U64 = 18_446_744_073_709_551_615n;
const TARGET_FIELDS = Object.freeze([
  "initialLamports",
  "minimumDrainLamports",
  "vault",
]);
const PER_PARTICIPANT_MODE = "per-participant";
const REHEARSAL_MODE = "single-target-rehearsal";

function configuredMode(env) {
  const mode = String(env.IMPRINT_TARGET_MODE || "").trim();
  if (!mode) return null;
  if (![PER_PARTICIPANT_MODE, REHEARSAL_MODE].includes(mode)) {
    throw new Error(
      `IMPRINT_TARGET_MODE must be ${PER_PARTICIPANT_MODE} or ${REHEARSAL_MODE}`
    );
  }
  return mode;
}

function lamports(value, name) {
  if (typeof value !== "string" || !/^[1-9][0-9]*$/.test(value)) {
    throw new Error(`${name} must be a positive decimal lamport amount`);
  }
  const amount = BigInt(value);
  if (amount > MAX_U64) {
    throw new Error(`${name} exceeds the Solana u64 lamport range`);
  }
  return amount;
}

function publicKey(value, name) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${name} is required`);
  }
  try {
    return new PublicKey(value.trim());
  } catch {
    throw new Error(`${name} must be a Solana public key`);
  }
}

function targetRecord(record, label) {
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    throw new Error(`${label} must be an object`);
  }
  const fields = Object.keys(record).sort();
  if (
    fields.length !== TARGET_FIELDS.length ||
    fields.some((field, index) => field !== TARGET_FIELDS[index])
  ) {
    throw new Error(
      `${label} must contain exactly vault, initialLamports, and minimumDrainLamports`
    );
  }
  const vault = publicKey(record.vault, `${label}.vault`);
  const initialLamports = lamports(
    record.initialLamports,
    `${label}.initialLamports`
  );
  const minimumDrainLamports = lamports(
    record.minimumDrainLamports,
    `${label}.minimumDrainLamports`
  );
  if (minimumDrainLamports > initialLamports) {
    throw new Error(
      `${label}.minimumDrainLamports cannot exceed its initial balance`
    );
  }
  return Object.freeze({ vault, initialLamports, minimumDrainLamports });
}

function configuredParticipantTargets(env) {
  const mode = configuredMode(env);
  const raw = String(env.IMPRINT_PARTICIPANT_TARGETS_JSON || "").trim();
  if (mode === REHEARSAL_MODE) {
    if (raw) {
      throw new Error(
        "IMPRINT_PARTICIPANT_TARGETS_JSON is not allowed in single-target rehearsal mode"
      );
    }
    return null;
  }
  if (!raw) {
    if (env.NODE_ENV === "production" || mode === PER_PARTICIPANT_MODE) {
      throw new Error(
        "IMPRINT_PARTICIPANT_TARGETS_JSON is required for production per-participant targets"
      );
    }
    return null;
  }
  if (
    (env.NODE_ENV === "production" || mode === PER_PARTICIPANT_MODE) &&
    [
      env.IMPRINT_TARGET_VAULT,
      env.IMPRINT_INITIAL_TARGET_LAMPORTS,
      env.IMPRINT_MINIMUM_DRAIN_LAMPORTS,
      env.NEXT_PUBLIC_TARGET_VAULT,
    ].some((value) => String(value || "").trim())
  ) {
    throw new Error(
      "legacy single-target variables are not allowed with the production target map"
    );
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("IMPRINT_PARTICIPANT_TARGETS_JSON must be valid JSON");
  }
  if (
    !parsed ||
    typeof parsed !== "object" ||
    Array.isArray(parsed) ||
    Object.keys(parsed).length === 0
  ) {
    throw new Error(
      "IMPRINT_PARTICIPANT_TARGETS_JSON must contain at least one participant target"
    );
  }

  const targets = Object.create(null);
  const vaults = new Set();
  for (const [participantId, record] of Object.entries(parsed)) {
    if (!PARTICIPANT_ID_PATTERN.test(participantId)) {
      throw new Error(
        `IMPRINT_PARTICIPANT_TARGETS_JSON has invalid participant ID ${participantId}`
      );
    }
    const target = targetRecord(record, `target for ${participantId}`);
    const vault = target.vault.toString();
    if (vaults.has(vault)) {
      throw new Error(
        `IMPRINT_PARTICIPANT_TARGETS_JSON assigns vault ${vault} more than once`
      );
    }
    vaults.add(vault);
    targets[participantId] = target;
  }
  return Object.freeze(targets);
}

function rehearsalTarget(env) {
  return targetRecord(
    {
      vault: env.IMPRINT_TARGET_VAULT,
      initialLamports: env.IMPRINT_INITIAL_TARGET_LAMPORTS,
      minimumDrainLamports: env.IMPRINT_MINIMUM_DRAIN_LAMPORTS,
    },
    "single rehearsal target"
  );
}

function normalizedParticipantId(participantId) {
  const value = String(participantId || "").trim();
  if (!PARTICIPANT_ID_PATTERN.test(value)) throw new Error("invalid IMPRINT participant ID");
  return value;
}

export function eventTargetForParticipant(participantId, env = process.env) {
  const value = normalizedParticipantId(participantId);
  const targets = configuredParticipantTargets(env);
  if (!targets) return rehearsalTarget(env);
  if (!Object.hasOwn(targets, value)) {
    throw new Error("no IMPRINT target is assigned to this participant");
  }
  return targets[value];
}

export function publicEventTargetForParticipant(participantId, env = process.env) {
  const target = eventTargetForParticipant(participantId, env);
  return Object.freeze({ vault: target.vault.toString() });
}

export function validateTargetConfiguration(
  env = process.env,
  expectedParticipantIds = []
) {
  const targets = configuredParticipantTargets(env);
  if (!targets) {
    rehearsalTarget(env);
    return Object.freeze({ mode: REHEARSAL_MODE, participantCount: 1 });
  }

  const configured = Object.keys(targets).sort();
  const expected = [...new Set(expectedParticipantIds.map(normalizedParticipantId))].sort();
  if (expected.length) {
    const missing = expected.filter(
      (participantId) => !Object.hasOwn(targets, participantId)
    );
    const extra = configured.filter((participantId) => !expected.includes(participantId));
    if (missing.length || extra.length) {
      throw new Error(
        `IMPRINT target map does not match the credential roster (missing: ${
          missing.join(", ") || "none"
        }; extra: ${extra.join(", ") || "none"})`
      );
    }
  }
  return Object.freeze({ mode: PER_PARTICIPANT_MODE, participantCount: configured.length });
}

export const eventTargetForTeam = eventTargetForParticipant;
export const publicEventTargetForTeam = publicEventTargetForParticipant;
