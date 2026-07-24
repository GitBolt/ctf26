import crypto from "node:crypto";

import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";

const PASS_LEN = 42;
const JACKPOT_LEN = 9;
const PASS_MAGIC = Buffer.from("TWINPASS");
const JACKPOT_MAGIC = Buffer.from("TWINPOT!");
const MIGRATION_CONTEXT_ACCOUNTS = 8;
export const PASS_ACCOUNTS_PER_PARTICIPANT = 2 + MIGRATION_CONTEXT_ACCOUNTS;
const DEFAULT_RPC = "https://api.devnet.solana.com";
const DEFAULT_PROGRAM = "BGJkBJaEHAakMso532hE1vfGdFkYX8dvjy9gDbCGN7eW";

export function createDevnetChain(env = process.env) {
  const rpcUrl = chainSetting(env, "SOLANA_RPC_URL", DEFAULT_RPC);
  const programId = new PublicKey(chainSetting(env, "PLAYER_TWO_PROGRAM_ID", DEFAULT_PROGRAM));
  const payer = readPayer(env.PLAYER_TWO_DEVNET_KEYPAIR);
  const derivationSecret = requiredSecret(env.PLAYER_TWO_CHAIN_SECRET, "PLAYER_TWO_CHAIN_SECRET");
  const safetyReserveLamports = positiveIntegerSetting(env, "PLAYER_TWO_MIN_PAYER_LAMPORTS", 100_000_000);
  const connection = new Connection(rpcUrl, "confirmed");

  return {
    network: "devnet",
    programId: programId.toBase58(),
    rpcUrl,

    async provision(participantId, eventNonce) {
      const holder = deriveKeypair(derivationSecret, "holder", participantId, eventNonce);
      const previous = deriveKeypair(derivationSecret, "pass-1", participantId, eventNonce);
      const current = deriveKeypair(derivationSecret, "pass-2", participantId, eventNonce);
      const jackpot = deriveKeypair(derivationSecret, "jackpot", participantId, eventNonce);
      const contextAccounts = Array.from({ length: MIGRATION_CONTEXT_ACCOUNTS }, (_, index) => deriveKeypair(derivationSecret, `migration-context-${index}`, participantId, eventNonce));
      const [passRent, jackpotRent] = await Promise.all([
        connection.getMinimumBalanceForRentExemption(PASS_LEN, "confirmed"),
        connection.getMinimumBalanceForRentExemption(JACKPOT_LEN, "confirmed"),
      ]);

      const initial = await connection.getMultipleAccountsInfo([previous.publicKey, current.publicKey, jackpot.publicKey], "confirmed");
      if (initial.some(Boolean) && !initial.every(Boolean)) {
        throw new Error("PLAYER TWO main account allocation is only partially present on Devnet");
      }
      let setupSignature = null;
      if (initial.every((account) => !account)) {
        const setup = new Transaction().add(
          SystemProgram.createAccount({ fromPubkey: payer.publicKey, newAccountPubkey: previous.publicKey, lamports: passRent, space: PASS_LEN, programId }),
          SystemProgram.createAccount({ fromPubkey: payer.publicKey, newAccountPubkey: current.publicKey, lamports: passRent, space: PASS_LEN, programId }),
          SystemProgram.createAccount({ fromPubkey: payer.publicKey, newAccountPubkey: jackpot.publicKey, lamports: jackpotRent, space: JACKPOT_LEN, programId }),
          new TransactionInstruction({
            programId,
            keys: [
              { pubkey: holder.publicKey, isSigner: true, isWritable: false },
              { pubkey: previous.publicKey, isSigner: false, isWritable: true },
              { pubkey: current.publicKey, isSigner: false, isWritable: true },
              { pubkey: jackpot.publicKey, isSigner: false, isWritable: true },
            ],
            data: Buffer.from([2]),
          }),
        );
        setupSignature = await submit(connection, setup, [payer, holder, previous, current, jackpot]);
      }

      const contextSetupSignatures = [];
      for (let offset = 0; offset < contextAccounts.length; offset += 2) {
        const batch = contextAccounts.slice(offset, offset + 2);
        const batchInfo = await connection.getMultipleAccountsInfo(batch.map(({ publicKey }) => publicKey), "confirmed");
        if (batchInfo.some(Boolean) && !batchInfo.every(Boolean)) {
          throw new Error("PLAYER TWO context allocation is only partially present on Devnet");
        }
        if (batchInfo.every((account) => !account)) {
          const transaction = new Transaction();
          for (const contextAccount of batch) {
            transaction.add(SystemProgram.createAccount({ fromPubkey: payer.publicKey, newAccountPubkey: contextAccount.publicKey, lamports: passRent, space: PASS_LEN, programId }));
          }
          contextSetupSignatures.push(await submit(connection, transaction, [payer, ...batch]));
        }
      }

      const contextInfo = await connection.getMultipleAccountsInfo(contextAccounts.map(({ publicKey }) => publicKey), "confirmed");
      const contextsAreBlank = contextInfo.every((account) => validBlankProgramAccount(account, programId, PASS_LEN));
      const contextStates = await Promise.all(contextAccounts.map(({ publicKey }) => inspectPass(connection, programId, publicKey)));
      const contextsAreInitialized = contextStates.every((state, index) => (
        state.found && state.active && state.generation === (index % 2 === 0 ? 1 : 2)
      ));
      if (!contextsAreBlank && !contextsAreInitialized) {
        throw new Error("PLAYER TWO context accounts have an unexpected Devnet state");
      }
      let contextInitializationSignature = null;
      if (contextsAreBlank) {
        const contextInitialization = new Transaction().add(new TransactionInstruction({
          programId,
          keys: contextAccounts.map(({ publicKey }) => ({ pubkey: publicKey, isSigner: false, isWritable: true })),
          data: Buffer.from([3]),
        }));
        contextInitializationSignature = await submit(connection, contextInitialization, [payer]);
      }

      let observedCurrent = await inspectPass(connection, programId, current.publicKey);
      let migrationSignature = null;
      if (!observedCurrent.found) {
        const currentInfo = await connection.getAccountInfo(current.publicKey, "confirmed");
        if (!validBlankProgramAccount(currentInfo, programId, PASS_LEN)) {
          throw new Error("PLAYER TWO current pass has an unexpected Devnet state");
        }
        const migration = new Transaction().add(new TransactionInstruction({
          programId,
          keys: [
            { pubkey: holder.publicKey, isSigner: true, isWritable: false },
            { pubkey: previous.publicKey, isSigner: false, isWritable: true },
            { pubkey: current.publicKey, isSigner: false, isWritable: true },
            ...contextAccounts.map(({ publicKey }) => ({ pubkey: publicKey, isSigner: false, isWritable: true })),
          ],
          data: Buffer.from([0]),
        }));
        migrationSignature = await submit(connection, migration, [payer, holder]);
        observedCurrent = await inspectPass(connection, programId, current.publicKey);
      } else {
        migrationSignature = await findMigrationSignature(connection, programId, current.publicKey, [
          holder.publicKey,
          previous.publicKey,
          current.publicKey,
          ...contextAccounts.map(({ publicKey }) => publicKey),
        ]);
      }
      const [previousState, currentState, jackpotState] = await Promise.all([
        inspectPass(connection, programId, previous.publicKey),
        inspectPass(connection, programId, current.publicKey),
        inspectJackpot(connection, programId, jackpot.publicKey),
      ]);
      if (!previousState.active || previousState.generation !== 1 || previousState.holder !== holder.publicKey.toBase58()
        || !currentState.active || currentState.generation !== 2 || currentState.holder !== holder.publicKey.toBase58()
        || jackpotState.opened || !migrationSignature) {
        throw new Error("Devnet migration confirmation returned unexpected account state");
      }
      return {
        holder: holder.publicKey.toBase58(),
        previousPass: previous.publicKey.toBase58(),
        currentPass: current.publicKey.toBase58(),
        jackpot: jackpot.publicKey.toBase58(),
        setupSignature,
        contextSetupSignatures,
        contextInitializationSignature,
        migrationSignature,
      };
    },

    async inspectPass(address) {
      let pubkey;
      try { pubkey = new PublicKey(String(address || "")); }
      catch { return { found: false, address: String(address || "").trim() }; }
      return inspectPass(connection, programId, pubkey);
    },

    async migration(signature) {
      const transaction = await connection.getTransaction(signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
      if (!transaction) throw new Error("Devnet migration transaction is not available");
      const accountKeys = transaction.transaction.message.accountKeys.map((key) => key.toBase58());
      return {
        signature,
        network: "devnet",
        slot: transaction.slot,
        status: transaction.meta?.err ? "failed" : "confirmed",
        accounts: accountKeys,
        explorerUrl: explorerTransaction(signature),
      };
    },

    async openJackpot({ participantId, eventNonce, jackpot, firstPass, secondPass }) {
      const holder = deriveKeypair(derivationSecret, "holder", participantId, eventNonce);
      const jackpotKey = new PublicKey(jackpot);
      const first = new PublicKey(firstPass);
      const second = new PublicKey(secondPass);
      const transaction = new Transaction().add(new TransactionInstruction({
        programId,
        keys: [
          { pubkey: jackpotKey, isSigner: false, isWritable: true },
          { pubkey: first, isSigner: false, isWritable: false },
          { pubkey: holder.publicKey, isSigner: true, isWritable: false },
          { pubkey: second, isSigner: false, isWritable: false },
          { pubkey: holder.publicKey, isSigner: true, isWritable: false },
        ],
        data: Buffer.from([1]),
      }));
      const signature = await submit(connection, transaction, [payer, holder], "finalized");
      const state = await inspectJackpot(connection, programId, jackpotKey, "finalized");
      if (!state.opened) throw new Error("Devnet jackpot account did not record the win");
      return { signature, explorerUrl: explorerTransaction(signature) };
    },

    async jackpotState(jackpot) {
      const jackpotKey = new PublicKey(jackpot);
      const state = await inspectJackpot(connection, programId, jackpotKey, "finalized");
      if (!state.opened) return { opened: false, signature: null, openedAt: null };
      const entries = await connection.getSignaturesForAddress(jackpotKey, { limit: 20 }, "finalized");
      for (const entry of entries) {
        if (entry.err != null) continue;
        const transaction = await connection.getParsedTransaction(entry.signature, { commitment: "finalized", maxSupportedTransactionVersion: 0 });
        if (isSuccessfulJackpotOpenTransaction(transaction, { programId: programId.toBase58(), jackpot: jackpotKey.toBase58() })) {
          return {
            opened: true,
            signature: entry.signature,
            openedAt: Number.isSafeInteger(entry.blockTime) ? entry.blockTime * 1_000 : null,
            explorerUrl: explorerTransaction(entry.signature),
          };
        }
      }
      return { opened: true, signature: null, openedAt: null };
    },

    async health({ remainingParticipants = 0, feeBufferLamportsPerParticipant = 0 } = {}) {
      const [program, balance, passRentLamports, jackpotRentLamports] = await Promise.all([
        connection.getAccountInfo(programId, "confirmed"),
        connection.getBalance(payer.publicKey, "confirmed"),
        connection.getMinimumBalanceForRentExemption(PASS_LEN, "confirmed"),
        connection.getMinimumBalanceForRentExemption(JACKPOT_LEN, "confirmed"),
      ]);
      const capacity = assessProvisionCapacity({
        payerLamports: balance,
        remainingParticipants,
        passRentLamports,
        jackpotRentLamports,
        feeBufferLamportsPerParticipant,
        safetyReserveLamports,
      });
      const programAvailable = Boolean(program?.executable);
      return {
        ok: programAvailable && capacity.capacitySufficient,
        network: "devnet",
        programId: programId.toBase58(),
        payer: payer.publicKey.toBase58(),
        programAvailable,
        capacitySufficient: capacity.capacitySufficient,
        payerBalance: balance,
        requiredPayerBalance: capacity.requiredPayerLamports,
        rentLamportsPerParticipant: capacity.rentLamportsPerParticipant,
        feeBufferLamportsPerParticipant,
        safetyReserveLamports,
      };
    },
  };
}

export function assessProvisionCapacity({
  payerLamports,
  remainingParticipants,
  passRentLamports,
  jackpotRentLamports,
  feeBufferLamportsPerParticipant,
  safetyReserveLamports,
}) {
  for (const [name, value] of Object.entries({ payerLamports, remainingParticipants, passRentLamports, jackpotRentLamports, feeBufferLamportsPerParticipant, safetyReserveLamports })) {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${name} must be a non-negative safe integer`);
  }
  const rentLamportsPerParticipant = (PASS_ACCOUNTS_PER_PARTICIPANT * passRentLamports) + jackpotRentLamports;
  const requiredPayerLamports = safetyReserveLamports + (remainingParticipants * (rentLamportsPerParticipant + feeBufferLamportsPerParticipant));
  if (!Number.isSafeInteger(requiredPayerLamports)) throw new Error("required Player Two capacity exceeds the safe integer range");
  return Object.freeze({
    rentLamportsPerParticipant,
    requiredPayerLamports,
    capacitySufficient: payerLamports >= requiredPayerLamports,
  });
}

async function inspectPass(connection, programId, pubkey) {
  const account = await connection.getAccountInfo(pubkey, "confirmed");
  const address = pubkey.toBase58();
  if (!account || !account.owner.equals(programId) || account.data.length !== PASS_LEN || !account.data.subarray(0, 8).equals(PASS_MAGIC)) {
    return { found: false, address };
  }
  return {
    found: true,
    address,
    owner: account.owner.toBase58(),
    holder: new PublicKey(account.data.subarray(8, 40)).toBase58(),
    generation: account.data[40],
    active: account.data[41] === 1,
  };
}

async function inspectJackpot(connection, programId, pubkey, commitment = "confirmed") {
  const account = await connection.getAccountInfo(pubkey, commitment);
  if (!account || !account.owner.equals(programId) || account.data.length !== JACKPOT_LEN || !account.data.subarray(0, 8).equals(JACKPOT_MAGIC)) {
    throw new Error("invalid Devnet jackpot account");
  }
  return { opened: account.data[8] === 1 };
}

function validBlankProgramAccount(account, programId, length) {
  return Boolean(
    account
    && account.owner.equals(programId)
    && account.data.length === length
    && account.data.every((byte) => byte === 0)
  );
}

async function findMigrationSignature(connection, programId, current, expectedAccounts) {
  const expected = expectedAccounts.map(publicKeyString);
  const entries = await connection.getSignaturesForAddress(current, { limit: 20 }, "confirmed");
  for (const entry of entries) {
    if (entry.err != null) continue;
    const transaction = await connection.getParsedTransaction(entry.signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
    if (!transaction || transaction.meta?.err != null) continue;
    const instructions = [
      ...(transaction.transaction?.message?.instructions || []),
      ...(transaction.meta?.innerInstructions || []).flatMap((group) => group.instructions || []),
    ];
    const matched = instructions.some((instruction) => (
      publicKeyString(instruction.programId) === programId.toBase58()
      && instruction.data === "1"
      && expected.every((address, index) => publicKeyString(instruction.accounts?.[index]) === address)
    ));
    if (matched) return entry.signature;
  }
  return null;
}

export function isSuccessfulJackpotOpenTransaction(transaction, { programId, jackpot }) {
  if (!transaction || transaction.meta?.err != null) return false;
  const instructions = transaction.transaction?.message?.instructions || [];
  return instructions.some((instruction) => (
    publicKeyString(instruction.programId) === programId
    && publicKeyString(instruction.accounts?.[0]) === jackpot
    && instruction.data === "2"
  ));
}

function publicKeyString(value) {
  if (typeof value === "string") return value;
  if (value?.toBase58) return value.toBase58();
  return String(value || "");
}

async function submit(connection, transaction, signers, commitment = "confirmed") {
  transaction.feePayer = signers[0].publicKey;
  return sendAndConfirmTransaction(connection, transaction, signers, {
    commitment,
    preflightCommitment: "confirmed",
    maxRetries: 5,
  });
}

function deriveKeypair(secret, label, participantId, eventNonce) {
  const seed = crypto.createHmac("sha256", secret).update(`player-two:devnet:v1:${label}:${participantId}:${eventNonce}`).digest();
  return Keypair.fromSeed(seed);
}

function readPayer(value) {
  if (!value) throw new Error("PLAYER_TWO_DEVNET_KEYPAIR is required");
  let bytes;
  try { bytes = JSON.parse(value); }
  catch { throw new Error("PLAYER_TWO_DEVNET_KEYPAIR must be a JSON byte array"); }
  if (!Array.isArray(bytes) || bytes.length !== 64) throw new Error("PLAYER_TWO_DEVNET_KEYPAIR must contain 64 bytes");
  return Keypair.fromSecretKey(Uint8Array.from(bytes));
}

function requiredSecret(value, name) {
  if (typeof value !== "string" || Buffer.byteLength(value) < 32) throw new Error(`${name} must contain at least 32 bytes`);
  return value;
}

function chainSetting(env, name, fallback) {
  const value = String(env[name] || "").trim();
  if (env.NODE_ENV === "production" && !value) throw new Error(`${name} is required in production`);
  return value || fallback;
}

function positiveIntegerSetting(env, name, fallback) {
  const encoded = String(env[name] ?? "").trim();
  if (env.NODE_ENV === "production" && !encoded) throw new Error(`${name} is required in production`);
  const value = Number(encoded || fallback);
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${name} must be a positive integer`);
  return value;
}

export function explorerTransaction(signature) {
  return `https://explorer.solana.com/tx/${encodeURIComponent(signature)}?cluster=devnet`;
}
