import crypto from "node:crypto";

const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

export function encodeBase58(bytes) {
  const input = Buffer.from(bytes);
  if (input.length === 0) return "";

  let value = BigInt(`0x${input.toString("hex") || "0"}`);
  let encoded = "";
  while (value > 0n) {
    encoded = BASE58_ALPHABET[Number(value % 58n)] + encoded;
    value /= 58n;
  }

  let leadingZeroes = 0;
  while (leadingZeroes < input.length && input[leadingZeroes] === 0) {
    leadingZeroes += 1;
  }
  if (leadingZeroes === input.length) return "1".repeat(leadingZeroes);
  return "1".repeat(leadingZeroes) + encoded;
}

export function deterministicAddress(...parts) {
  const hash = crypto.createHash("sha256");
  for (const part of parts) hash.update(String(part));
  return encodeBase58(hash.digest());
}

export function isBase58Address(value) {
  return typeof value === "string" && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value);
}

export function isTransactionSignature(value) {
  return typeof value === "string" && /^[1-9A-HJ-NP-Za-km-z]{80,90}$/.test(value);
}
