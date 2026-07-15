import { readFile } from "node:fs/promises";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";

export async function loadDisposableKeypair(path) {
  if (!path) throw new Error("pass an explicit disposable keypair path");
  const bytes = JSON.parse(await readFile(path, "utf8"));
  if (!Array.isArray(bytes) || bytes.length !== 64) throw new Error("keypair file must contain a 64-byte JSON array");
  return Keypair.fromSecretKey(Uint8Array.from(bytes));
}

export function orderReferenceInstruction(reference, payer) {
  return SystemProgram.transfer({
    fromPubkey: payer instanceof Keypair ? payer.publicKey : new PublicKey(payer),
    toPubkey: new PublicKey(reference),
    lamports: 0,
  });
}

export async function submitInstructions({ rpcUrl, payer, instructions }) {
  if (!rpcUrl) throw new Error("rpcUrl is required");
  if (!(payer instanceof Keypair)) throw new Error("payer must be a Keypair");
  if (!Array.isArray(instructions) || instructions.length < 2) {
    throw new Error("provide payment instructions plus the order reference instruction");
  }
  const connection = new Connection(rpcUrl, "confirmed");
  const transaction = new Transaction().add(...instructions);
  return sendAndConfirmTransaction(connection, transaction, [payer], {
    commitment: "confirmed",
    preflightCommitment: "confirmed",
  });
}

export { Connection, Keypair, PublicKey, Transaction, TransactionInstruction };
