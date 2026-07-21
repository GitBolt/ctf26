import crypto from "node:crypto";

import { eventGeneration } from "@ctf26/leaderboard";
import { deterministicAddress, isBase58Address } from "./encoding.mjs";
import { redisCommand, signetRedisKey } from "./redis.mjs";

export const VULNERABLE_PROGRAM_ID = "9xN3K7QfVtkUhFUgVawMuNvWPePvfrmnDmBGDxpo3grD";
export const TARGET_INVENTORY_SCHEMA = "signet-target-inventory-v1";
const PARTICIPANT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const REQUIRED_ADDRESS_FIELDS = [
  "programId",
  "vaultAccount",
  "vaultAuthority",
  "reserveAccount",
  "escrowAccount",
  "mint",
  "participantWallet",
];

export class TargetConfigurationError extends Error {
  constructor(message) {
    super(message);
    this.name = "TargetConfigurationError";
  }
}

function positiveRaw(value, field, { allowZero = false } = {}) {
  if (typeof value !== "string" || !/^[0-9]+$/.test(value)) {
    throw new TargetConfigurationError(`${field} must be an unsigned integer string`);
  }
  const parsed = BigInt(value);
  if (allowZero ? parsed < 0n : parsed <= 0n) {
    throw new TargetConfigurationError(`${field} must be positive`);
  }
  return value;
}

export function validateTarget(target, expectedParticipantId) {
  if (!PARTICIPANT_ID_PATTERN.test(expectedParticipantId)) {
    throw new TargetConfigurationError("target participant id is invalid");
  }
  if (!target || typeof target !== "object" || Array.isArray(target)) {
    throw new TargetConfigurationError(`target for ${expectedParticipantId} is invalid`);
  }
  for (const field of REQUIRED_ADDRESS_FIELDS) {
    if (!isBase58Address(target[field])) {
      throw new TargetConfigurationError(`${field} for ${expectedParticipantId} is not a Solana address`);
    }
  }
  if (typeof target.instanceId !== "string" || !/^[A-Za-z0-9_-]{3,128}$/.test(target.instanceId)) {
    throw new TargetConfigurationError(`instanceId for ${expectedParticipantId} is invalid`);
  }
  if (typeof target.buildFingerprint !== "string" || !/^[a-f0-9]{16,64}$/.test(target.buildFingerprint)) {
    throw new TargetConfigurationError(`buildFingerprint for ${expectedParticipantId} is invalid`);
  }
  const decimals = Number(target.decimals);
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 18) {
    throw new TargetConfigurationError(`decimals for ${expectedParticipantId} is invalid`);
  }
  positiveRaw(target.thresholdRaw, "thresholdRaw");
  positiveRaw(target.initialReserveRaw, "initialReserveRaw");
  positiveRaw(target.initialEscrowRaw ?? "0", "initialEscrowRaw", { allowZero: true });
  if (BigInt(target.thresholdRaw) > BigInt(target.initialReserveRaw)) {
    throw new TargetConfigurationError(`threshold for ${expectedParticipantId} exceeds its reserve`);
  }
  return Object.freeze({
    ...target,
    participantId: expectedParticipantId,
    decimals,
    initialEscrowRaw: target.initialEscrowRaw ?? "0",
    cluster: target.cluster || "custom",
    tokenSymbol: target.tokenSymbol || "QRY",
  });
}

export function validateTargetMap(targets, { allowPreview = true } = {}) {
  if (!targets || typeof targets !== "object" || Array.isArray(targets)) {
    throw new TargetConfigurationError("target manifest must be a non-empty object keyed by participant id");
  }
  const entries = Object.entries(targets).sort(([left], [right]) => left.localeCompare(right));
  if (entries.length === 0) {
    throw new TargetConfigurationError("target manifest must be a non-empty object keyed by participant id");
  }
  if (entries.length > 10_000) {
    throw new TargetConfigurationError("target manifest exceeds the supported participant limit");
  }
  return Object.freeze(entries.map(([participantId, target]) => {
    const validated = validateTarget(target, participantId);
    if (!allowPreview && validated.cluster === "localnet-preview") {
      throw new TargetConfigurationError("Preview targets cannot be published for production");
    }
    return Object.freeze([participantId, validated]);
  }));
}

export function createTargetInventory(participantIds, { env = process.env } = {}) {
  if (!Array.isArray(participantIds) || participantIds.length === 0) {
    throw new TargetConfigurationError("target inventory must contain at least one participant");
  }
  const sorted = [...participantIds].sort();
  if (new Set(sorted).size !== sorted.length || sorted.some((participantId) => !PARTICIPANT_ID_PATTERN.test(participantId))) {
    throw new TargetConfigurationError("target inventory participant ids are invalid");
  }
  return Object.freeze({
    schema: TARGET_INVENTORY_SCHEMA,
    eventGeneration: eventGeneration(env),
    count: sorted.length,
    participantIdsSha256: crypto.createHash("sha256").update(JSON.stringify(sorted)).digest("hex"),
  });
}

