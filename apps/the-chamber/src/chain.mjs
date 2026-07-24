import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";

// Anchor derives these from the instruction and account names, not from the
// program ID, so they are stable across redeploys: sha256("global:create_user")
// and sha256("account:User"), first eight bytes.
const CREATE_USER_DISCRIMINATOR = Uint8Array.from([108, 227, 130, 130, 252, 109, 75, 218]);
const USER_DISCRIMINATOR = Uint8Array.from([159, 117, 95, 227, 239, 151, 58, 236]);
const USER_SEED = Buffer.from("user");

// 8 discriminator + 32 owner + 1 bump + 4 lock booleans.
export const USER_ACCOUNT_BYTES = 45;
const LOCK_OFFSETS = Object.freeze({ first: 41, second: 42, third: 43 });

const CONFIRM_ATTEMPTS = 25;
const CONFIRM_INTERVAL_MS = 1_000;

export function deriveUserPda(programId, wallet) {
  return PublicKey.findProgramAddressSync([USER_SEED, wallet.toBuffer()], programId)[0];
}

/**
 * Builds `create_user`. Account order and flags follow the program's CreateUser
 * context: admin (signer, writable), user (read only), user_account PDA
 * (writable), system_program.
 */
export function buildCreateUserIx(programId, admin, wallet, userPda) {
  return new TransactionInstruction({
    programId,
    keys: [
      { pubkey: admin, isSigner: true, isWritable: true },
      { pubkey: wallet, isSigner: false, isWritable: false },
      { pubkey: userPda, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.from(CREATE_USER_DISCRIMINATOR),
  });
}

/**
 * Decodes the three lock booleans from a raw User account.
 *
 * The account also carries a `chamber_open` byte at offset 44, but the deployed
 * program only ever writes it false — it is set at creation and never touched
 * again. Reading it would mean no participant ever scores, so the open chamber
 * is derived from the three locks instead. Do not switch to the stored byte
 * without redeploying a program that actually writes it.
 */
export function decodeLocks(data) {
  if (!data || data.length < USER_ACCOUNT_BYTES) return null;
  for (let index = 0; index < USER_DISCRIMINATOR.length; index += 1) {
    if (data[index] !== USER_DISCRIMINATOR[index]) return null;
  }
  const firstUnlock = data[LOCK_OFFSETS.first] === 1;
  const secondUnlock = data[LOCK_OFFSETS.second] === 1;
  const thirdUnlock = data[LOCK_OFFSETS.third] === 1;
  return Object.freeze({
    firstUnlock,
    secondUnlock,
    thirdUnlock,
    chamberOpen: firstUnlock && secondUnlock && thirdUnlock,
  });
}

export function parseWallet(input) {
  if (typeof input !== "string") return null;
  const trimmed = input.trim();
  // A base58 Solana address is at most 44 characters. Reject anything longer
  // before decoding so an oversized string cannot burn CPU in the decoder.
  if (!trimmed || trimmed.length > 44) return null;
  let key;
  try {
    key = new PublicKey(trimmed);
  } catch {
    return null;
  }
  // Reject addresses that lie on the ed25519 curve's off-curve set: a PDA can
  // never sign, so it could never turn lock one.
  return PublicKey.isOnCurve(key.toBytes()) ? key : null;
}

function loadKeypair(secret, name) {
  let bytes;
  try {
    bytes = Uint8Array.from(JSON.parse(String(secret).trim()));
  } catch {
    throw new Error(`${name} must be a JSON array of secret key bytes`);
  }
  try {
    return Keypair.fromSecretKey(bytes);
  } catch {
    throw new Error(`${name} is not a valid Solana keypair`);
  }
}

export function createChamberChain(env = process.env) {
  const production = env.NODE_ENV === "production";
  const rpcUrl = String(env.SOLANA_RPC_URL || "").trim();
  const programIdValue = String(env.THE_CHAMBER_PROGRAM_ID || "").trim();
  const adminSecret = String(env.THE_CHAMBER_ADMIN_KEYPAIR || "").trim();
  if (production) {
    if (!rpcUrl) throw new Error("SOLANA_RPC_URL is required in production");
    if (!programIdValue) throw new Error("THE_CHAMBER_PROGRAM_ID is required in production");
    if (!adminSecret) throw new Error("THE_CHAMBER_ADMIN_KEYPAIR is required in production");
  }
  if (!programIdValue || !adminSecret) {
    throw new Error("THE_CHAMBER_PROGRAM_ID and THE_CHAMBER_ADMIN_KEYPAIR must be configured");
  }

  const programId = new PublicKey(programIdValue);
  const admin = loadKeypair(adminSecret, "THE_CHAMBER_ADMIN_KEYPAIR");
  const network = String(env.THE_CHAMBER_NETWORK || "devnet").trim();
  const rentLamports = positiveInteger(env.THE_CHAMBER_RENT_LAMPORTS ?? 2_408_160, "THE_CHAMBER_RENT_LAMPORTS");
  const feeBudgetLamports = positiveInteger(env.THE_CHAMBER_FEE_BUDGET_LAMPORTS ?? 10_000, "THE_CHAMBER_FEE_BUDGET_LAMPORTS");
  const connection = new Connection(rpcUrl || "http://127.0.0.1:8899", "confirmed");

  async function sendAndConfirm(instruction) {
    const { blockhash } = await connection.getLatestBlockhash("confirmed");
    const transaction = new Transaction().add(instruction);
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = admin.publicKey;
    transaction.sign(admin);

    const signature = await connection.sendRawTransaction(transaction.serialize(), {
      skipPreflight: false,
      preflightCommitment: "confirmed",
      maxRetries: 5,
    });
    // Poll over HTTP rather than subscribing: the service runs single-replica
    // behind a proxy and a websocket subscription adds a failure mode without
    // making confirmation any faster.
    for (let attempt = 0; attempt < CONFIRM_ATTEMPTS; attempt += 1) {
      const { value } = await connection.getSignatureStatuses([signature]);
      const status = value[0];
      if (status?.err) throw new Error(`create_user failed: ${JSON.stringify(status.err)}`);
      if (status?.confirmationStatus === "confirmed" || status?.confirmationStatus === "finalized") {
        return signature;
      }
      await new Promise((resolve) => setTimeout(resolve, CONFIRM_INTERVAL_MS));
    }
    throw new Error("timed out waiting for create_user confirmation");
  }

  return {
    network,
    programId: programId.toBase58(),
    adminPublicKey: admin.publicKey.toBase58(),
    derive(wallet) {
      return deriveUserPda(programId, new PublicKey(wallet)).toBase58();
    },
    async readLocks(wallet) {
      const pda = deriveUserPda(programId, new PublicKey(wallet));
      const info = await connection.getAccountInfo(pda, "confirmed");
      return decodeLocks(info?.data || null);
    },
    /**
     * The finalized block time of the transaction that last wrote the PDA, used
     * as the solve time so scoring reflects when the chamber actually opened
     * rather than when the service happened to notice.
     *
     * Returns null when the RPC has pruned that history, and the caller then
     * falls back to the observation time. That fallback only ever makes a solve
     * look slower than it was, so it can under-flag fast-solve review but never
     * manufacture a false one. A provider with short signature retention degrades
     * this silently — prefer one that keeps at least the event window.
     */
    async openedAt(wallet) {
      const pda = deriveUserPda(programId, new PublicKey(wallet));
      const [latest] = await connection.getSignaturesForAddress(pda, { limit: 1 }, "finalized");
      return latest?.blockTime ? new Date(latest.blockTime * 1_000).toISOString() : null;
    },
    /**
     * Admin-signs `create_user` for a participant's wallet. Returns the PDA even
     * when confirmation times out but the account is already on chain, so a
     * retry never double-charges rent or strands a participant.
     */
    async provision(wallet) {
      const walletKey = new PublicKey(wallet);
      const pda = deriveUserPda(programId, walletKey);
      const existing = await connection.getAccountInfo(pda, "confirmed");
      if (decodeLocks(existing?.data || null)) {
        return { pda: pda.toBase58(), signature: null, recovered: true };
      }
      const instruction = buildCreateUserIx(programId, admin.publicKey, walletKey, pda);
      try {
        const signature = await sendAndConfirm(instruction);
        return { pda: pda.toBase58(), signature, recovered: false };
      } catch (error) {
        // Never reflect raw RPC text to a participant: it can carry the keyed
        // provider URL or the provider's response body. Ask the chain instead.
        console.error("THE CHAMBER create_user error:", error.message);
        const landed = await connection.getAccountInfo(pda, "confirmed").catch(() => null);
        if (decodeLocks(landed?.data || null)) {
          return { pda: pda.toBase58(), signature: null, recovered: true };
        }
        throw new Error("the chamber could not open an account for that wallet");
      }
    },
    async health({ remainingParticipants = 0 } = {}) {
      const [programInfo, payerLamports] = await Promise.all([
        connection.getAccountInfo(programId, "confirmed"),
        connection.getBalance(admin.publicKey, "confirmed"),
      ]);
      const programAvailable = Boolean(programInfo?.executable);
      const requiredPayerBalance = remainingParticipants * (rentLamports + feeBudgetLamports);
      const capacitySufficient = payerLamports >= requiredPayerBalance;
      return {
        ok: programAvailable && capacitySufficient,
        programAvailable,
        capacitySufficient,
        payer: admin.publicKey.toBase58(),
        payerLamports,
        requiredPayerBalance,
        rentLamportsPerParticipant: rentLamports,
      };
    },
  };
}

function positiveInteger(value, name) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) throw new Error(`${name} must be a positive integer`);
  return number;
}
