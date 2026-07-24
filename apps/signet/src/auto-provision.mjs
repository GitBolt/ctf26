import crypto from "node:crypto";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  ACCOUNT_SIZE,
  AuthorityType,
  MINT_SIZE,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  createInitializeMintInstruction,
  createMintToInstruction,
  createSetAuthorityInstruction,
  getAccount,
  getAssociatedTokenAddressSync,
  getMint,
} from "@solana/spl-token";

import { createInstancePlan } from "./provisioning.mjs";
import { redisCommand, signetRedisKey } from "./redis.mjs";
import { createTargetInventory, validateTarget } from "./targets.mjs";

const INITIALIZE_DISCRIMINATOR = Buffer.from([175, 175, 109, 31, 13, 152, 155, 237]);
const BUILD_FINGERPRINT = crypto.createHash("sha256").update("quarry-vault:8d17c2e-pre-refactor").digest("hex").slice(0, 16);
const VAULT_ACCOUNT_SIZE = 122;

function required(env, name, minimumBytes = 1) {
  const value = String(env[name] || "");
  if (Buffer.byteLength(value) < minimumBytes) throw new Error(`${name} is missing or weak`);
  return value;
}

function operatorFromEnvironment(env) {
  let bytes;
  try {
    bytes = JSON.parse(required(env, "SIGNET_OPERATOR_KEYPAIR_JSON", 64));
  } catch {
    throw new Error("SIGNET_OPERATOR_KEYPAIR_JSON is invalid");
  }
  if (!Array.isArray(bytes) || bytes.length !== 64) throw new Error("SIGNET_OPERATOR_KEYPAIR_JSON is invalid");
  return Keypair.fromSecretKey(Uint8Array.from(bytes));
}

function productionInteger(env, name, fallback, minimum = 0) {
  const encoded = String(env[name] ?? "").trim();
  if (env.NODE_ENV === "production" && !encoded) throw new Error(`${name} is required in production`);
  const value = Number(encoded || fallback);
  if (!Number.isSafeInteger(value) || value < minimum) throw new Error(`${name} must be an integer of at least ${minimum}`);
  return value;
}

export async function participantProvisionCapacity(provisionedParticipants, { env = process.env } = {}) {
  if (!Number.isSafeInteger(provisionedParticipants) || provisionedParticipants < 0) {
    throw new Error("SIGNET provisioned participant count is invalid");
  }
  const expectedParticipants = productionInteger(env, "SIGNET_EXPECTED_PARTICIPANTS", 40, 1);
  const minimumOperatorLamports = productionInteger(env, "SIGNET_MIN_OPERATOR_LAMPORTS", 100_000_000, 1);
  const feeBufferLamportsPerParticipant = productionInteger(env, "SIGNET_PROVISION_FEE_BUFFER_LAMPORTS", 150_000, 1);
  const operator = operatorFromEnvironment(env);
  const connection = new Connection(required(env, "SOLANA_RPC_URL"), "confirmed");
  const [operatorBalance, mintRent, vaultRent, tokenAccountRent] = await Promise.all([
    connection.getBalance(operator.publicKey, "confirmed"),
    connection.getMinimumBalanceForRentExemption(MINT_SIZE, "confirmed"),
    connection.getMinimumBalanceForRentExemption(VAULT_ACCOUNT_SIZE, "confirmed"),
    connection.getMinimumBalanceForRentExemption(ACCOUNT_SIZE, "confirmed"),
  ]);
  const remainingParticipants = Math.max(0, expectedParticipants - provisionedParticipants);
  const rentLamportsPerParticipant = mintRent + vaultRent + (2 * tokenAccountRent);
  const requiredBalance = minimumOperatorLamports
    + (remainingParticipants * (rentLamportsPerParticipant + feeBufferLamportsPerParticipant));
  if (!Number.isSafeInteger(requiredBalance)) throw new Error("SIGNET capacity exceeds the safe integer range");
  return {
    sufficient: provisionedParticipants <= expectedParticipants && operatorBalance >= requiredBalance,
    payer: operator.publicKey.toBase58(),
    balance: operatorBalance,
    requiredBalance,
    expectedParticipants,
    provisionedParticipants,
    remainingParticipants,
    rentLamportsPerParticipant,
    feeBufferLamportsPerParticipant,
    minimumOperatorLamports,
  };
}