export function validateTargetInventory(value, { env = process.env } = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TargetConfigurationError("Stored target inventory manifest is invalid");
  }
  const expectedFields = ["count", "eventGeneration", "participantIdsSha256", "schema"];
  const actualFields = Object.keys(value).sort();
  if (actualFields.length !== expectedFields.length || actualFields.some((field, index) => field !== expectedFields[index])) {
    throw new TargetConfigurationError("Stored target inventory manifest is invalid");
  }
  if (value.schema !== TARGET_INVENTORY_SCHEMA || value.eventGeneration !== eventGeneration(env)) {
    throw new TargetConfigurationError("Stored target inventory belongs to another event generation");
  }
  if (!Number.isSafeInteger(value.count) || value.count < 1 || value.count > 10_000) {
    throw new TargetConfigurationError("Stored target inventory count is invalid");
  }
  if (typeof value.participantIdsSha256 !== "string" || !/^[a-f0-9]{64}$/.test(value.participantIdsSha256)) {
    throw new TargetConfigurationError("Stored target inventory digest is invalid");
  }
  return Object.freeze({
    schema: value.schema,
    eventGeneration: value.eventGeneration,
    count: value.count,
    participantIdsSha256: value.participantIdsSha256,
  });
}

export async function loadTargetInventory({ env = process.env, fetchImpl = fetch } = {}) {
  if (env.SIGNET_TARGETS_JSON) {
    let targets;
    try {
      targets = JSON.parse(env.SIGNET_TARGETS_JSON);
    } catch {
      throw new TargetConfigurationError("SIGNET_TARGETS_JSON is not valid JSON");
    }
    const entries = validateTargetMap(targets, { allowPreview: env.NODE_ENV !== "production" });
    return createTargetInventory(entries.map(([participantId]) => participantId), { env });
  }
  const stored = await redisCommand(["GET", signetRedisKey("target-inventory", undefined, env)], { env, fetchImpl });
  if (typeof stored !== "string") {
    throw new TargetConfigurationError("Target inventory has not been published for this event generation");
  }
  let manifest;
  try {
    manifest = JSON.parse(stored);
  } catch {
    throw new TargetConfigurationError("Stored target inventory manifest is invalid");
  }
  return validateTargetInventory(manifest, { env });
}

export function localPreviewTarget(participantId = "participant-local") {
  return validateTarget(
    {
      instanceId: `signet-${participantId}`,
      programId: VULNERABLE_PROGRAM_ID,
      vaultAccount: deterministicAddress("signet", participantId, "vault"),
      vaultAuthority: deterministicAddress("signet", participantId, "vault-authority"),
      reserveAccount: deterministicAddress("signet", participantId, "reserve"),
      escrowAccount: deterministicAddress("signet", participantId, "escrow"),
      mint: deterministicAddress("signet", participantId, "mint"),
      participantWallet: deterministicAddress("signet", participantId, "wallet"),
      buildFingerprint: "a47a867fea8ec39e",
      thresholdRaw: "750000",
      initialReserveRaw: "1000000",
      initialEscrowRaw: "0",
      decimals: 0,
      cluster: "localnet-preview",
      tokenSymbol: "QRY",
    },
    participantId,
  );
}

export function targetForParticipant(participantId, { env = process.env } = {}) {
  if (env.NODE_ENV !== "production" && !env.SIGNET_TARGETS_JSON) return localPreviewTarget(participantId);
  if (!env.SIGNET_TARGETS_JSON) throw new TargetConfigurationError("SIGNET_TARGETS_JSON is required");
  let targets;
  try {
    targets = JSON.parse(env.SIGNET_TARGETS_JSON);
  } catch {
    throw new TargetConfigurationError("SIGNET_TARGETS_JSON is not valid JSON");
  }
  if (!Object.hasOwn(targets, participantId)) throw new TargetConfigurationError("No target is assigned to this participant");
  const target = validateTarget(targets[participantId], participantId);
  if (target.cluster === "localnet-preview") {
    throw new TargetConfigurationError("Preview targets cannot be used in production");
  }
  return target;
}

export async function loadTargetForParticipant(
  participantId,
  { env = process.env, fetchImpl = fetch } = {},
) {
  if (env.NODE_ENV !== "production" || env.SIGNET_TARGETS_JSON) {
    return targetForParticipant(participantId, { env });
  }
  const stored = await redisCommand(["GET", signetRedisKey("target", participantId, env)], { env, fetchImpl });
  if (typeof stored !== "string") {
    throw new TargetConfigurationError("No target is assigned to this participant");
  }
  let target;
  try {
    target = JSON.parse(stored);
  } catch {
    throw new TargetConfigurationError("Stored target manifest is invalid");
  }
  const validated = validateTarget(target, participantId);
  if (validated.cluster === "localnet-preview") {
    throw new TargetConfigurationError("Preview targets cannot be used in production");
  }
  return validated;
}

export function publicTarget(target, state, env = process.env) {
  return {
    instanceId: target.instanceId,
    programId: target.programId,
    vaultAccount: target.vaultAccount,
    vaultAuthority: target.vaultAuthority,
    reserveAccount: target.reserveAccount,
    escrowAccount: target.escrowAccount,
    mint: target.mint,
    participantWallet: target.participantWallet,
    buildFingerprint: target.buildFingerprint,
    thresholdRaw: target.thresholdRaw,
    initialReserveRaw: target.initialReserveRaw,
    decimals: target.decimals,
    cluster: target.cluster,
    tokenSymbol: target.tokenSymbol,
    explorerCluster: env.SOLANA_EXPLORER_CLUSTER || target.cluster,
    publicRpcUrl: env.PUBLIC_SOLANA_RPC_URL || null,
    state,
    preview: env.NODE_ENV !== "production" && !env.SIGNET_TARGETS_JSON,
  };
}
