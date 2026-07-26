import crypto from "node:crypto";

import { Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction, sendAndConfirmTransaction } from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID, ExtensionType, TOKEN_2022_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction, createInitializeMintInstruction,
  createInitializePermanentDelegateInstruction, createMintToCheckedInstruction,
  getAccountLen, getAssociatedTokenAddressSync, getMintLen,
} from "@solana/spl-token";

const DEFAULT_PROGRAM = "NcPgcz4zQ2CKZK6evWYwGC6iFcdji2Yrw65nCoto5rn";
const LOAN_LEN = 113;
const ADVANCE_LAMPORTS = 10_000_000;

export function createSecondKeyChain(env = process.env) {
  const rpcUrl = chainSetting(env, "SOLANA_RPC_URL", "https://api.devnet.solana.com");
  const connection = new Connection(rpcUrl, "confirmed");
  const programId = new PublicKey(chainSetting(env, "SECOND_KEY_PROGRAM_ID", DEFAULT_PROGRAM));
  const payer = readKeypair(env.SECOND_KEY_FACTORY_KEYPAIR, "SECOND_KEY_FACTORY_KEYPAIR");
  const secret = required(env.SECOND_KEY_CHAIN_SECRET, "SECOND_KEY_CHAIN_SECRET");
  const certificateSecret = required(env.SECOND_KEY_CERTIFICATE_SECRET || env.SECOND_KEY_CHAIN_SECRET, "SECOND_KEY_CERTIFICATE_SECRET");
  const minimumPayerBalance = positiveIntegerSetting(env, "SECOND_KEY_MIN_PAYER_LAMPORTS", 100_000_000);
  const feeBudgetLamports = positiveIntegerSetting(env, "SECOND_KEY_FEE_BUDGET_LAMPORTS", 100_000);
  const capacityBufferBps = nonnegativeIntegerSetting(env, "SECOND_KEY_CAPACITY_BUFFER_BPS", 1_000, 10_000);

  function addresses(participantId, nonce) {
    const wallet = derive(secret, "wallet", participantId, nonce);
    const mint = derive(secret, "mint", participantId, nonce);
    const loan = derive(secret, "loan", participantId, nonce);
    const [vaultAuthority] = PublicKey.findProgramAddressSync([Buffer.from("vault"), loan.publicKey.toBuffer()], programId);
    const source = getAssociatedTokenAddressSync(mint.publicKey, wallet.publicKey, false, TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);
    const vault = getAssociatedTokenAddressSync(mint.publicKey, vaultAuthority, true, TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);
    return { wallet, mint, loan, vaultAuthority, source, vault };
  }

  return {
    network: env.SECOND_KEY_NETWORK || "devnet",
    rpcUrl,
    programId: programId.toBase58(),
    async provision(participantId, nonce) {
      const a = addresses(participantId, nonce);
      const existingLoan = await connection.getAccountInfo(a.loan.publicKey, "confirmed");
      if (!existingLoan) {
        const mintLength = getMintLen([ExtensionType.PermanentDelegate]);
        const [mintRent, loanRent, walletBalance, mintInfo] = await Promise.all([
          connection.getMinimumBalanceForRentExemption(mintLength, "confirmed"),
          connection.getMinimumBalanceForRentExemption(LOAN_LEN, "confirmed"),
          connection.getBalance(a.wallet.publicKey, "confirmed"),
          connection.getAccountInfo(a.mint.publicKey, "confirmed"),
        ]);
        const setup = new Transaction(); const setupSigners = [payer];
        if (walletBalance < 20_000_000) setup.add(SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: a.wallet.publicKey, lamports: 30_000_000 - walletBalance }));
        if (!mintInfo) {
          setup.add(
            SystemProgram.createAccount({ fromPubkey: payer.publicKey, newAccountPubkey: a.mint.publicKey, lamports: mintRent, space: mintLength, programId: TOKEN_2022_PROGRAM_ID }),
            createInitializePermanentDelegateInstruction(a.mint.publicKey, a.wallet.publicKey, TOKEN_2022_PROGRAM_ID),
            createInitializeMintInstruction(a.mint.publicKey, 0, payer.publicKey, null, TOKEN_2022_PROGRAM_ID),
          );
          setupSigners.push(a.mint);
        }
        if (setup.instructions.length) await submit(connection, setup, setupSigners);

        const sourceAccount = await tokenAccountOrNull(connection, a.source);
        const transaction = new Transaction().add(
          createAssociatedTokenAccountIdempotentInstruction(payer.publicKey, a.source, a.wallet.publicKey, a.mint.publicKey, TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID),
          createAssociatedTokenAccountIdempotentInstruction(payer.publicKey, a.vault, a.vaultAuthority, a.mint.publicKey, TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID),
        );
        if (!sourceAccount || sourceAccount.amount === 0n) transaction.add(createMintToCheckedInstruction(a.mint.publicKey, a.source, payer.publicKey, 1, 0, [], TOKEN_2022_PROGRAM_ID));
        transaction.add(
          SystemProgram.createAccount({ fromPubkey: payer.publicKey, newAccountPubkey: a.loan.publicKey, lamports: loanRent + ADVANCE_LAMPORTS, space: LOAN_LEN, programId }),
          new TransactionInstruction({ programId, keys: [
            { pubkey: a.loan.publicKey, isSigner: false, isWritable: true },
            { pubkey: a.wallet.publicKey, isSigner: true, isWritable: false },
            { pubkey: a.mint.publicKey, isSigner: false, isWritable: false },
            { pubkey: a.vault, isSigner: false, isWritable: false },
          ], data: Buffer.from([0]) }),
        );
        await submit(connection, transaction, [payer, a.wallet, a.loan]);
      }
      const certificate = crypto.createHmac("sha256", certificateSecret).update(`second-key:v1:${participantId}:${nonce}:${a.mint.publicKey}`).digest("base64url").slice(0, 28);
      return publicAddresses(a, programId, certificate);
    },
    walletSecret(participantId, nonce) { return [...addresses(participantId, nonce).wallet.secretKey]; },
    async pledge(participantId, nonce) {
      const a = addresses(participantId, nonce);
      const ix = new TransactionInstruction({ programId, keys: [
        { pubkey: a.loan.publicKey, isSigner: false, isWritable: true },
        { pubkey: a.wallet.publicKey, isSigner: true, isWritable: true },
        { pubkey: a.source, isSigner: false, isWritable: true },
        { pubkey: a.vault, isSigner: false, isWritable: true },
        { pubkey: a.mint.publicKey, isSigner: false, isWritable: false },
        { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
      ], data: Buffer.from([1]) });
      return submit(connection, new Transaction().add(ix), [payer, a.wallet], "finalized");
    },
    async inspect(participantId, nonce) {
      const a = addresses(participantId, nonce);
      const [sourceInfo, vaultInfo, loanInfo, walletInfo] =
        await connection.getMultipleAccountsInfo(
          [a.source, a.vault, a.loan.publicKey, a.wallet.publicKey],
          "confirmed",
        );
      const source = tokenAccountFromInfo(sourceInfo);
      const vault = tokenAccountFromInfo(vaultInfo);
      const loan = decodeLoan(loanInfo?.data);
      return {
        sourceBalance: Number(source?.amount || 0n),
        vaultBalance: Number(vault?.amount || 0n),
        outstanding: loan?.outstanding || false,
        advanceLamports: loan?.advanceLamports || 0,
        walletBalance: walletInfo?.lamports || 0,
      };
    },
    async findPledge(participantId, nonce) {
      const a = addresses(participantId, nonce);
      const rows = await connection.getSignaturesForAddress(a.loan.publicKey, { limit: 20 }, "finalized");
      for (const row of rows) {
        if (row.err != null) continue;
        const tx = await connection.getParsedTransaction(row.signature, { commitment: "finalized", maxSupportedTransactionVersion: 0 });
        if (isSuccessfulPledgeTransaction(tx, {
          programId: programId.toBase58(),
          loan: a.loan.publicKey.toBase58(),
          wallet: a.wallet.publicKey.toBase58(),
          source: a.source.toBase58(),
          vault: a.vault.toBase58(),
          mint: a.mint.publicKey.toBase58(),
        })) {
          return {
            signature: row.signature,
            pledgedAt: Number.isSafeInteger(row.blockTime) ? new Date(row.blockTime * 1_000).toISOString() : null,
          };
        }
      }
      return null;
    },
    async findRemoval(participantId, nonce, knownSignature) {
      const a = addresses(participantId, nonce);
      const rows = await connection.getSignaturesForAddress(a.vault, { limit: 20 }, "finalized");
      for (const row of rows) {
        if (row.signature === knownSignature) continue;
        const tx = await connection.getParsedTransaction(row.signature, { commitment: "finalized", maxSupportedTransactionVersion: 0 });
        if (isSuccessfulRemovalTransaction(tx, {
          vault: a.vault.toBase58(),
          source: a.source.toBase58(),
          wallet: a.wallet.publicKey.toBase58(),
        })) {
          let blockTime = Number.isSafeInteger(row.blockTime) ? row.blockTime : tx?.blockTime;
          if (!Number.isSafeInteger(blockTime) && Number.isSafeInteger(tx?.slot)) {
            blockTime = await connection.getBlockTime(tx.slot);
          }
          if (!Number.isSafeInteger(blockTime)) continue;
          return { signature: row.signature, completedAt: new Date(blockTime * 1_000).toISOString() };
        }
      }
      return null;
    },
    async health({ provisionedParticipants = 0 } = {}) {
      const mintLength = getMintLen([ExtensionType.PermanentDelegate]);
      const tokenAccountLength = getAccountLen([ExtensionType.ImmutableOwner]);
      const [balance, mintRent, tokenAccountRent, loanRent] = await Promise.all([
        connection.getBalance(payer.publicKey, "confirmed"),
        connection.getMinimumBalanceForRentExemption(mintLength, "confirmed"),
        connection.getMinimumBalanceForRentExemption(tokenAccountLength, "confirmed"),
        connection.getMinimumBalanceForRentExemption(LOAN_LEN, "confirmed"),
      ]);
      const payerHealth = evaluateSecondKeyPayerCapacity({
        balance,
        minimumPayerBalance,
        provisionedParticipants,
        mintRent,
        tokenAccountRent,
        loanRent,
        feeBudgetLamports,
        capacityBufferBps,
      });
      return {
        ...payerHealth,
        network: env.SECOND_KEY_NETWORK || "devnet",
        payer: payer.publicKey.toBase58(),
        programId: programId.toBase58(),
      };
    },
  };
}

