import * as anchor from "@coral-xyz/anchor";
import { cookies } from "next/headers";
import {
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import {
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import { sha256 } from "@noble/hashes/sha256";

import idl from "@/lib/imprint-idl.json";
import {
  IMPRINT_SESSION_COOKIE,
  verifyChallengeSession,
} from "@/lib/challenge-session.mjs";
import { compressedP256FromCOSE } from "@/lib/credential-roster.mjs";
import { enforcePlatformEnrollment } from "@/lib/enrollment-policy.mjs";
import { PROGRAM_ID, loadRegistrar } from "@/lib/registrar.mjs";
import { claimedPasskeyOwner } from "@/lib/solve-verifier.mjs";
import {
  expectedWebAuthnOrigin,
  expectedWebAuthnRpID,
} from "@/lib/webauthn-config.mjs";
import { CLAIM_CHALLENGE_COOKIE, CLAIM_MODE_COOKIE } from "./options/route";
import { recordImprintIntegrity } from "@/lib/integrity-events.mjs";
import { imprintStateStore } from "@/lib/state-store.mjs";
import {
  consumeImprintRequestBudget,
  imprintRequestErrorResponse,
  readBoundedJson,
} from "@/lib/request-budget.mjs";

export const runtime = "nodejs";
const PASSKEY_ACCOUNT_SIZE = 8 + 32 + 33 + 32 + 1 + 1;

function rpcUrl() {
  return process.env.SOLANA_RPC_URL || "http://127.0.0.1:8899";
}

export async function POST(request) {
  const jar = await cookies();
  try {
    const session = verifyChallengeSession(
      jar.get(IMPRINT_SESSION_COOKIE)?.value
    );
    await consumeImprintRequestBudget("passkeyClaim", {
      request,
      participantId: session.participantId,
    });
    await recordImprintIntegrity(
      session,
      "passkey-claim-started",
      "challenge-action",
      request
    );
    const expectedChallenge = jar.get(CLAIM_CHALLENGE_COOKIE)?.value;
    const claimMode = jar.get(CLAIM_MODE_COOKIE)?.value;
    if (!expectedChallenge)
      throw new Error("security-key claim challenge is missing or expired");
    if (claimMode !== "register" && claimMode !== "authenticate") {
      throw new Error("security-key claim mode is missing or expired");
    }

    const { owner, response } = await readBoundedJson(request, 64 * 1024);
    if (response?.authenticatorAttachment !== "platform") {
      throw new Error(
        "claim requires the enrolled platform authenticator on this device"
      );
    }
    const store = await imprintStateStore();
    let credential = await store.credentialForParticipant(
      session.participantId
    );
    if (claimMode === "register") {
      if (credential) {
        throw new Error("this participant already has an IMPRINT passkey");
      }
      const verification = await verifyRegistrationResponse({
        response,
        expectedChallenge,
        expectedOrigin: expectedWebAuthnOrigin(request),
        expectedRPID: expectedWebAuthnRpID(request),
        requireUserPresence: true,
        requireUserVerification: true,
        supportedAlgorithmIDs: [-7],
      });
      if (!verification.verified) {
        throw new Error("platform passkey registration was not verified");
      }
      enforcePlatformEnrollment(verification.registrationInfo, response);
      const registered = verification.registrationInfo.credential;
      const publicKey = compressedP256FromCOSE(registered.publicKey);
      credential = await store.saveCredential(session.participantId, {
        participantId: session.participantId,
        credentialId: registered.id,
        credentialPublicKeyCoseBase64: Buffer.from(
          registered.publicKey
        ).toString("base64url"),
        counter: registered.counter,
        transports: registered.transports,
      });
      if (!credential.passkeyPubkey.equals(publicKey)) {
        throw new Error(
          "stored passkey does not match the verified credential"
        );
      }
    } else {
      if (!credential) {
        throw new Error("this participant has not created an IMPRINT passkey");
      }
      const verification = await verifyAuthenticationResponse({
        response,
        expectedChallenge,
        expectedOrigin: expectedWebAuthnOrigin(request),
        expectedRPID: expectedWebAuthnRpID(request),
        requireUserVerification: true,
        credential: {
          id: credential.credentialId,
          publicKey: credential.cosePublicKey,
          counter: credential.counter,
          transports: credential.transports,
        },
      });
      if (!verification.verified) {
        throw new Error("platform passkey assertion was not verified");
      }
    }
    const ownerPubkey = new PublicKey(owner);
    const passkeySeed = Buffer.from(sha256(credential.passkeyPubkey));
    const [passkey] = PublicKey.findProgramAddressSync(
      [Buffer.from("passkey"), passkeySeed],
      PROGRAM_ID
    );
    const connection = new Connection(rpcUrl(), "confirmed");
    const existingPasskey = await connection.getAccountInfo(
      passkey,
      "confirmed"
    );
    if (existingPasskey) {
      const existingOwner = claimedPasskeyOwner(
        existingPasskey,
        PROGRAM_ID,
        credential.passkeyPubkey
      );
      if (!existingOwner.equals(ownerPubkey)) {
        throw new Error(
          "this event security key is already claimed by a different wallet"
        );
      }
      jar.delete(CLAIM_CHALLENGE_COOKIE);
      jar.delete(CLAIM_MODE_COOKIE);
      return Response.json({
        alreadyRegistered: true,
        credentialId: credential.credentialId,
        passkeyPubkey: credential.passkeyPubkey.toString("hex"),
      });
    }

    const registrar = loadRegistrar();
    const provider = new anchor.AnchorProvider(connection, {
      publicKey: registrar.publicKey,
      signTransaction: async (tx) => {
        tx.partialSign(registrar);
        return tx;
      },
      signAllTransactions: async (txs) => {
        txs.forEach((tx) => tx.partialSign(registrar));
        return txs;
      },
    });
    const program = new anchor.Program(idl, provider);
    const rpIDHash = Buffer.from(
      sha256(Buffer.from(expectedWebAuthnRpID(request), "utf8"))
    );
    const ix = await program.methods
      .registerPasskey(
        Array.from(passkeySeed),
        Array.from(credential.passkeyPubkey),
        Array.from(rpIDHash)
      )
      .accounts({ owner: ownerPubkey, registrar: registrar.publicKey, passkey })
      .instruction();
    const { blockhash, lastValidBlockHeight } =
      await connection.getLatestBlockhash("confirmed");
    const [ownerBalance, passkeyRent] = await Promise.all([
      connection.getBalance(ownerPubkey, "confirmed"),
      connection.getMinimumBalanceForRentExemption(
        PASSKEY_ACCOUNT_SIZE,
        "confirmed"
      ),
    ]);
    const tx = new Transaction({
      feePayer: registrar.publicKey,
      blockhash,
      lastValidBlockHeight,
    });
    if (ownerBalance < passkeyRent) {
      tx.add(
        SystemProgram.transfer({
          fromPubkey: registrar.publicKey,
          toPubkey: ownerPubkey,
          lamports: passkeyRent - ownerBalance,
        })
      );
    }
    tx.add(ix);
    tx.partialSign(registrar);
    jar.delete(CLAIM_CHALLENGE_COOKIE);
    jar.delete(CLAIM_MODE_COOKIE);
    return Response.json({
      transaction: tx
        .serialize({ requireAllSignatures: false })
        .toString("base64"),
      blockhash,
      lastValidBlockHeight,
      credentialId: credential.credentialId,
      passkeyPubkey: credential.passkeyPubkey.toString("hex"),
    });
  } catch (error) {
    const controlled = imprintRequestErrorResponse(error);
    if (controlled) return controlled;
    return new Response(error.message || "security-key claim was denied", {
      status: 403,
    });
  }
}
