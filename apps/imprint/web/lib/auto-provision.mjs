import crypto from "node:crypto";
import { createRequire } from "node:module";
import * as anchor from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { eventGeneration } from "@ctf26/leaderboard";

import { imprintStateStore } from "./state-store.mjs";

const require = createRequire(import.meta.url);
const idl = require("./imprint-idl.json");
const VICTIM_PASSKEY = Buffer.from([
  2, 98, 54, 222, 160, 85, 143, 166, 44, 15, 155, 56, 178, 7, 216, 12, 251, 16,
  35, 101, 217, 240, 229, 122, 70, 175, 184, 77, 57, 69, 88, 70, 3,
]);
const PROGRAM_ID = new PublicKey(idl.address);
const PARTICIPANT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

function required(env, name, minimumBytes = 1) {
  const value = String(env[name] || "");
  if (Buffer.byteLength(value) < minimumBytes) {
    throw new Error(`${name} is missing or weak`);
  }
  return value;
}

function positiveInteger(env, name, fallback) {
  const encoded = String(env[name] ?? fallback).trim();
  if (!/^[1-9][0-9]*$/.test(encoded)) {
    throw new Error(`${name} must be a positive integer`);
  }
  const value = Number(encoded);
  if (!Number.isSafeInteger(value)) throw new Error(`${name} is too large`);
  return value;
}

function normalizedParticipantId(value) {
  const id = String(value || "").trim();
  if (!PARTICIPANT_ID_PATTERN.test(id)) {
    throw new Error("invalid IMPRINT participant ID");
  }
  return id;
}

function participantTargetRevision(participantId, env) {
  const encoded = String(
    env.IMPRINT_PARTICIPANT_TARGET_REVISIONS_JSON || ""
  ).trim();
  if (!encoded) return 0;
  let revisions;
  try {
    revisions = JSON.parse(encoded);
  } catch {
    throw new Error("IMPRINT_PARTICIPANT_TARGET_REVISIONS_JSON is invalid");
  }
  if (!revisions || Array.isArray(revisions) || typeof revisions !== "object") {
    throw new Error("IMPRINT_PARTICIPANT_TARGET_REVISIONS_JSON is invalid");
  }
  const revision = revisions[participantId] ?? 0;
  if (
    !Number.isSafeInteger(revision) ||
    revision < 0 ||
    revision > 1_000_000
  ) {
    throw new Error(
      "IMPRINT participant target revision must be a non-negative integer"
    );
  }
  return revision;
}

export function loadImprintOperator(env = process.env) {
  let bytes;
  try {
    bytes = JSON.parse(required(env, "IMPRINT_OPERATOR_KEYPAIR_JSON", 64));
  } catch {
    throw new Error("IMPRINT_OPERATOR_KEYPAIR_JSON is invalid");
  }
  if (!Array.isArray(bytes) || bytes.length !== 64) {
    throw new Error("IMPRINT_OPERATOR_KEYPAIR_JSON is invalid");
  }
  return Keypair.fromSecretKey(Uint8Array.from(bytes));
}

export function participantTarget(participantId, env = process.env) {
  const id = normalizedParticipantId(participantId);
  const operator = loadImprintOperator(env);
  const revision = participantTargetRevision(id, env);
  const derivation = `ctf26:imprint:vault:${eventGeneration(env)}:${id}${
    revision > 0 ? `:revision:${revision}` : ""
  }`;
  const vaultId = crypto
    .createHmac("sha256", required(env, "IMPRINT_INSTANCE_SECRET", 32))
    .update(derivation)
    .digest()
    .subarray(0, 16);
  const [vault] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), operator.publicKey.toBuffer(), vaultId],
    PROGRAM_ID
  );
  const initialLamports = positiveInteger(
    env,
    "IMPRINT_TARGET_INITIAL_LAMPORTS",
    10_000_000
  );
  const minimumDrainLamports = positiveInteger(
    env,
    "IMPRINT_TARGET_MINIMUM_DRAIN_LAMPORTS",
    5_000_000
  );
  if (minimumDrainLamports > initialLamports) {
    throw new Error(
      "IMPRINT_TARGET_MINIMUM_DRAIN_LAMPORTS cannot exceed the initial deposit"
    );
  }
  return Object.freeze({
    participantId: id,
    revision,
    operator,
    vaultId,
    vault,
    initialLamports,
    minimumDrainLamports,
  });
}

function rpcUrl(env) {
  return required(env, "SOLANA_RPC_URL");
}

async function provisionParticipantTarget(participantId, env) {
  const target = participantTarget(participantId, env);
  const connection = new Connection(rpcUrl(env), "confirmed");
  const existing = await connection.getAccountInfo(target.vault, "confirmed");
  if (existing) {
    if (!existing.owner.equals(PROGRAM_ID)) {
      throw new Error("derived IMPRINT target belongs to another program");
    }
    return target;
  }

  const provider = new anchor.AnchorProvider(
    connection,
    {
      publicKey: target.operator.publicKey,
      signTransaction: async (transaction) => {
        transaction.partialSign(target.operator);
        return transaction;
      },
      signAllTransactions: async (transactions) => {
        transactions.forEach((transaction) =>
          transaction.partialSign(target.operator)
        );
        return transactions;
      },
    },
    { commitment: "confirmed", preflightCommitment: "confirmed" }
  );
  const program = new anchor.Program(idl, provider);
  await program.methods
    .initializeVault(
      Array.from(target.vaultId),
      Array.from(VICTIM_PASSKEY),
      new anchor.BN(target.initialLamports)
    )
    .accounts({
      authority: target.operator.publicKey,
      vault: target.vault,
    })
    .rpc();
  return target;
}

export async function ensureParticipantTarget(
  participantId,
  { env = process.env, store } = {}
) {
  const target = participantTarget(participantId, env);
  const connection = new Connection(rpcUrl(env), "confirmed");
  const existing = await connection.getAccountInfo(target.vault, "confirmed");
  if (existing) {
    if (!existing.owner.equals(PROGRAM_ID)) {
      throw new Error("derived IMPRINT target belongs to another program");
    }
    return target;
  }
  const state = store || (await imprintStateStore(env));
  try {
    return await state.withLease("target", participantId, async () => {
      const current = await connection.getAccountInfo(
        target.vault,
        "confirmed"
      );
      if (current) return target;
      return provisionParticipantTarget(participantId, env);
    });
  } catch (error) {
    if (!/already in progress/.test(error?.message || "")) throw error;
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 400));
      const current = await connection.getAccountInfo(
        target.vault,
        "confirmed"
      );
      if (current) return target;
    }
    throw new Error("IMPRINT provisioning is still in progress");
  }
}

export async function imprintProvisioningHealth(env = process.env) {
  const operator = loadImprintOperator(env);
  participantTarget("health-check", env);
  const connection = new Connection(rpcUrl(env), "confirmed");
  const balance = await connection.getBalance(operator.publicKey, "confirmed");
  const initialLamports = positiveInteger(
    env,
    "IMPRINT_TARGET_INITIAL_LAMPORTS",
    10_000_000
  );
  const minimumBalance = positiveInteger(
    env,
    "IMPRINT_MIN_OPERATOR_LAMPORTS",
    100_000_000
  );
  return Object.freeze({
    ready: balance >= minimumBalance + initialLamports,
    payer: operator.publicKey.toString(),
    balance,
    minimumBalance,
    initialLamports,
  });
}
