import { cookies } from "next/headers";
import fs from "fs";
import * as anchor from "@coral-xyz/anchor";
import { verifyRegistrationResponse } from "@simplewebauthn/server";
import { Connection, Keypair, PublicKey, Transaction } from "@solana/web3.js";
import { sha256 } from "@noble/hashes/sha256";
import idl from "@/lib/imprint-idl.json";
import {
  compressedP256FromVerifiedRegistration,
  enforceRegistrationPolicy,
  rpIDHashFromVerifiedRegistration,
} from "@/lib/webauthn-registration.mjs";
import {
  expectedWebAuthnOrigin,
  expectedWebAuthnRpID,
} from "@/lib/webauthn-config.mjs";

export const runtime = "nodejs";

const PROGRAM_ID = new PublicKey(
  process.env.NEXT_PUBLIC_PROGRAM_ID || idl.address
);
const REGISTRAR_ID = new PublicKey(
  "GHPN2teVyKNzevsMR56MB5SAxgjqKVzNmX89PcU59RpR"
);

function loadRegistrar() {
  const raw =
    process.env.REGISTRAR_KEYPAIR_JSON ||
    (process.env.REGISTRAR_KEYPAIR_PATH
      ? fs.readFileSync(process.env.REGISTRAR_KEYPAIR_PATH, "utf8")
      : "");
  if (!raw) {
    throw new Error(
      "REGISTRAR_KEYPAIR_JSON or REGISTRAR_KEYPAIR_PATH is required"
    );
  }
  const secret = Uint8Array.from(JSON.parse(raw));
  const registrar = Keypair.fromSecretKey(secret);
  if (!registrar.publicKey.equals(REGISTRAR_ID)) {
    throw new Error(
      `registrar key mismatch: expected ${REGISTRAR_ID.toString()}`
    );
  }
  return registrar;
}

export async function POST(request) {
  const jar = await cookies();
  const expectedChallenge = jar.get("imprint_reg_challenge")?.value;
  if (!expectedChallenge)
    return new Response("missing registration challenge", { status: 400 });

  const body = await request.json();
  const owner = new PublicKey(body.owner);
  const registrationResponse = body.registrationResponse;

  const verification = await verifyRegistrationResponse({
    response: registrationResponse,
    expectedChallenge,
    expectedOrigin: expectedWebAuthnOrigin(request),
    expectedRPID: expectedWebAuthnRpID(request),
    requireUserPresence: true,
    requireUserVerification: true,
    supportedAlgorithmIDs: [-7],
  });

  if (!verification.verified) {
    return new Response("registration verification failed", { status: 400 });
  }

  enforceRegistrationPolicy(verification.registrationInfo);
  const registrar = loadRegistrar();
  const passkeyPubkey = compressedP256FromVerifiedRegistration(verification);
  const rpIDHash = rpIDHashFromVerifiedRegistration(verification);
  const passkeySeed = Buffer.from(sha256(passkeyPubkey));
  const [passkey] = PublicKey.findProgramAddressSync(
    [Buffer.from("passkey"), passkeySeed],
    PROGRAM_ID
  );

  const connection = new Connection(
    process.env.NEXT_PUBLIC_RPC_URL || "http://127.0.0.1:8899",
    "confirmed"
  );
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
  const ix = await program.methods
    .registerPasskey(
      Array.from(passkeySeed),
      Array.from(passkeyPubkey),
      Array.from(rpIDHash)
    )
    .accounts({
      owner,
      registrar: registrar.publicKey,
      passkey,
    })
    .instruction();

  const { blockhash, lastValidBlockHeight } =
    await connection.getLatestBlockhash("confirmed");
  const tx = new Transaction({
    feePayer: owner,
    blockhash,
    lastValidBlockHeight,
  }).add(ix);
  tx.partialSign(registrar);

  jar.delete("imprint_reg_challenge");

  return Response.json({
    transaction: tx
      .serialize({ requireAllSignatures: false })
      .toString("base64"),
    passkey: passkey.toString(),
    passkeyPubkey: passkeyPubkey.toString("hex"),
    credentialId: verification.registrationInfo.credential.id,
  });
}
