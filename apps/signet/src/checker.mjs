import crypto from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { isTransactionSignature } from "./encoding.mjs";

export class SubmissionError extends Error {
  constructor(code, message, statusCode = 400) {
    super(message);
    this.name = "SubmissionError";
    this.publicCode = code;
    this.statusCode = statusCode;
  }
}

export class RpcError extends Error {
  constructor(message = "The live Solana target is temporarily unavailable.") {
    super(message);
    this.name = "RpcError";
    this.publicCode = "rpc_unavailable";
    this.statusCode = 503;
  }
}

function requireRpcUrl(env) {
  const value = env.SOLANA_RPC_URL;
  if (!value || !/^https?:\/\//.test(value)) throw new RpcError();
  return value;
}

async function rpc(method, params, { env = process.env, fetchImpl = fetch } = {}) {
  let response;
  try {
    response = await fetchImpl(requireRpcUrl(env), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new RpcError();
  }
  if (!response.ok) throw new RpcError();
  let body;
  try {
    body = await response.json();
  } catch {
    throw new RpcError();
  }
  if (body.error) throw new RpcError();
  return body.result;
}

export async function checkRpcHealth(options = {}) {
  const result = await rpc("getHealth", [], options);
  if (result !== "ok") throw new RpcError();
  return true;
}

function tokenAccountFromRpc(value, address) {
  const info = value?.data?.parsed?.info;
  const amount = info?.tokenAmount?.amount;
  if (
    value?.data?.program !== "spl-token" ||
    typeof info?.mint !== "string" ||
    typeof info?.owner !== "string" ||
    typeof amount !== "string" ||
    !/^[0-9]+$/.test(amount)
  ) {
    throw new RpcError(`Token account ${address} could not be verified.`);
  }
  return { address, mint: info.mint, owner: info.owner, amountRaw: amount };
}

export async function readTargetState(target, options = {}) {
  if (target.cluster === "localnet-preview") {
    return {
      status: "ready",
      reserveRaw: target.initialReserveRaw,
      escrowRaw: target.initialEscrowRaw,
      slot: null,
    };
  }
  const result = await rpc(
    "getMultipleAccounts",
    [[target.reserveAccount, target.escrowAccount], { commitment: "finalized", encoding: "jsonParsed" }],
    options,
  );
  if (!result?.value || result.value.length !== 2 || !result.value[0] || !result.value[1]) {
    throw new RpcError();
  }
  const reserve = tokenAccountFromRpc(result.value[0], target.reserveAccount);
  const escrow = tokenAccountFromRpc(result.value[1], target.escrowAccount);
  if (
    reserve.mint !== target.mint ||
    escrow.mint !== target.mint ||
    reserve.owner !== target.vaultAuthority ||
    escrow.owner !== target.participantWallet
  ) {
    throw new RpcError("The assigned target accounts no longer match the instance manifest.");
  }
  return { status: "ready", reserveRaw: reserve.amountRaw, escrowRaw: escrow.amountRaw, slot: result.context?.slot ?? null };
}

function normalizedAccountKeys(transaction) {
  const keys = transaction?.transaction?.message?.accountKeys;
  if (!Array.isArray(keys)) return [];
  return keys.map((entry) => {
    if (typeof entry === "string") return { pubkey: entry, signer: false, writable: false };
    return {
      pubkey: String(entry?.pubkey || ""),
      signer: entry?.signer === true,
      writable: entry?.writable === true,
    };
  });
}

function tokenBalance(meta, side, index, expectedMint) {
  const balances = side === "pre" ? meta?.preTokenBalances : meta?.postTokenBalances;
  const match = balances?.find((entry) => entry.accountIndex === index);
  const amount = match?.uiTokenAmount?.amount;
  if (!match || match.mint !== expectedMint || typeof amount !== "string" || !/^[0-9]+$/.test(amount)) {
    throw new SubmissionError("unverifiable_balance", "The transaction does not expose the required token balance transition.");
  }
  return { amount: BigInt(amount), owner: match.owner };
}

function requireFlagSecret(env) {
  const secret = env.FLAG_SECRET;
  if (env.NODE_ENV !== "production" && !secret) return "signet-local-preview-flag-secret";
  if (!secret || Buffer.byteLength(secret) < 32) {
    throw new Error("FLAG_SECRET must contain at least 32 bytes");
  }
  return secret;
}

export function flagForSolve({ participantId, target, signature, escrowPostRaw }, env = process.env) {
  const mac = crypto
    .createHmac("sha256", requireFlagSecret(env))
    .update(`${participantId}:${target.instanceId}:${signature}:${escrowPostRaw}`)
    .digest("hex")
    .slice(0, 24);
  return `CTF26{signet_${mac}}`;
}

export async function checkOnchainSubmission(
  { participantId, target, signature },
  { env = process.env, fetchImpl = fetch, waitImpl = delay } = {},
) {
  if (!isTransactionSignature(signature)) {
    throw new SubmissionError("invalid_signature", "Enter a complete base58 Solana transaction signature.");
  }
  let transaction = null;
  const indexingRetryDelays = [500, 1_000];
  for (let attempt = 0; attempt <= indexingRetryDelays.length; attempt += 1) {
    transaction = await rpc(
      "getTransaction",
      [signature, { commitment: "finalized", encoding: "jsonParsed", maxSupportedTransactionVersion: 0 }],
      { env, fetchImpl },
    );
    if (transaction) break;
    if (attempt < indexingRetryDelays.length) await waitImpl(indexingRetryDelays[attempt]);
  }
  if (!transaction) {
    throw new SubmissionError("transaction_not_found", "That finalized transaction was not found.", 404);
  }
  if (transaction.meta?.err) {
    throw new SubmissionError("transaction_failed", "The submitted transaction did not complete successfully.");
  }
  let blockTime = transaction.blockTime;
  if (!Number.isSafeInteger(blockTime)) {
    blockTime = await rpc("getBlockTime", [transaction.slot], { env, fetchImpl });
  }
  if (!Number.isSafeInteger(blockTime)) {
    throw new RpcError("The finalized transaction time could not be verified.");
  }

  const keys = normalizedAccountKeys(transaction);
  const indexFor = (address) => keys.findIndex((entry) => entry.pubkey === address);
  const reserveIndex = indexFor(target.reserveAccount);
  const escrowIndex = indexFor(target.escrowAccount);
  const programIndex = indexFor(target.programId);
  const participantWalletIndex = indexFor(target.participantWallet);
  if (reserveIndex < 0 || escrowIndex < 0 || programIndex < 0 || participantWalletIndex < 0) {
    throw new SubmissionError("wrong_target", "The transaction does not operate on every assigned target account.");
  }
  if (!keys[reserveIndex].writable || !keys[escrowIndex].writable || !keys[participantWalletIndex].signer) {
    throw new SubmissionError("wrong_authority", "The assigned participant wallet and writable token accounts were not used correctly.");
  }

  const invokeLine = `Program ${target.programId} invoke [`;
  if (!transaction.meta?.logMessages?.some((line) => line.startsWith(invokeLine))) {
    throw new SubmissionError("program_not_invoked", "The assigned vault program was not invoked by this transaction.");
  }

  const reservePre = tokenBalance(transaction.meta, "pre", reserveIndex, target.mint);
  const reservePost = tokenBalance(transaction.meta, "post", reserveIndex, target.mint);
  const escrowPre = tokenBalance(transaction.meta, "pre", escrowIndex, target.mint);
  const escrowPost = tokenBalance(transaction.meta, "post", escrowIndex, target.mint);
  if (reservePre.owner !== target.vaultAuthority || reservePost.owner !== target.vaultAuthority) {
    throw new SubmissionError("wrong_reserve", "The reserve authority does not match this instance.");
  }
  if (escrowPre.owner !== target.participantWallet || escrowPost.owner !== target.participantWallet) {
    throw new SubmissionError("wrong_escrow", "The destination is not the registered participant escrow.");
  }

  const reserveDelta = reservePre.amount - reservePost.amount;
  const escrowDelta = escrowPost.amount - escrowPre.amount;
  const threshold = BigInt(target.thresholdRaw);
  const maximumFinalReserve = BigInt(target.initialReserveRaw) - threshold;
  const minimumFinalEscrow = BigInt(target.initialEscrowRaw) + threshold;
  if (
    reserveDelta < threshold ||
    escrowDelta !== reserveDelta ||
    reservePost.amount > maximumFinalReserve ||
    escrowPost.amount < minimumFinalEscrow
  ) {
    throw new SubmissionError(
      "threshold_not_met",
      "The assigned reserve has not moved far enough into the registered participant escrow.",
    );
  }

  return {
    ok: true,
    signature,
    slot: transaction.slot,
    occurredAt: new Date(blockTime * 1_000).toISOString(),
    reserveDeltaRaw: reserveDelta.toString(),
    reservePostRaw: reservePost.amount.toString(),
    escrowPostRaw: escrowPost.amount.toString(),
    flag: flagForSolve({ participantId, target, signature, escrowPostRaw: escrowPost.amount.toString() }, env),
  };
}

export function checkPreviewSubmission({ participantId, target, signature }, env = process.env) {
  if (env.NODE_ENV === "production" || target.cluster !== "localnet-preview") {
    throw new SubmissionError("preview_disabled", "Preview submissions are disabled.");
  }
  if (signature !== "demo-drain") {
    throw new SubmissionError("preview_signature", "Use demo-drain to exercise the local interface preview.");
  }
  return {
    ok: true,
    signature,
    slot: null,
    reserveDeltaRaw: target.thresholdRaw,
    reservePostRaw: (BigInt(target.initialReserveRaw) - BigInt(target.thresholdRaw)).toString(),
    escrowPostRaw: (BigInt(target.initialEscrowRaw) + BigInt(target.thresholdRaw)).toString(),
    flag: flagForSolve(
      {
        participantId,
        target,
        signature,
        escrowPostRaw: (BigInt(target.initialEscrowRaw) + BigInt(target.thresholdRaw)).toString(),
      },
      env,
    ),
  };
}