function deterministicMint(participantId, secret) {
  const seed = crypto.createHmac("sha256", secret).update(`ctf26:signet:mint:${participantId}`).digest().subarray(0, 32);
  return Keypair.fromSeed(seed);
}

async function accountExists(connection, address) {
  return Boolean(await connection.getAccountInfo(address, "confirmed"));
}

async function send(connection, operator, instructions, signers = []) {
  if (instructions.length === 0) return null;
  return sendAndConfirmTransaction(connection, new Transaction().add(...instructions), [operator, ...signers], {
    commitment: "confirmed",
    preflightCommitment: "confirmed",
  });
}

export async function provisionParticipantTarget(participantId, { env = process.env } = {}) {
  const instanceSecret = required(env, "INSTANCE_SECRET", 32);
  const operator = operatorFromEnvironment(env);
  const programId = new PublicKey(required(env, "VAULT_PROGRAM_ID"));
  const connection = new Connection(required(env, "SOLANA_RPC_URL"), "confirmed");
  const plan = createInstancePlan(participantId, instanceSecret);
  const mint = deterministicMint(participantId, instanceSecret);
  const [vault] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), operator.publicKey.toBuffer(), plan.participantSeed],
    programId,
  );
  const [vaultAuthority] = PublicKey.findProgramAddressSync([Buffer.from("vault-authority"), vault.toBuffer()], programId);
  const [reserve] = PublicKey.findProgramAddressSync([Buffer.from("reserve"), vault.toBuffer()], programId);
  const escrow = getAssociatedTokenAddressSync(mint.publicKey, vaultAuthority, true);

  if (!(await accountExists(connection, mint.publicKey))) {
    const rent = await connection.getMinimumBalanceForRentExemption(MINT_SIZE);
    await send(connection, operator, [
      SystemProgram.createAccount({
        fromPubkey: operator.publicKey,
        newAccountPubkey: mint.publicKey,
        lamports: rent,
        space: MINT_SIZE,
        programId: TOKEN_PROGRAM_ID,
      }),
      createInitializeMintInstruction(mint.publicKey, 0, operator.publicKey, null),
    ], [mint]);
  }

  if (!(await accountExists(connection, vault))) {
    const data = Buffer.concat([
      INITIALIZE_DISCRIMINATOR,
      plan.participantSeed,
      SystemProgram.programId.toBuffer(),
    ]);
    await send(connection, operator, [new TransactionInstruction({
      programId,
      keys: [
        { pubkey: operator.publicKey, isSigner: true, isWritable: true },
        { pubkey: mint.publicKey, isSigner: false, isWritable: false },
        { pubkey: vault, isSigner: false, isWritable: true },
        { pubkey: vaultAuthority, isSigner: false, isWritable: false },
        { pubkey: reserve, isSigner: false, isWritable: true },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
      ],
      data,
    })]);
  }

  if (!(await accountExists(connection, escrow))) {
    await send(connection, operator, [
      createAssociatedTokenAccountInstruction(operator.publicKey, escrow, vaultAuthority, mint.publicKey),
    ]);
  }

  const reserveState = await getAccount(connection, reserve, "confirmed");
  const mintState = await getMint(connection, mint.publicKey, "confirmed");
  if (reserveState.amount === 0n && mintState.mintAuthority?.equals(operator.publicKey)) {
    await send(connection, operator, [
      createMintToInstruction(mint.publicKey, reserve, operator.publicKey, plan.reserveRaw),
      createSetAuthorityInstruction(mint.publicKey, operator.publicKey, AuthorityType.MintTokens, null),
    ]);
  } else if (reserveState.amount !== plan.reserveRaw || mintState.mintAuthority !== null) {
    throw new Error("Existing SIGNET instance is not in its canonical initial state");
  }

  return validateTarget({
    instanceId: plan.instanceId,
    programId: programId.toBase58(),
    vaultAccount: vault.toBase58(),
    vaultAuthority: vaultAuthority.toBase58(),
    reserveAccount: reserve.toBase58(),
    escrowAccount: escrow.toBase58(),
    mint: mint.publicKey.toBase58(),
    escrowAuthority: vaultAuthority.toBase58(),
    buildFingerprint: BUILD_FINGERPRINT,
    thresholdRaw: plan.thresholdRaw.toString(),
    initialReserveRaw: plan.reserveRaw.toString(),
    initialEscrowRaw: "0",
    decimals: 0,
    cluster: env.SOLANA_CLUSTER || "devnet",
    tokenSymbol: "QRY",
  }, participantId);
}