export function evaluateSecondKeyPayerCapacity({ balance, minimumPayerBalance, ...capacityInput }) {
  const payerBalance = capacityInteger(balance, "balance");
  const minimumBalance = capacityInteger(minimumPayerBalance, "minimumPayerBalance");
  const capacity = estimateSecondKeyCapacity(capacityInput);
  const availableProvisionSlots = Math.floor(
    Math.max(0, payerBalance - minimumBalance) / capacity.bufferedPerParticipantLamports,
  );
  const maxParticipants = capacity.provisionedParticipants + availableProvisionSlots;
  return {
    ok: payerBalance >= minimumBalance,
    balance: payerBalance,
    minimumPayerBalance: minimumBalance,
    requiredBalance: minimumBalance,
    capacity: {
      ...capacity,
      availableProvisionSlots,
      maxParticipants,
    },
  };
}

export function estimateSecondKeyCapacity({
  provisionedParticipants = 0,
  mintRent,
  tokenAccountRent,
  loanRent,
  feeBudgetLamports = 100_000,
  walletFundingLamports = 30_000_000,
  advanceLamports = ADVANCE_LAMPORTS,
  capacityBufferBps = 1_000,
}) {
  const provisioned = capacityInteger(provisionedParticipants, "provisionedParticipants");
  const components = {
    walletFundingLamports: capacityInteger(walletFundingLamports, "walletFundingLamports"),
    mintRentLamports: capacityInteger(mintRent, "mintRent"),
    tokenAccountsRentLamports: safeProduct(capacityInteger(tokenAccountRent, "tokenAccountRent"), 2, "token account rent"),
    loanRentLamports: capacityInteger(loanRent, "loanRent"),
    advanceLamports: capacityInteger(advanceLamports, "advanceLamports"),
    feeBudgetLamports: capacityInteger(feeBudgetLamports, "feeBudgetLamports"),
  };
  const bufferBps = capacityInteger(capacityBufferBps, "capacityBufferBps", { maximum: 10_000 });
  const perParticipantLamports = safeSum(Object.values(components), "per-participant capacity");
  const bufferedPerParticipantLamports = bufferedAmount(perParticipantLamports, bufferBps);
  return {
    provisionedParticipants: provisioned,
    perParticipantLamports,
    bufferedPerParticipantLamports,
    capacityBufferBps: bufferBps,
    components,
  };
}

