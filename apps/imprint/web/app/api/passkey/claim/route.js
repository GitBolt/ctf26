import * as anchor from "@coral-xyz/anchor";
import { cookies } from "next/headers";
import { verifyAuthenticationResponse } from "@simplewebauthn/server";
import { Connection, PublicKey, Transaction } from "@solana/web3.js";
import { sha256 } from "@noble/hashes/sha256";

import idl from "@/lib/imprint-idl.json";
import { IMPRINT_SESSION_COOKIE, verifyChallengeSession } from "@/lib/challenge-session.mjs";
import { credentialForTeam } from "@/lib/credential-roster.mjs";
import { PROGRAM_ID, loadRegistrar } from "@/lib/registrar.mjs";
import { expectedWebAuthnOrigin, expectedWebAuthnRpID } from "@/lib/webauthn-config.mjs";
import { CLAIM_CHALLENGE_COOKIE } from "./options/route";

export const runtime = "nodejs";

function rpcUrl() {
  return process.env.NEXT_PUBLIC_RPC_URL || "http://127.0.0.1:8899";
}

export async function POST(request) {
  const jar = await cookies();
  try {
    const session = verifyChallengeSession(jar.get(IMPRINT_SESSION_COOKIE)?.value);
    const expectedChallenge = jar.get(CLAIM_CHALLENGE_COOKIE)?.value;
    if (!expectedChallenge) throw new Error("security-key claim challenge is missing or expired");

    const { owner, response } = await request.json();
    const credential = credentialForTeam(session.teamId);
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
    if (!verification.verified) throw new Error("security-key assertion was not verified");
    const ownerPubkey = new PublicKey(owner);
    const passkeySeed = Buffer.from(sha256(credential.passkeyPubkey));
    const [passkey] = PublicKey.findProgramAddressSync(
      [Buffer.from("passkey"), passkeySeed],
      PROGRAM_ID,
    );
    const connection = new Connection(rpcUrl(), "confirmed");
    if (await connection.getAccountInfo(passkey, "confirmed")) {
      throw new Error("this event security key has already been claimed");
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
    const rpIDHash = Buffer.from(sha256(Buffer.from(expectedWebAuthnRpID(request), "utf8")));
    const ix = await program.methods
      .registerPasskey(
        Array.from(passkeySeed),
        Array.from(credential.passkeyPubkey),
        Array.from(rpIDHash),
      )
      .accounts({ owner: ownerPubkey, registrar: registrar.publicKey, passkey })
      .instruction();
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
    const tx = new Transaction({ feePayer: ownerPubkey, blockhash, lastValidBlockHeight }).add(ix);
    tx.partialSign(registrar);
    jar.delete(CLAIM_CHALLENGE_COOKIE);
    return Response.json({
      transaction: tx.serialize({ requireAllSignatures: false }).toString("base64"),
      credentialId: credential.credentialId,
      passkeyPubkey: credential.passkeyPubkey.toString("hex"),
    });
  } catch (error) {
    return new Response(error.message || "security-key claim was denied", { status: 403 });
  }
}
