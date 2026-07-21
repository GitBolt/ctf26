import crypto from "node:crypto";

import {
  Connection, Keypair, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  AccountLayout, MINT_SIZE, TOKEN_PROGRAM_ID, createInitializeAccount3Instruction,
  createInitializeMint2Instruction,
} from "@solana/spl-token";

const DEFAULT_RPC = "https://api.devnet.solana.com";
const TOKEN_ACCOUNT_SIZE = AccountLayout.span;

export function createEvidenceRoomChain(env = process.env) {
  const rpcUrl = env.SOLANA_RPC_URL || DEFAULT_RPC;
  const connection = new Connection(rpcUrl, "confirmed");
  const payer = readKeypair(env.EVIDENCE_ROOM_FACTORY_KEYPAIR, "EVIDENCE_ROOM_FACTORY_KEYPAIR");
  const secret = requiredSecret(env.EVIDENCE_ROOM_CHAIN_SECRET, "EVIDENCE_ROOM_CHAIN_SECRET");
  const minimumFactoryBalance = nonNegativeInteger(
    env.EVIDENCE_ROOM_MIN_FACTORY_LAMPORTS ?? 50_000_000,
    "EVIDENCE_ROOM_MIN_FACTORY_LAMPORTS",
  );
  const expectedParticipants = requiredProductionInteger(env, "EVIDENCE_ROOM_EXPECTED_PARTICIPANTS", 50);
  const maxBatches = requiredProductionInteger(env, "EVIDENCE_ROOM_MAX_BATCHES", 4);
  const capacityBufferBps = nonNegativeInteger(env.EVIDENCE_ROOM_CAPACITY_BUFFER_BPS ?? 1_000, "EVIDENCE_ROOM_CAPACITY_BUFFER_BPS");
  if (capacityBufferBps > 10_000) throw new Error("EVIDENCE_ROOM_CAPACITY_BUFFER_BPS must not exceed 10000");

  return {
    network: env.EVIDENCE_ROOM_NETWORK || "devnet",
    rpcUrl,
    async provision(participantId, nonce) {
      const wallet = derive(secret, "event-wallet", participantId, nonce);
      const authority = derive(secret, "factory-authority", participantId, nonce);
      const mint = derive(secret, "factory-mint", participantId, nonce);
      const [mintRent, walletBalance, mintInfo] = await Promise.all([
        connection.getMinimumBalanceForRentExemption(MINT_SIZE, "confirmed"),
        connection.getBalance(wallet.publicKey, "confirmed"),
        connection.getAccountInfo(mint.publicKey, "confirmed"),
      ]);
      if (mintInfo) {
        assertProvisionedMint(mintInfo, authority.publicKey);
        return { wallet: wallet.publicKey.toBase58(), factoryMint: mint.publicKey.toBase58(), factoryAuthority: authority.publicKey.toBase58(), provisionSignature: null, provisionRecovered: true };
      }
      const transaction = new Transaction();
      if (!walletBalance) transaction.add(SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: wallet.publicKey, lamports: 30_000_000 }));
      transaction.add(
        SystemProgram.createAccount({ fromPubkey: payer.publicKey, newAccountPubkey: mint.publicKey, lamports: mintRent, space: MINT_SIZE, programId: TOKEN_PROGRAM_ID }),
        createInitializeMint2Instruction(mint.publicKey, 0, authority.publicKey, null, TOKEN_PROGRAM_ID),
      );
      let signature;
      try {
        signature = await submit(connection, transaction, [payer, mint]);
      } catch (error) {
        const landed = await connection.getAccountInfo(mint.publicKey, "confirmed");
        if (!landed) throw error;
        assertProvisionedMint(landed, authority.publicKey);
        return { wallet: wallet.publicKey.toBase58(), factoryMint: mint.publicKey.toBase58(), factoryAuthority: authority.publicKey.toBase58(), provisionSignature: null, provisionRecovered: true };
      }
      return { wallet: wallet.publicKey.toBase58(), factoryMint: mint.publicKey.toBase58(), factoryAuthority: authority.publicKey.toBase58(), provisionSignature: signature };
    },
    walletSecret(participantId, nonce) { return [...derive(secret, "event-wallet", participantId, nonce).secretKey]; },
    async allocate(participantId, nonce, sequence) {
      const plan = allocationPlan(secret, participantId, nonce, sequence);
      const { target, initialized, mintDecoy, systemDecoy, factoryMint, authority } = plan;
      const keys = [target.publicKey, initialized.publicKey, mintDecoy.publicKey, systemDecoy.publicKey];
      const existing = await connection.getMultipleAccountsInfo(keys, "confirmed");
      if (existing.every(Boolean)) return reconcileAllocation(connection, plan);
      if (existing.some(Boolean)) throw allocationInterference("case allocation is only partially present on chain");
      const [tokenRent, mintRent, systemRent] = await Promise.all([
        connection.getMinimumBalanceForRentExemption(TOKEN_ACCOUNT_SIZE, "confirmed"),
        connection.getMinimumBalanceForRentExemption(MINT_SIZE, "confirmed"),
        connection.getMinimumBalanceForRentExemption(0, "confirmed"),
      ]);
      const transaction = new Transaction().add(
        SystemProgram.createAccount({ fromPubkey: payer.publicKey, newAccountPubkey: target.publicKey, lamports: tokenRent, space: TOKEN_ACCOUNT_SIZE, programId: TOKEN_PROGRAM_ID }),
        SystemProgram.createAccount({ fromPubkey: payer.publicKey, newAccountPubkey: initialized.publicKey, lamports: tokenRent, space: TOKEN_ACCOUNT_SIZE, programId: TOKEN_PROGRAM_ID }),
        createInitializeAccount3Instruction(initialized.publicKey, factoryMint.publicKey, authority.publicKey, TOKEN_PROGRAM_ID),
        SystemProgram.createAccount({ fromPubkey: payer.publicKey, newAccountPubkey: mintDecoy.publicKey, lamports: mintRent, space: MINT_SIZE, programId: TOKEN_PROGRAM_ID }),
        createInitializeMint2Instruction(mintDecoy.publicKey, 0, authority.publicKey, null, TOKEN_PROGRAM_ID),
        SystemProgram.createAccount({ fromPubkey: payer.publicKey, newAccountPubkey: systemDecoy.publicKey, lamports: systemRent, space: 0, programId: SystemProgram.programId }),
      );
      let signature;
      try {
        signature = await submit(connection, transaction, [payer, target, initialized, mintDecoy, systemDecoy]);
      } catch (error) {
        // A transport timeout can happen after the atomic transaction landed. The
        // deterministic account set lets a restarted worker reconcile safely.
        const after = await connection.getMultipleAccountsInfo(keys, "confirmed");
        if (!after.every(Boolean)) throw error;
        return reconcileAllocation(connection, plan);
      }
      return {
        allocationSignature: signature,
        allocationRecovered: false,
        target: target.publicKey.toBase58(),
        accounts: plan.accounts,
        decoys: [initialized.publicKey, mintDecoy.publicKey, systemDecoy.publicKey].map((key) => key.toBase58()),
      };
    },
    async finalize(participantId, nonce, sequence) {
      const target = derive(secret, `target-${sequence}`, participantId, nonce);
      const factoryMint = derive(secret, "factory-mint", participantId, nonce);
      const authority = derive(secret, "factory-authority", participantId, nonce);
      const transaction = new Transaction().add(createInitializeAccount3Instruction(target.publicKey, factoryMint.publicKey, authority.publicKey, TOKEN_PROGRAM_ID));
      transaction.feePayer = payer.publicKey;
      const lifetime = await connection.getLatestBlockhash("finalized");
      transaction.recentBlockhash = lifetime.blockhash;
      transaction.sign(payer);
      const signature = await connection.sendRawTransaction(transaction.serialize(), { skipPreflight: true, maxRetries: 5, preflightCommitment: "finalized" });
      const confirmation = await connection.confirmTransaction({ signature, ...lifetime }, "finalized");
      if (confirmation.value.err == null) return { ok: true, signature, slot: confirmation.context.slot };
      if (!isExpectedFactoryInitializationFailure(confirmation.value.err)) {
        const error = new Error("factory initialization failed for an unexpected finalized reason");
        error.code = "unexpected_factory_failure";
        error.signature = signature;
        throw error;
      }
      return { ok: false, failure: "already-initialized", signature, slot: confirmation.context.slot };
    },
    async inspect(address) {
      const key = new PublicKey(address);
      const account = await connection.getAccountInfo(key, "confirmed");
      if (!account) return { exists: false, address };
      const result = { exists: true, address, owner: account.owner.toBase58(), lamports: account.lamports, dataLength: account.data.length };
      if (account.owner.equals(TOKEN_PROGRAM_ID) && account.data.length === TOKEN_ACCOUNT_SIZE) {
        result.token = {
          mint: new PublicKey(account.data.subarray(0, 32)).toBase58(),
          authority: new PublicKey(account.data.subarray(32, 64)).toBase58(),
          state: account.data[108],
        };
      }
      return result;
    },
    async activity(address, knownSignatures, participantSigner) {
      const entries = await connection.getSignaturesForAddress(new PublicKey(address), { limit: 20 }, "finalized");
      const relevant = entries.filter((entry) => entry.err == null && !knownSignatures.includes(entry.signature));
      let participantSigned = false;
      const signatures = [];
      for (const entry of relevant) {
        const transaction = await connection.getParsedTransaction(entry.signature, { commitment: "finalized", maxSupportedTransactionVersion: 0 });
        if (!transaction || transaction.meta?.err != null) continue;
        signatures.push(entry.signature);
        if (transactionSigners(transaction).includes(participantSigner)) participantSigned = true;
      }
      return { external: signatures.length > 0, participantSigned, signatures };
    },
    async findClose(address, destination, knownSignatures) {
      const entries = await connection.getSignaturesForAddress(new PublicKey(address), { limit: 20 }, "finalized");
      for (const entry of entries) {
        if (knownSignatures.includes(entry.signature)) continue;
        const tx = await connection.getParsedTransaction(entry.signature, { commitment: "finalized", maxSupportedTransactionVersion: 0 });
        if (!isSuccessfulCloseTransaction(tx, { address, destination })) continue;
        const blockTime = Number.isSafeInteger(tx.blockTime)
          ? tx.blockTime
          : await connection.getBlockTime(entry.slot, "finalized");
        if (!Number.isSafeInteger(blockTime)) throw new Error("close transaction time could not be verified");
        return { signature: entry.signature, slot: entry.slot, blockTime };
      }
      return null;
    },
    async health() {
      const [balance, finalizedSlot, tokenRent, mintRent, systemRent] = await Promise.all([
        connection.getBalance(payer.publicKey, "confirmed"),
        connection.getSlot("finalized"),
        connection.getMinimumBalanceForRentExemption(TOKEN_ACCOUNT_SIZE, "confirmed"),
        connection.getMinimumBalanceForRentExemption(MINT_SIZE, "confirmed"),
        connection.getMinimumBalanceForRentExemption(0, "confirmed"),
      ]);
      const capacity = estimateEvidenceRoomCapacity({
        expectedParticipants,
        maxBatches,
        tokenRent,
        mintRent,
        systemRent,
        capacityBufferBps,
      });
      const requiredBalance = Math.max(minimumFactoryBalance, capacity.requiredBalance);
      return {
        ok: balance >= requiredBalance && Number.isSafeInteger(finalizedSlot),
        network: env.EVIDENCE_ROOM_NETWORK || "devnet",
        payer: payer.publicKey.toBase58(),
        balance,
        minimumFactoryBalance,
        requiredBalance,
        expectedParticipants,
        maxBatches,
        estimatedLamportsPerParticipant: capacity.perParticipant,
        capacityBufferBps,
        finalizedSlot,
      };
    },
  };
}

