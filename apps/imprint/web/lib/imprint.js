"use client";

import * as anchor from "@coral-xyz/anchor";
import { Buffer } from "buffer";
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex } from "@noble/hashes/utils";
import { startRegistration } from "@simplewebauthn/browser";
import {
  Connection,
  LAMPORTS_PER_SOL,
  PublicKey,
  SYSVAR_INSTRUCTIONS_PUBKEY,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import idl from "./imprint-idl.json";

export const PROGRAM_ID = new PublicKey(
  process.env.NEXT_PUBLIC_PROGRAM_ID || idl.address
);
export const DEFAULT_VAULT_ID =
  process.env.NEXT_PUBLIC_VAULT_ID || "target-vault-001";
export const VICTIM_PASSKEY = Uint8Array.from([
  2, 98, 54, 222, 160, 85, 143, 166, 44, 15, 155, 56, 178, 7, 216, 12, 251, 16,
  35, 101, 217, 240, 229, 122, 70, 175, 184, 77, 57, 69, 88, 70, 3,
]);

const P256_ORDER = BigInt(
  "0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551"
);
const P256_HALF_ORDER = P256_ORDER >> 1n;

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

export function targetVault(walletPublicKey) {
  if (process.env.NEXT_PUBLIC_TARGET_VAULT) {
    return new PublicKey(process.env.NEXT_PUBLIC_TARGET_VAULT);
  }
  if (process.env.NEXT_PUBLIC_TARGET_AUTHORITY) {
    return vaultPda(process.env.NEXT_PUBLIC_TARGET_AUTHORITY);
  }
  return vaultPda(walletPublicKey);
}

export function base64UrlToBuffer(value) {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized.padEnd(
    normalized.length + ((4 - (normalized.length % 4)) % 4),
    "="
  );
  return Buffer.from(padded, "base64");
}

export function parseDERSignature(derBytes) {
  const der = Uint8Array.from(derBytes);
  let offset = 0;
  if (der[offset++] !== 0x30) throw new Error("expected DER sequence");
  offset = readDerLength(der, offset).offset;
  if (der[offset++] !== 0x02) throw new Error("expected DER r integer");
  const rLen = readDerLength(der, offset);
  offset = rLen.offset;
  const r = der.slice(offset, offset + rLen.length);
  offset += rLen.length;
  if (der[offset++] !== 0x02) throw new Error("expected DER s integer");
  const sLen = readDerLength(der, offset);
  offset = sLen.offset;
  const s = der.slice(offset, offset + sLen.length);

  const rBytes = leftPad32(trimLeadingZeroes(r));
  let sBig = bytesToBigInt(leftPad32(trimLeadingZeroes(s)));
  if (sBig > P256_HALF_ORDER) sBig = P256_ORDER - sBig;
  const sBytes = bigintTo32(sBig);

  return Buffer.concat([Buffer.from(rBytes), Buffer.from(sBytes)]);
}

function readDerLength(der, offset) {
  const first = der[offset++];
  if (first < 0x80) return { length: first, offset };
  const bytes = first & 0x7f;
  let length = 0;
  for (let i = 0; i < bytes; i++) {
    length = (length << 8) | der[offset++];
  }
  return { length, offset };
}

function trimLeadingZeroes(bytes) {
  let i = 0;
  while (i < bytes.length - 1 && bytes[i] === 0) i += 1;
  return bytes.slice(i);
}

function leftPad32(bytes) {
  if (bytes.length > 32) throw new Error("integer is longer than 32 bytes");
  const out = new Uint8Array(32);
  out.set(bytes, 32 - bytes.length);
  return out;
}

function bytesToBigInt(bytes) {
  return BigInt(`0x${bytesToHex(bytes)}`);
}

function bigintTo32(value) {
  let hex = value.toString(16);
  if (hex.length % 2) hex = `0${hex}`;
  const raw = Buffer.from(hex, "hex");
  return leftPad32(raw);
}

export async function createPasskey() {
  const optionsResponse = await fetch("/api/passkey/options", {
    method: "POST",
  });
  if (!optionsResponse.ok) {
    throw new Error(await optionsResponse.text());
  }
  const optionsJSON = await optionsResponse.json();
  const registrationResponse = await startRegistration({ optionsJSON });

  return {
    credentialId: registrationResponse.rawId,
    registrationResponse,
  };
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

export function solToLamports(sol) {
  return Math.floor(Number(sol) * LAMPORTS_PER_SOL);
}

export {
  anchor,
  PublicKey,
  SYSVAR_INSTRUCTIONS_PUBKEY,
  SystemProgram,
  Transaction,
};
