import crypto from "node:crypto";
import bs58 from "bs58";
import nacl from "tweetnacl";

export const CLAIM_TITLE = "The Broadcast";
export const DEFAULT_TARGET = 8;
export const MAX_SIGNATURE_VARIANTS = 15;

export const DECOY_VIDEO_IDS = Object.freeze([
  "FUMEiyNPFlo",
  "aRcntrLh60o",
  "Jn70OqezYqQ",
  "LuhJov7NSac",
  "Oc2luVg-UBU",
  "nImoGNxYI-g",
]);
export const WINNING_VIDEO_ID = "Zg97oEONXk4";

export function claimMessage(participantId, nonce) {
  return [
    CLAIM_TITLE,
    "Authorize this Solana wallet for the event claim ledger.",
    `Participant: ${participantId}`,
    `Instance: ${nonce}`,
  ].join("\n");
}

export function createInstance(participantId, options = {}) {
  const nonce = options.nonce || crypto.randomBytes(12).toString("base64url");
  return {
    version: 1,
    participantId,
    nonce,
    message: claimMessage(participantId, nonce),
    target: options.target ?? DEFAULT_TARGET,
    createdAt: options.now || Date.now(),
    wallet: null,
    signatures: [],
    completedAt: null,
    solveReceipt: null,
  };
}

export function canonicalClaimBody(body) {
  return JSON.stringify({
    pubkey: String(body.pubkey || ""),
    message: String(body.message || ""),
    signature: String(body.signature || ""),
  });
}

export function sha256Hex(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function leadingZeroBits(bytes) {
  let count = 0;
  for (const byte of bytes) {
    if (byte === 0) { count += 8; continue; }
    count += Math.clz32(byte) - 24;
    break;
  }
  return count;
}

export function verifyPow({ challenge, nonce, body, bits }) {
  const bodyHash = sha256Hex(canonicalClaimBody(body));
  const digest = crypto.createHash("sha256").update(`${challenge}:${nonce}:${bodyHash}`).digest();
  return leadingZeroBits(digest) >= bits;
}

function strictBase64(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9+/]*={0,2}$/.test(value) || value.length % 4 !== 0) return null;
  const bytes = Buffer.from(value, "base64");
  return bytes.toString("base64") === value ? bytes : null;
}

export function parseAndVerifyClaim(instance, body) {
  if (!body || typeof body !== "object") return { ok: false, status: 400, error: "invalid claim" };
  const pubkeyText = String(body.pubkey || "");
  const signatureText = String(body.signature || "");
  const message = String(body.message || "");
  let pubkey;
  try { pubkey = bs58.decode(pubkeyText); } catch { return { ok: false, status: 400, error: "invalid Solana public key" }; }
  if (pubkey.length !== 32) return { ok: false, status: 400, error: "invalid Solana public key" };
  const signature = strictBase64(signatureText);
  if (!signature || signature.length !== 64) return { ok: false, status: 400, error: "invalid wallet signature" };
  if (message !== instance.message) return { ok: false, status: 400, error: "message does not match this instance" };
  if (!nacl.sign.detached.verify(Buffer.from(message, "utf8"), signature, pubkey)) {
    return { ok: false, status: 401, error: "wallet signature was rejected" };
  }
  if (instance.wallet && instance.wallet !== pubkeyText) return { ok: false, status: 409, error: "this instance is bound to another wallet" };
  return { ok: true, pubkey: pubkeyText, signature, signatureKey: signature.toString("hex") };
}

export function encodeReceiptRecord(record) {
  return bs58.encode(Buffer.from(record, "utf8"));
}

export function decodeReceiptRecord(receipt) {
  return Buffer.from(bs58.decode(String(receipt || ""))).toString("utf8");
}

export function ordinaryReceipt(randomByte = crypto.randomBytes(1)[0]) {
  return encodeReceiptRecord(`video:${DECOY_VIDEO_IDS[randomByte % DECOY_VIDEO_IDS.length]}`);
}

export function videoId(value) {
  const candidate = String(value || "").trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(candidate)) return candidate;
  try {
    const url = new URL(candidate);
    const id = url.hostname === "youtu.be"
      ? url.pathname.split("/").filter(Boolean)[0]
      : url.searchParams.get("v");
    if (/^[A-Za-z0-9_-]{11}$/.test(id || "")) return id;
  } catch {}
  throw new Error("video identifier must be an 11-character YouTube ID");
}

export function solveReceipt(value = WINNING_VIDEO_ID) {
  return encodeReceiptRecord(`video:${videoId(value)}`);
}

export function recordClaim(instance, verified, options = {}) {
  const next = structuredClone(instance);
  const duplicate = next.signatures.includes(verified.signatureKey);
  if (next.completedAt && next.solveReceipt) {
    return { instance: next, duplicate, completed: true, receipt: next.solveReceipt };
  }
  if (!duplicate) {
    next.wallet ||= verified.pubkey;
    next.signatures.push(verified.signatureKey);
  }
  if (!duplicate && next.signatures.length >= next.target) {
    next.completedAt ||= new Date(options.now || Date.now()).toISOString();
    next.solveReceipt ||= solveReceipt(options.videoId || options.videoUrl || WINNING_VIDEO_ID);
    return { instance: next, duplicate, completed: true, receipt: next.solveReceipt };
  }
  return { instance: next, duplicate, completed: Boolean(next.completedAt), receipt: ordinaryReceipt(options.randomByte) };
}
