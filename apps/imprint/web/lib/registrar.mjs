import fs from "node:fs";
import { Keypair, PublicKey } from "@solana/web3.js";
import idl from "@/lib/imprint-idl.json";

export const PROGRAM_ID = new PublicKey(process.env.NEXT_PUBLIC_PROGRAM_ID || idl.address);
export const REGISTRAR_ID = new PublicKey("AdtCf3S1zEHZ14js7G7vqN5EDatSGC9SxSTDotJBEvJF");

export function loadRegistrar(env = process.env) {
  const raw =
    env.REGISTRAR_KEYPAIR_JSON ||
    (env.REGISTRAR_KEYPAIR_PATH
      ? fs.readFileSync(env.REGISTRAR_KEYPAIR_PATH, "utf8")
      : "");
  if (!raw) {
    throw new Error("REGISTRAR_KEYPAIR_JSON or REGISTRAR_KEYPAIR_PATH is required");
  }
  const registrar = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(raw)));
  if (!registrar.publicKey.equals(REGISTRAR_ID)) {
    throw new Error(`registrar key mismatch: expected ${REGISTRAR_ID.toString()}`);
  }
  return registrar;
}