export function estimateEvidenceRoomCapacity({
  expectedParticipants,
  maxBatches,
  tokenRent,
  mintRent,
  systemRent,
  capacityBufferBps = 1_000,
  walletLamports = 30_000_000,
}) {
  for (const [name, value] of Object.entries({ expectedParticipants, maxBatches, tokenRent, mintRent, systemRent, capacityBufferBps, walletLamports })) {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${name} must be a non-negative safe integer`);
  }
  if (expectedParticipants < 1 || maxBatches < 1) throw new Error("expectedParticipants and maxBatches must be positive");
  if (capacityBufferBps > 10_000) throw new Error("capacityBufferBps must not exceed 10000");
  const perBatch = tokenRent * 2 + mintRent + systemRent;
  const perParticipant = walletLamports + mintRent + maxBatches * perBatch;
  const baseTotal = perParticipant * expectedParticipants;
  const requiredBalance = Math.ceil(baseTotal * (10_000 + capacityBufferBps) / 10_000);
  if (![perBatch, perParticipant, baseTotal, requiredBalance].every(Number.isSafeInteger)) throw new Error("capacity estimate exceeds safe integer range");
  return Object.freeze({ perBatch, perParticipant, baseTotal, requiredBalance });
}

async function reconcileAllocation(connection, plan) {
  const infos = await connection.getMultipleAccountsInfo(
    [plan.target.publicKey, plan.initialized.publicKey, plan.mintDecoy.publicKey, plan.systemDecoy.publicKey],
    "confirmed",
  );
  if (!validAllocationShape(infos, plan)) throw allocationInterference("case allocation does not match its expected account layout");
  const entries = await connection.getSignaturesForAddress(plan.target.publicKey, { limit: 24 }, "confirmed");
  for (const entry of entries) {
    if (entry.err != null) continue;
    const transaction = await connection.getParsedTransaction(entry.signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
    if (isAllocationTransaction(transaction, plan.accounts)) {
      return {
        allocationSignature: entry.signature,
        allocationRecovered: true,
        target: plan.target.publicKey.toBase58(),
        accounts: plan.accounts,
        decoys: [plan.initialized.publicKey, plan.mintDecoy.publicKey, plan.systemDecoy.publicKey].map((key) => key.toBase58()),
      };
    }
  }
  throw allocationInterference("case allocation exists without a verifiable factory transaction");
}

function allocationPlan(secret, participantId, nonce, sequence) {
  const target = derive(secret, `target-${sequence}`, participantId, nonce);
  const initialized = derive(secret, `initialized-${sequence}`, participantId, nonce);
  const mintDecoy = derive(secret, `mint-decoy-${sequence}`, participantId, nonce);
  const systemDecoy = derive(secret, `system-decoy-${sequence}`, participantId, nonce);
  const factoryMint = derive(secret, "factory-mint", participantId, nonce);
  const authority = derive(secret, "factory-authority", participantId, nonce);
  const wallet = derive(secret, "event-wallet", participantId, nonce);
  return {
    target, initialized, mintDecoy, systemDecoy, factoryMint, authority, wallet,
    accounts: shuffledAddresses(secret, participantId, nonce, sequence, [target.publicKey, initialized.publicKey, mintDecoy.publicKey, systemDecoy.publicKey]),
  };
}

function validAllocationShape(infos, plan) {
  if (!Array.isArray(infos) || infos.length !== 4 || infos.some((info) => !info)) return false;
  const [target, initialized, mintDecoy, systemDecoy] = infos;
  if (!target.owner.equals(TOKEN_PROGRAM_ID) || target.data.length !== TOKEN_ACCOUNT_SIZE) return false;
  if (!initialized.owner.equals(TOKEN_PROGRAM_ID) || initialized.data.length !== TOKEN_ACCOUNT_SIZE) return false;
  if (!mintDecoy.owner.equals(TOKEN_PROGRAM_ID) || mintDecoy.data.length !== MINT_SIZE) return false;
  if (!systemDecoy.owner.equals(SystemProgram.programId) || systemDecoy.data.length !== 0) return false;
  const targetState = target.data[108];
  if (targetState !== 0 && targetState !== 1) return false;
  if (targetState === 1 && !tokenAccountMatches(target, plan.factoryMint.publicKey, plan.wallet.publicKey)) return false;
  return tokenAccountMatches(initialized, plan.factoryMint.publicKey, plan.authority.publicKey);
}

function tokenAccountMatches(info, mint, authority) {
  if (!authority) return false;
  return new PublicKey(info.data.subarray(0, 32)).equals(mint)
    && new PublicKey(info.data.subarray(32, 64)).equals(authority)
    && info.data[108] === 1;
}

function assertProvisionedMint(info, authority) {
  const valid = info.owner.equals(TOKEN_PROGRAM_ID)
    && info.data.length === MINT_SIZE
    && info.data.readUInt32LE(0) === 1
    && new PublicKey(info.data.subarray(4, 36)).equals(authority)
    && info.data[44] === 0
    && info.data[45] === 1;
  if (!valid) throw allocationInterference("participant factory mint exists with an unexpected layout");
}

export function isAllocationTransaction(transaction, expectedAccounts) {
  if (!transaction || transaction.meta?.err != null) return false;
  const created = new Set((transaction.transaction?.message?.instructions || [])
    .filter((instruction) => instruction.program === "system" && instruction.parsed?.type === "createAccount")
    .map((instruction) => instruction.parsed?.info?.newAccount));
  return expectedAccounts.every((address) => created.has(address));
}

function transactionSigners(transaction) {
  return (transaction.transaction?.message?.accountKeys || [])
    .filter((entry) => entry?.signer)
    .map((entry) => String(entry.pubkey));
}

function allocationInterference(message) {
  const error = new Error(message);
  error.code = "allocation_interference";
  return error;
}

export function isExpectedFactoryInitializationFailure(error) {
  const instructionError = error?.InstructionError;
  return Array.isArray(instructionError)
    && instructionError[0] === 0
    && Number(instructionError[1]?.Custom) === 6;
}

export function isSuccessfulCloseTransaction(transaction, { address, destination }) {
  if (!transaction || transaction.meta?.err != null) return false;
  const topLevel = transaction.transaction?.message?.instructions || [];
  const inner = (transaction.meta?.innerInstructions || []).flatMap((group) => group.instructions || []);
  return [...topLevel, ...inner].some((instruction) => (
    instruction.program === "spl-token"
    && instruction.parsed?.type === "closeAccount"
    && instruction.parsed.info?.account === address
    && instruction.parsed.info?.destination === destination
  ));
}

async function submit(connection, transaction, signers) {
  transaction.feePayer = signers[0].publicKey;
  return sendAndConfirmTransaction(connection, transaction, signers, { commitment: "confirmed", preflightCommitment: "confirmed", maxRetries: 5 });
}

function derive(secret, label, participantId, nonce) {
  return Keypair.fromSeed(crypto.createHmac("sha256", secret).update(`evidence-room:v1:${label}:${participantId}:${nonce}`).digest());
}

function shuffledAddresses(secret, participantId, nonce, sequence, keys) {
  return keys.map((key) => key.toBase58()).sort((left, right) => {
    const rank = (address) => crypto.createHmac("sha256", secret).update(`evidence-room:v1:display:${participantId}:${nonce}:${sequence}:${address}`).digest();
    return Buffer.compare(rank(left), rank(right));
  });
}

function readKeypair(value, name) {
  try {
    const bytes = JSON.parse(String(value || ""));
    if (!Array.isArray(bytes) || bytes.length !== 64) throw new Error();
    return Keypair.fromSecretKey(Uint8Array.from(bytes));
  } catch { throw new Error(`${name} must be a 64-byte JSON keypair`); }
}

function requiredSecret(value, name) {
  if (typeof value !== "string" || Buffer.byteLength(value) < 32) throw new Error(`${name} must contain at least 32 bytes`);
  return value;
}

function nonNegativeInteger(value, name) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw new Error(`${name} must be a non-negative integer`);
  return number;
}

function requiredProductionInteger(env, name, fallback) {
  const encoded = String(env[name] ?? "").trim();
  if (env.NODE_ENV === "production" && !encoded) throw new Error(`${name} is required in production`);
  const value = Number(encoded || fallback);
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${name} must be a positive integer`);
  return value;
}
