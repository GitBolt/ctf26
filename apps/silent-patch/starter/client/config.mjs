import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import dotenv from "dotenv";
import { Keypair, PublicKey } from "@solana/web3.js";

dotenv.config();

export function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required in .env`);
  return value;
}

export function address(name) {
  return new PublicKey(required(name));
}

export function walletKeypair() {
  const configured = required("ANCHOR_WALLET");
  const filename = configured.startsWith("~/") ? path.join(os.homedir(), configured.slice(2)) : configured;
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(filename, "utf8"))));
}
