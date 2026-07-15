import { deterministicAddress, isBase58Address } from "./encoding.mjs";
import { redisCommand } from "./redis.mjs";

export const VULNERABLE_PROGRAM_ID = "9xN3K7QfVtkUhFUgVawMuNvWPePvfrmnDmBGDxpo3grD";
const REQUIRED_ADDRESS_FIELDS = [
  "programId",
  "vaultAccount",
  "vaultAuthority",
  "reserveAccount",
  "escrowAccount",
  "mint",
  "teamWallet",
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

export function validateTarget(target, expectedTeamId) {
  if (!target || typeof target !== "object" || Array.isArray(target)) {
    throw new TargetConfigurationError(`target for ${expectedTeamId} is invalid`);
  }
  for (const field of REQUIRED_ADDRESS_FIELDS) {
    if (!isBase58Address(target[field])) {
      throw new TargetConfigurationError(`${field} for ${expectedTeamId} is not a Solana address`);
    }
  }
  if (typeof target.instanceId !== "string" || !/^[A-Za-z0-9_-]{3,128}$/.test(target.instanceId)) {
    throw new TargetConfigurationError(`instanceId for ${expectedTeamId} is invalid`);
  }
  if (typeof target.buildFingerprint !== "string" || !/^[a-f0-9]{16,64}$/.test(target.buildFingerprint)) {
    throw new TargetConfigurationError(`buildFingerprint for ${expectedTeamId} is invalid`);
  }
  const decimals = Number(target.decimals);
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 18) {
    throw new TargetConfigurationError(`decimals for ${expectedTeamId} is invalid`);
  }
  positiveRaw(target.thresholdRaw, "thresholdRaw");
  positiveRaw(target.initialReserveRaw, "initialReserveRaw");
  positiveRaw(target.initialEscrowRaw ?? "0", "initialEscrowRaw", { allowZero: true });
  if (BigInt(target.thresholdRaw) > BigInt(target.initialReserveRaw)) {
    throw new TargetConfigurationError(`threshold for ${expectedTeamId} exceeds its reserve`);
  }
  return Object.freeze({
    ...target,
    teamId: expectedTeamId,
    decimals,
    initialEscrowRaw: target.initialEscrowRaw ?? "0",
    cluster: target.cluster || "custom",
    tokenSymbol: target.tokenSymbol || "QRY",
  });
}

export function localPreviewTarget(teamId = "team-local") {
  return validateTarget(
    {
      instanceId: `signet-${teamId}`,
      programId: VULNERABLE_PROGRAM_ID,
      vaultAccount: deterministicAddress("signet", teamId, "vault"),
      vaultAuthority: deterministicAddress("signet", teamId, "vault-authority"),
      reserveAccount: deterministicAddress("signet", teamId, "reserve"),
      escrowAccount: deterministicAddress("signet", teamId, "escrow"),
      mint: deterministicAddress("signet", teamId, "mint"),
      teamWallet: deterministicAddress("signet", teamId, "wallet"),
      buildFingerprint: "a47a867fea8ec39e",
      thresholdRaw: "750000",
      initialReserveRaw: "1000000",
      initialEscrowRaw: "0",
      decimals: 0,
      cluster: "localnet-preview",
      tokenSymbol: "QRY",
    },
    teamId,
  );
}

export function targetForTeam(teamId, { env = process.env } = {}) {
  if (env.NODE_ENV !== "production" && !env.SIGNET_TARGETS_JSON) return localPreviewTarget(teamId);
  if (!env.SIGNET_TARGETS_JSON) throw new TargetConfigurationError("SIGNET_TARGETS_JSON is required");
  let targets;
  try {
    targets = JSON.parse(env.SIGNET_TARGETS_JSON);
  } catch {
    throw new TargetConfigurationError("SIGNET_TARGETS_JSON is not valid JSON");
  }
  if (!Object.hasOwn(targets, teamId)) throw new TargetConfigurationError("No target is assigned to this team");
  const target = validateTarget(targets[teamId], teamId);
  if (target.cluster === "localnet-preview") {
    throw new TargetConfigurationError("Preview targets cannot be used in production");
  }
  return target;
}

export async function loadTargetForTeam(
  teamId,
  { env = process.env, fetchImpl = fetch } = {},
) {
  if (env.NODE_ENV !== "production" || env.SIGNET_TARGETS_JSON) {
    return targetForTeam(teamId, { env });
  }
  const stored = await redisCommand(["GET", `ctf26:signet:target:${teamId}`], { env, fetchImpl });
  if (typeof stored !== "string") {
    throw new TargetConfigurationError("No target is assigned to this team");
  }
  let target;
  try {
    target = JSON.parse(stored);
  } catch {
    throw new TargetConfigurationError("Stored target manifest is invalid");
  }
  const validated = validateTarget(target, teamId);
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
    teamWallet: target.teamWallet,
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