async function storedTarget(participantId, options) {
  const env = options.env || process.env;
  const value = await (options.redisCommandImpl || redisCommand)(["GET", signetRedisKey("target", participantId, env)], options);
  if (typeof value !== "string") return null;
  return validateTarget(JSON.parse(value), participantId);
}

async function publishDynamicTarget(participantId, target, options) {
  const env = options.env || process.env;
  const command = options.redisCommandImpl || redisCommand;
  const lockKey = signetRedisKey("target-inventory-lock", undefined, env);
  const token = crypto.randomUUID();
  if (await command(["SET", lockKey, token, "NX", "EX", "30"], options) !== "OK") {
    throw new Error("SIGNET target inventory is busy");
  }
  try {
    const participantsKey = signetRedisKey("target-participants", undefined, env);
    const existing = await command(["SMEMBERS", participantsKey], options);
    const participants = [...new Set([...(Array.isArray(existing) ? existing : []), participantId])].sort();
    const inventory = createTargetInventory(participants, { env });
    const script = [
      "redis.call('SADD',KEYS[1],ARGV[1]);",
      "redis.call('SET',KEYS[2],ARGV[2]);",
      "redis.call('SET',KEYS[3],ARGV[3]);",
      "return 1",
    ].join(" ");
    await command([
      "EVAL", script, "3", participantsKey, signetRedisKey("target", participantId, env),
      signetRedisKey("target-inventory", undefined, env), participantId, JSON.stringify(target), JSON.stringify(inventory),
    ], options);
    return target;
  } finally {
    const release = "if redis.call('GET',KEYS[1])==ARGV[1] then return redis.call('DEL',KEYS[1]) else return 0 end";
    await command(["EVAL", release, "1", lockKey, token], options).catch(() => {});
  }
}

export async function ensureParticipantTarget(participantId, options = {}) {
  const env = options.env || process.env;
  const existing = await storedTarget(participantId, options);
  if (existing) return existing;
  const command = options.redisCommandImpl || redisCommand;
  const lockKey = signetRedisKey("provision-lock", participantId, env);
  const token = crypto.randomUUID();
  if (await command(["SET", lockKey, token, "NX", "EX", "120"], options) !== "OK") {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      const target = await storedTarget(participantId, options);
      if (target) return target;
    }
    throw new Error("SIGNET provisioning is still in progress");
  }
  try {
    const target = await (options.provisionImpl || provisionParticipantTarget)(participantId, { env });
    return await publishDynamicTarget(participantId, target, options);
  } finally {
    const release = "if redis.call('GET',KEYS[1])==ARGV[1] then return redis.call('DEL',KEYS[1]) else return 0 end";
    await command(["EVAL", release, "1", lockKey, token], options).catch(() => {});
  }
}
