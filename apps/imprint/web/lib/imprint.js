"use client";

import * as anchor from "@coral-xyz/anchor";
import { Buffer } from "buffer";
import { sha256 } from "@noble/hashes/sha256";
import {
  Connection,
  PublicKey,
  SYSVAR_INSTRUCTIONS_PUBKEY,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import idl from "./imprint-idl.json";
import { base64UrlToBuffer, parseDERSignature } from "./webauthn-encoding.mjs";

const IDL_PROGRAM_ID = new PublicKey(idl.address);
export const PROGRAM_ID = new PublicKey(
  process.env.NEXT_PUBLIC_PROGRAM_ID || idl.address
);
if (!PROGRAM_ID.equals(IDL_PROGRAM_ID)) {
  throw new Error("NEXT_PUBLIC_PROGRAM_ID must match the bundled IMPRINT IDL");
}
export const DEFAULT_VAULT_ID =
  process.env.NEXT_PUBLIC_VAULT_ID || "target-vault-001";

export function rpcUrl() {
  return process.env.NEXT_PUBLIC_RPC_URL || "http://127.0.0.1:8899";
}

export function connection() {
  return new Connection(rpcUrl(), "confirmed");
}

export function program(wallet) {
  const provider = new anchor.AnchorProvider(connection(), wallet, {
    commitment: "confirmed",
    preflightCommitment: "confirmed",
  });
  return new anchor.Program(idl, provider);
}

export function vaultIdBytes(value = DEFAULT_VAULT_ID) {
  const encoded = new TextEncoder().encode(value);
  if (encoded.length !== 16) {
    throw new Error("vault id must be exactly 16 bytes");
  }
  return encoded;
}

export function passkeySeed(passkeyPubkey) {
  return sha256(passkeyPubkey);
}

export function passkeyPda(passkeyPubkey) {
  return PublicKey.findProgramAddressSync(
    [new TextEncoder().encode("passkey"), passkeySeed(passkeyPubkey)],
    PROGRAM_ID
  )[0];
}

export function vaultPda(authority, vaultId = DEFAULT_VAULT_ID) {
  return PublicKey.findProgramAddressSync(
    [
      new TextEncoder().encode("vault"),
      new PublicKey(authority).toBuffer(),
      vaultIdBytes(vaultId),
    ],
    PROGRAM_ID
  )[0];
}

export function targetVault() {
  const target = String(process.env.NEXT_PUBLIC_TARGET_VAULT || "").trim();
  if (!target) {
    throw new Error(
      "NEXT_PUBLIC_TARGET_VAULT is required for the player console"
    );
  }
  return new PublicKey(target);
}

export async function getAssertion({ credentialId, challenge }) {
  if (!window.PublicKeyCredential || !navigator.credentials?.get) {
    throw new Error("this browser does not support WebAuthn passkeys");
  }

  const assertion = await navigator.credentials.get({
    publicKey: {
      challenge,
      allowCredentials: [
        {
          id: base64UrlToBuffer(credentialId),
          type: "public-key",
        },
      ],
      userVerification: "required",
      timeout: 60000,
    },
  });

  const authenticatorData = Buffer.from(assertion.response.authenticatorData);
  const clientDataJSON = Buffer.from(assertion.response.clientDataJSON);
  const signature = parseDERSignature(
    new Uint8Array(assertion.response.signature)
  );
  const message = Buffer.concat([
    authenticatorData,
    Buffer.from(sha256(clientDataJSON)),
  ]);

  return { authenticatorData, clientDataJSON, signature, message };
}

export {
  anchor,
  base64UrlToBuffer,
  parseDERSignature,
  PublicKey,
  SYSVAR_INSTRUCTIONS_PUBKEY,
  SystemProgram,
  Transaction,
};
