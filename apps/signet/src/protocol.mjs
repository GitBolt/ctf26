import crypto from "node:crypto";

export const OFFICIAL_STRATEGY_PROGRAM = "Strategy1111111111111111111111111111111111";
export const LIVE_COMMIT = "8d17c2e-pre-refactor";
export const FIX_COMMIT = "b41a9aa-strategy-refactor";

export function deriveVaultAuthority(vaultId) {
  return crypto
    .createHash("sha256")
    .update("vault-authority")
    .update(vaultId)
    .digest("hex")
    .slice(0, 44);
}

export function createLiveTarget(participantId = "participant-local") {
  const vaultId = `vault-${crypto.createHash("sha256").update(participantId).digest("hex").slice(0, 8)}`;
  return {
    participantId,
    commit: LIVE_COMMIT,
    buildFingerprint: buildFingerprint(LIVE_COMMIT),
    vaultId,
    vaultAuthority: deriveVaultAuthority(vaultId),
    pinnedStrategyProgram: OFFICIAL_STRATEGY_PROGRAM,
    vaultReserve: 100_000,
    participantEscrow: 0,
    threshold: 75_000,
  };
}

export function createLatestFixedTarget(participantId = "participant-local") {
  return {
    ...createLiveTarget(participantId),
    commit: "c6f210e-latest",
    buildFingerprint: buildFingerprint("c6f210e-latest"),
  };
}

export function publicTarget(target) {
  return {
    participantId: target.participantId,
    buildFingerprint: target.buildFingerprint,
    vaultId: target.vaultId,
    vaultAuthority: target.vaultAuthority,
    pinnedStrategyProgram: target.pinnedStrategyProgram,
    vaultReserve: target.vaultReserve,
    participantEscrow: target.participantEscrow,
    threshold: target.threshold,
    note: "The build fingerprint identifies the deployed artifact. Verify behavior against the public source repository.",
  };
}

export function executeStrategy(target, exploit) {
  const requestedProgram = exploit.strategyProgramId;
  const amount = Number(exploit.amount);
  if (typeof requestedProgram !== "string" || requestedProgram.length < 16) {
    throw new Error("bad strategy program");
  }
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error("bad amount");

  if (target.commit !== LIVE_COMMIT) {
    if (requestedProgram !== target.pinnedStrategyProgram) {
      throw new Error("strategy program is not pinned strategy");
    }
  }

  // The vulnerable vault itself invokes the selected strategy and forwards its
  // trusted vault-authority PDA as a signer. A malicious implementation can
  // reuse that privilege in an SPL-token CPI; the player cannot manufacture
  // the signer outside this call path.
  if (amount > target.vaultReserve) throw new Error("insufficient vault reserve");
  target.vaultReserve -= amount;
  target.participantEscrow += amount;
  return {
    vaultReserve: target.vaultReserve,
    participantEscrow: target.participantEscrow,
    solved: target.participantEscrow >= target.threshold,
  };
}

export function buildExploit({ target, attackerProgramId, amount = target.threshold }) {
  return {
    strategyProgramId: attackerProgramId,
    amount,
  };
}

export function checkSubmission({ participantId = "participant-local", exploit }) {
  const target = createLiveTarget(participantId);
  const result = executeStrategy(target, exploit);
  if (!result.solved) throw new Error("target not drained past threshold");
  return {
    ok: true,
    flag: hmacFlag(participantId, target.vaultId, result.participantEscrow),
    result,
  };
}

function hmacFlag(participantId, vaultId, amount) {
  const configured = process.env.FLAG_SECRET;
  if (process.env.NODE_ENV === "production" && (!configured || configured.length < 32)) {
    throw new Error("FLAG_SECRET must contain at least 32 characters in production");
  }
  const secret = configured || "signet-local-development-secret";
  const mac = crypto.createHmac("sha256", secret).update(`${participantId}:${vaultId}:${amount}`).digest("hex").slice(0, 24);
  return `CTF26{signet_${mac}}`;
}

function buildFingerprint(commit) {
  return crypto.createHash("sha256").update(`quarry-vault:${commit}`).digest("hex").slice(0, 16);
}
