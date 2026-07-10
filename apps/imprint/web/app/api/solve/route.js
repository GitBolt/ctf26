import crypto from "node:crypto";
import { cookies } from "next/headers";
import { Connection, PublicKey } from "@solana/web3.js";
import { sha256 } from "@noble/hashes/sha256";

import { IMPRINT_SESSION_COOKIE, verifyChallengeSession } from "@/lib/challenge-session.mjs";
import { credentialForTeam } from "@/lib/credential-roster.mjs";
import { PROGRAM_ID } from "@/lib/registrar.mjs";
import { eventTarget } from "@/lib/target-config.mjs";

export const runtime = "nodejs";

function flagSecret() {
  const value = process.env.IMPRINT_FLAG_SECRET;
  if (typeof value !== "string" || Buffer.byteLength(value) < 32) {
    throw new Error("IMPRINT_FLAG_SECRET must contain at least 32 bytes");
  }
  return value;
}

function rpcUrl() {
  return process.env.NEXT_PUBLIC_RPC_URL || "http://127.0.0.1:8899";
}

function staticAccountKeys(transaction) {
  const message = transaction.transaction.message;
  return message.staticAccountKeys || message.accountKeys || [];
}

function accountKeyText(key) {
  return (key.pubkey || key).toString();
}

function passkeyOwner(accountInfo, expectedPasskeyPubkey) {
  if (!accountInfo || accountInfo.owner.toString() !== PROGRAM_ID.toString()) {
    throw new Error("the claimed event security key is not an IMPRINT passkey account");
  }
  // Anchor account discriminator (8 bytes), followed by the passkey owner's Pubkey (32 bytes).
  if (accountInfo.data.length < 73) throw new Error("event security-key account data is malformed");
  if (!accountInfo.data.subarray(40, 73).equals(expectedPasskeyPubkey)) {
    throw new Error("event security-key account does not match the assigned hardware key");
  }
  return new PublicKey(accountInfo.data.subarray(8, 40));
}

export async function POST(request) {
  try {
    const jar = await cookies();
    const session = verifyChallengeSession(jar.get(IMPRINT_SESSION_COOKIE)?.value);
    const { signature } = await request.json();
    if (typeof signature !== "string" || signature.length < 32 || signature.length > 128) {
      throw new Error("a Solana transaction signature is required");
    }

    const credential = credentialForTeam(session.teamId);
    const passkeySeed = Buffer.from(sha256(credential.passkeyPubkey));
    const [passkey] = PublicKey.findProgramAddressSync(
      [Buffer.from("passkey"), passkeySeed],
      PROGRAM_ID,
    );
    const target = eventTarget();
    const connection = new Connection(rpcUrl(), "confirmed");
    const [passkeyInfo, vaultInfo, transaction] = await Promise.all([
      connection.getAccountInfo(passkey, "confirmed"),
      connection.getAccountInfo(target.vault, "confirmed"),
      connection.getTransaction(signature, {
        commitment: "confirmed",
        maxSupportedTransactionVersion: 0,
      }),
    ]);
    const owner = passkeyOwner(passkeyInfo, credential.passkeyPubkey);
    if (!vaultInfo || vaultInfo.owner.toString() !== PROGRAM_ID.toString()) {
      throw new Error("configured target vault is missing or belongs to another program");
    }
    if (!transaction || transaction.meta?.err) {
      throw new Error("submitted transaction was not confirmed successfully");
    }
    const accountKeys = staticAccountKeys(transaction);
    const accountSet = new Set(accountKeys.map(accountKeyText));
    if (!accountSet.has(PROGRAM_ID.toString()) || !accountSet.has(target.vault.toString())) {
      throw new Error("submitted transaction did not address the configured IMPRINT target");
    }
    const signerCount = transaction.transaction.message.header?.numRequiredSignatures ?? 0;
    const signerKeys = accountKeys.slice(0, signerCount);
    if (!signerKeys.some((key) => accountKeyText(key) === owner.toString())) {
      throw new Error("submitted transaction was not signed by this team's claimed key owner");
    }

    const currentLamports = BigInt(vaultInfo.lamports);
    const netDrain = target.initialLamports > currentLamports
      ? target.initialLamports - currentLamports
      : 0n;
    if (netDrain < target.minimumDrainLamports) {
      throw new Error("the canonical target has not been drained far enough");
    }

    const digest = crypto
      .createHmac("sha256", flagSecret())
      .update(`${session.teamId}:${target.vault.toString()}:${signature}:${netDrain.toString()}`)
      .digest("hex")
      .slice(0, 24);
    return Response.json({ ok: true, flag: `CTF26{imprint_${digest}}`, netDrain: netDrain.toString() });
  } catch (error) {
    return new Response(error.message || "solve verification failed", { status: 403 });
  }
}
