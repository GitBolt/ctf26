import crypto from "node:crypto";

function requireSecret(secret) {
  if (typeof secret !== "string" || Buffer.byteLength(secret) < 32) {
    throw new Error("INSTANCE_SECRET must contain at least 32 bytes");
  }
  return secret;
}

export function createInstancePlan(teamId, secret) {
  if (typeof teamId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(teamId)) {
    throw new Error("TEAM_ID is invalid");
  }
  const entropy = crypto.createHmac("sha256", requireSecret(secret)).update(`ctf26:signet:${teamId}`).digest();
  const teamSeed = entropy.subarray(0, 16);
  const reserveRaw = 900_000n + BigInt(entropy.readUInt32LE(16) % 300_001);
  const thresholdBasisPoints = 6_800n + BigInt(entropy.readUInt16LE(20) % 1_201);
  const thresholdRaw = reserveRaw * thresholdBasisPoints / 10_000n;
  const instanceId = `signet-${crypto.createHash("sha256").update(entropy).digest("hex").slice(0, 12)}`;
  return Object.freeze({
    teamId,
    instanceId,
    teamSeed: Buffer.from(teamSeed),
    reserveRaw,
    thresholdRaw,
    thresholdBasisPoints,
  });
}
