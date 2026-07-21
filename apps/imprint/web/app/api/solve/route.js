import crypto from "node:crypto";
import { cookies } from "next/headers";
import { Connection, PublicKey } from "@solana/web3.js";
import { sha256 } from "@noble/hashes/sha256";
import { reportSolveEventBestEffort } from "@ctf26/leaderboard";

import {
  IMPRINT_SESSION_COOKIE,
  verifyChallengeSession,
} from "@/lib/challenge-session.mjs";
import { credentialForParticipant } from "@/lib/credential-roster.mjs";
import { PROGRAM_ID } from "@/lib/registrar.mjs";
import {
  claimedPasskeyOwner,
  qualifyingImprintDrain,
} from "@/lib/solve-verifier.mjs";
import { eventTargetForParticipant } from "@/lib/target-config.mjs";
import { recordImprintIntegrity } from "@/lib/integrity-events.mjs";
import {
  consumeImprintRequestBudget,
  imprintRequestErrorResponse,
  readBoundedJson,
} from "@/lib/request-budget.mjs";

export const runtime = "nodejs";

function flagSecret() {
  const value = process.env.IMPRINT_FLAG_SECRET;
  if (typeof value !== "string" || Buffer.byteLength(value) < 32) {
    throw new Error("IMPRINT_FLAG_SECRET must contain at least 32 bytes");
  }
  return value;
}

function rpcUrl() {
  return process.env.SOLANA_RPC_URL || "http://127.0.0.1:8899";
}

export async function POST(request) {
  try {
    const jar = await cookies();
    const session = verifyChallengeSession(
      jar.get(IMPRINT_SESSION_COOKIE)?.value
    );
    await consumeImprintRequestBudget("solve", {
      request,
      participantId: session.participantId,
    });
    await recordImprintIntegrity(
      session,
      "solve-submitted",
      "scored-action",
      request
    );
    const body = await readBoundedJson(request, 4 * 1024);
    const signature =
      typeof body.signature === "string" ? body.signature.trim() : "";
    if (!/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(signature)) {
      throw new Error("a Solana transaction signature is required");
    }

    const credential = credentialForParticipant(session.participantId);
    const passkeySeed = Buffer.from(sha256(credential.passkeyPubkey));
    const [passkey] = PublicKey.findProgramAddressSync(
      [Buffer.from("passkey"), passkeySeed],
      PROGRAM_ID
    );
    const target = eventTargetForParticipant(session.participantId);
    const connection = new Connection(rpcUrl(), "finalized");
    const [passkeyInfo, vaultInfo, transaction] = await Promise.all([
      connection.getAccountInfo(passkey, "finalized"),
      connection.getAccountInfo(target.vault, "finalized"),
      connection.getTransaction(signature, {
        commitment: "finalized",
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
    const blockTime = Number.isSafeInteger(transaction?.blockTime)
      ? transaction.blockTime
      : await connection.getBlockTime(transaction.slot, "finalized");
    if (!Number.isSafeInteger(blockTime)) {
      throw new Error("submitted transaction time could not be verified");
    }

    const scoreDelivery = await reportSolveEventBestEffort({
      url: process.env.LEADERBOARD_INGEST_URL,
      secret: process.env.CHALLENGE_TICKET_SECRET,
      challenge: "imprint",
      eventId: session.eventId,
      participantId: session.participantId,
      sourceId: signature,
      occurredAt: new Date(blockTime * 1_000).toISOString(),
      timeoutMs: 1_500,
    });
    if (process.env.NODE_ENV === "production" && scoreDelivery?.reported !== true) {
      return new Response(
        "solve verified, but scoring is temporarily unavailable; resubmit this signature",
        { status: 503 }
      );
    }
    await recordImprintIntegrity(
      session,
      "solve-completed",
      "completion",
      request
    );

    const digest = crypto
      .createHmac("sha256", flagSecret())
      .update(`${session.participantId}:${target.vault.toString()}`)
      .digest("hex")
      .slice(0, 24);
    return Response.json({
      ok: true,
      flag: `CTF26{imprint_${digest}}`,
      transactionDrain: transactionDrain.toString(),
    });
  } catch (error) {
    const controlled = imprintRequestErrorResponse(error);
    if (controlled) return controlled;
    return new Response(error.message || "solve verification failed", {
      status: 403,
    });
  }
}
