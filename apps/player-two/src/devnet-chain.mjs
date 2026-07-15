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
const DEFAULT_RPC = "https://api.devnet.solana.com";
const DEFAULT_PROGRAM = "BGJkBJaEHAakMso532hE1vfGdFkYX8dvjy9gDbCGN7eW";

export function createDevnetChain(env = process.env) {
  const rpcUrl = env.SOLANA_RPC_URL || DEFAULT_RPC;
  const programId = new PublicKey(env.PLAYER_TWO_PROGRAM_ID || DEFAULT_PROGRAM);
  const payer = readPayer(env.PLAYER_TWO_DEVNET_KEYPAIR);
  const derivationSecret = requiredSecret(env.PLAYER_TWO_CHAIN_SECRET, "PLAYER_TWO_CHAIN_SECRET");
  const connection = new Connection(rpcUrl, "confirmed");

  return {
    network: "devnet",
    programId: programId.toBase58(),
    rpcUrl,

    async provision(teamId, eventNonce) {
      const holder = deriveKeypair(derivationSecret, "holder", teamId, eventNonce);
      const previous = deriveKeypair(derivationSecret, "pass-1", teamId, eventNonce);
      const current = deriveKeypair(derivationSecret, "pass-2", teamId, eventNonce);
      const jackpot = deriveKeypair(derivationSecret, "jackpot", teamId, eventNonce);
      const contextAccounts = Array.from({ length: MIGRATION_CONTEXT_ACCOUNTS }, (_, index) => deriveKeypair(derivationSecret, `migration-context-${index}`, teamId, eventNonce));
      const keys = [previous.publicKey, current.publicKey, jackpot.publicKey, ...contextAccounts.map(({ publicKey }) => publicKey)];
      const existing = await connection.getMultipleAccountsInfo(keys, "confirmed");
      if (existing.some(Boolean)) throw new Error("derived Devnet accounts already exist without a stored challenge instance");

      const [passRent, jackpotRent] = await Promise.all([
        connection.getMinimumBalanceForRentExemption(PASS_LEN, "confirmed"),
        connection.getMinimumBalanceForRentExemption(JACKPOT_LEN, "confirmed"),
      ]);
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
      const setupSignature = await submit(connection, setup, [payer, holder, previous, current, jackpot]);
      const contextSetupSignatures = [];
      for (let offset = 0; offset < contextAccounts.length; offset += 2) {
        const batch = contextAccounts.slice(offset, offset + 2);
        const transaction = new Transaction();
        for (const contextAccount of batch) {
          transaction.add(SystemProgram.createAccount({ fromPubkey: payer.publicKey, newAccountPubkey: contextAccount.publicKey, lamports: passRent, space: PASS_LEN, programId }));
        }
        contextSetupSignatures.push(await submit(connection, transaction, [payer, ...batch]));
      }
      const contextInitialization = new Transaction().add(new TransactionInstruction({
        programId,
        keys: contextAccounts.map(({ publicKey }) => ({ pubkey: publicKey, isSigner: false, isWritable: true })),
        data: Buffer.from([3]),
      }));
      const contextInitializationSignature = await submit(connection, contextInitialization, [payer]);
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
      const migrationSignature = await submit(connection, migration, [payer, holder]);
      const [previousState, currentState, jackpotState] = await Promise.all([
        inspectPass(connection, programId, previous.publicKey),
        inspectPass(connection, programId, current.publicKey),
        inspectJackpot(connection, programId, jackpot.publicKey),
      ]);
      if (!previousState.active || previousState.generation !== 1 || !currentState.active || currentState.generation !== 2 || jackpotState.opened) {
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

    async openJackpot({ teamId, eventNonce, jackpot, firstPass, secondPass }) {
      const holder = deriveKeypair(derivationSecret, "holder", teamId, eventNonce);
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
      const signature = await submit(connection, transaction, [payer, holder]);
      const state = await inspectJackpot(connection, programId, jackpotKey);
      if (!state.opened) throw new Error("Devnet jackpot account did not record the win");
      return { signature, explorerUrl: explorerTransaction(signature) };
    },

    async health() {
      const [program, balance] = await Promise.all([
        connection.getAccountInfo(programId, "confirmed"),
        connection.getBalance(payer.publicKey, "confirmed"),
      ]);
      return { ok: Boolean(program?.executable), network: "devnet", programId: programId.toBase58(), payerBalance: balance };
    },
  };
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

async function inspectJackpot(connection, programId, pubkey) {
  const account = await connection.getAccountInfo(pubkey, "confirmed");
  if (!account || !account.owner.equals(programId) || account.data.length !== JACKPOT_LEN || !account.data.subarray(0, 8).equals(JACKPOT_MAGIC)) {
    throw new Error("invalid Devnet jackpot account");
  }
  return { opened: account.data[8] === 1 };
}

async function submit(connection, transaction, signers) {
  transaction.feePayer = signers[0].publicKey;
  return sendAndConfirmTransaction(connection, transaction, signers, {
    commitment: "confirmed",
    preflightCommitment: "confirmed",
    maxRetries: 5,
  });
}

function deriveKeypair(secret, label, teamId, eventNonce) {
  const seed = crypto.createHmac("sha256", secret).update(`player-two:devnet:v1:${label}:${teamId}:${eventNonce}`).digest();
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

export function explorerTransaction(signature) {
  return `https://explorer.solana.com/tx/${encodeURIComponent(signature)}?cluster=devnet`;
}