export function isSuccessfulPledgeTransaction(transaction, { programId, loan, wallet, source, vault, mint }) {
  if (!transaction || transaction.meta?.err != null) return false;
  const topLevel = transaction.transaction?.message?.instructions || [];
  const inner = (transaction.meta?.innerInstructions || []).flatMap((group) => group.instructions || []);
  const expectedAccounts = [loan, wallet, source, vault, mint, TOKEN_2022_PROGRAM_ID.toBase58()];
  return [...topLevel, ...inner].some((instruction) => {
    const accounts = (instruction.accounts || []).map(programAddress);
    return programAddress(instruction.programId) === programId
      && instruction.data === "2"
      && expectedAccounts.every((address, index) => accounts[index] === address);
  });
}

export function isSuccessfulRemovalTransaction(transaction, { vault, source, wallet }) {
  if (!transaction || transaction.meta?.err != null) return false;
  const topLevel = transaction.transaction?.message?.instructions || [];
  const inner = (transaction.meta?.innerInstructions || []).flatMap((group) => group.instructions || []);
  return [...topLevel, ...inner].some((instruction) => (
    programAddress(instruction.programId) === TOKEN_2022_PROGRAM_ID.toBase58()
    && instruction.parsed?.type === "transferChecked"
    && instruction.parsed.info?.source === vault
    && instruction.parsed.info?.destination === source
    && instruction.parsed.info?.authority === wallet
    && String(instruction.parsed.info?.tokenAmount?.amount) === "1"
  ));
}

