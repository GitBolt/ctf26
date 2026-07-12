import crypto from "node:crypto";
import { cookies } from "next/headers";
import { Connection, PublicKey } from "@solana/web3.js";
import { sha256 } from "@noble/hashes/sha256";

import {
  IMPRINT_SESSION_COOKIE,
  verifyChallengeSession,
} from "@/lib/challenge-session.mjs";
import { credentialForTeam } from "@/lib/credential-roster.mjs";
import { PROGRAM_ID } from "@/lib/registrar.mjs";
import {
  claimedPasskeyOwner,
  qualifyingImprintDrain,
} from "@/lib/solve-verifier.mjs";
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

export async function POST(request) {
  try {
    const jar = await cookies();
    const session = verifyChallengeSession(
      jar.get(IMPRINT_SESSION_COOKIE)?.value
    );
    const body = await request.json();
    const signature =
      typeof body.signature === "string" ? body.signature.trim() : "";
    if (!/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(signature)) {
      throw new Error("a Solana transaction signature is required");
    }

    const credential = credentialForTeam(session.teamId);
    const passkeySeed = Buffer.from(sha256(credential.passkeyPubkey));
    const [passkey] = PublicKey.findProgramAddressSync(
      [Buffer.from("passkey"), passkeySeed],
      PROGRAM_ID
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
    const owner = claimedPasskeyOwner(
      passkeyInfo,
      PROGRAM_ID,
      credential.passkeyPubkey
    );
    if (!vaultInfo || vaultInfo.owner.toString() !== PROGRAM_ID.toString()) {
      throw new Error(
        "configured target vault is missing or belongs to another program"
      );
    }
    const transactionDrain = qualifyingImprintDrain({
      transaction,
      programId: PROGRAM_ID,
      targetVault: target.vault,
      passkey,
      owner,
      minimumDrainLamports: target.minimumDrainLamports,
    });

    const digest = crypto
      .createHmac("sha256", flagSecret())
      .update(`${session.teamId}:${target.vault.toString()}`)
      .digest("hex")
      .slice(0, 24);
    return Response.json({
      ok: true,
      flag: `CTF26{imprint_${digest}}`,
      transactionDrain: transactionDrain.toString(),
    });
  } catch (error) {
    return new Response(error.message || "solve verification failed", {
      status: 403,
    });
  }
}
