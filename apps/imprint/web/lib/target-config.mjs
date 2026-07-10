import { PublicKey } from "@solana/web3.js";

function lamports(value, name) {
  if (typeof value !== "string" || !/^[1-9][0-9]*$/.test(value)) {
    throw new Error(`${name} must be a positive decimal lamport amount`);
  }
  return BigInt(value);
}

export function eventTarget(env = process.env) {
  const value = String(env.IMPRINT_TARGET_VAULT || "").trim();
  if (!value) throw new Error("IMPRINT_TARGET_VAULT is required");
  let vault;
  try {
    vault = new PublicKey(value);
  } catch {
    throw new Error("IMPRINT_TARGET_VAULT must be a Solana public key");
  }
  const publicTarget = String(env.NEXT_PUBLIC_TARGET_VAULT || "").trim();
  if (publicTarget && publicTarget !== vault.toString()) {
    throw new Error("NEXT_PUBLIC_TARGET_VAULT must match IMPRINT_TARGET_VAULT");
  }
  const initialLamports = lamports(env.IMPRINT_INITIAL_TARGET_LAMPORTS, "IMPRINT_INITIAL_TARGET_LAMPORTS");
  const minimumDrainLamports = lamports(
    env.IMPRINT_MINIMUM_DRAIN_LAMPORTS,
    "IMPRINT_MINIMUM_DRAIN_LAMPORTS",
  );
  if (minimumDrainLamports > initialLamports) {
    throw new Error("IMPRINT_MINIMUM_DRAIN_LAMPORTS cannot exceed the initial target balance");
  }
  return Object.freeze({ vault, initialLamports, minimumDrainLamports });
}