function programAddress(value) {
  if (typeof value === "string") return value;
  if (value?.toBase58) return value.toBase58();
  return String(value || "");
}

function publicAddresses(a, programId, certificate) { return { wallet: a.wallet.publicKey.toBase58(), mint: a.mint.publicKey.toBase58(), source: a.source.toBase58(), vault: a.vault.toBase58(), vaultAuthority: a.vaultAuthority.toBase58(), loan: a.loan.publicKey.toBase58(), programId: programId.toBase58(), certificate }; }
async function tokenAccountOrNull(connection, address) {
  try {
    const info = await connection.getAccountInfo(address, "confirmed");
    return tokenAccountFromInfo(info);
  } catch {
    return null;
  }
}
function tokenAccountFromInfo(info) {
  // Token and Token-2022 accounts share this fixed 165-byte base layout. Read
  // only the amount after checking owner, minimum length, and initialized
  // state, instead of routing public RPC bytes through bigint-buffer.
  if (
    !info
    || !info.owner.equals(TOKEN_2022_PROGRAM_ID)
    || info.data.length < 165
    || info.data[108] === 0
  ) return null;
  return { amount: info.data.readBigUInt64LE(64) };
}
function decodeLoan(data) { if (!data || data.length !== LOAN_LEN || !data.subarray(0, 8).equals(Buffer.from("SECKEY26"))) return null; return { outstanding: data[104] === 1, advanceLamports: Number(data.readBigUInt64LE(105)) }; }
async function submit(connection, transaction, signers, commitment = "confirmed") { transaction.feePayer = signers[0].publicKey; return sendAndConfirmTransaction(connection, transaction, signers, { commitment, preflightCommitment: "confirmed", maxRetries: 5 }); }
function derive(secret, label, participantId, nonce) { return Keypair.fromSeed(crypto.createHmac("sha256", secret).update(`second-key:v1:${label}:${participantId}:${nonce}`).digest()); }
function readKeypair(value, name) { try { const bytes = JSON.parse(String(value || "")); if (!Array.isArray(bytes) || bytes.length !== 64) throw new Error(); return Keypair.fromSecretKey(Uint8Array.from(bytes)); } catch { throw new Error(`${name} must be a 64-byte JSON keypair`); } }
function required(value, name) { if (typeof value !== "string" || Buffer.byteLength(value) < 32) throw new Error(`${name} must contain at least 32 bytes`); return value; }
function chainSetting(env, name, fallback) { const value = String(env[name] || "").trim(); if (env.NODE_ENV === "production" && !value) throw new Error(`${name} is required in production`); return value || fallback; }
function positiveIntegerSetting(env, name, fallback) { const encoded = String(env[name] ?? "").trim(); if (env.NODE_ENV === "production" && !encoded) throw new Error(`${name} is required in production`); const value = Number(encoded || fallback); if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${name} must be a positive integer`); return value; }
function nonnegativeIntegerSetting(env, name, fallback, maximum = Number.MAX_SAFE_INTEGER) { const encoded = String(env[name] ?? "").trim(); if (env.NODE_ENV === "production" && !encoded) throw new Error(`${name} is required in production`); const value = Number(encoded || fallback); if (!Number.isSafeInteger(value) || value < 0 || value > maximum) throw new Error(`${name} must be an integer between 0 and ${maximum}`); return value; }
function capacityInteger(value, name, { minimum = 0, maximum = Number.MAX_SAFE_INTEGER } = {}) { if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new Error(`${name} must be a safe integer between ${minimum} and ${maximum}`); return value; }
function safeSum(values, name) { const total = values.reduce((sum, value) => sum + BigInt(value), 0n); return safeNumber(total, name); }
function safeProduct(left, right, name) { return safeNumber(BigInt(left) * BigInt(right), name); }
function bufferedAmount(value, bufferBps) { return safeNumber((BigInt(value) * BigInt(10_000 + bufferBps) + 9_999n) / 10_000n, "buffered field capacity"); }
function safeNumber(value, name) { if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error(`${name} exceeds the safe integer range`); return Number(value); }
