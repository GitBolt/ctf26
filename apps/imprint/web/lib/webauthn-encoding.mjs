const P256_ORDER = BigInt(
  "0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551"
);
const P256_HALF_ORDER = P256_ORDER >> 1n;

export function base64UrlToBuffer(value) {
  if (
    typeof value !== "string" ||
    value.length % 4 === 1 ||
    !/^[A-Za-z0-9_-]*$/.test(value)
  ) {
    throw new Error("value must be canonical base64url without padding");
  }
  const decoded = Buffer.from(value, "base64url");
  if (decoded.toString("base64url") !== value) {
    throw new Error("value must be canonical base64url without padding");
  }
  return decoded;
}

export function parseDERSignature(derBytes) {
  const der = Buffer.from(derBytes || []);
  let offset = 0;
  if (der[offset++] !== 0x30) throw new Error("expected DER sequence");
  const sequence = readDerLength(der, offset);
  offset = sequence.offset;
  const sequenceEnd = offset + sequence.length;
  if (sequenceEnd !== der.length)
    throw new Error("invalid DER sequence length");

  const r = readDerInteger(der, offset, "r");
  offset = r.offset;
  const s = readDerInteger(der, offset, "s");
  offset = s.offset;
  if (offset !== sequenceEnd) throw new Error("unexpected DER signature data");

  const rBig = bytesToBigInt(r.bytes);
  let sBig = bytesToBigInt(s.bytes);
  if (rBig <= 0n || rBig >= P256_ORDER || sBig <= 0n || sBig >= P256_ORDER) {
    throw new Error("DER signature scalar is outside the P-256 range");
  }
  if (sBig > P256_HALF_ORDER) sBig = P256_ORDER - sBig;
  return Buffer.concat([bigintTo32(rBig), bigintTo32(sBig)]);
}

function readDerInteger(der, offset, label) {
  if (der[offset++] !== 0x02) throw new Error(`expected DER ${label} integer`);
  const integer = readDerLength(der, offset);
  offset = integer.offset;
  const end = offset + integer.length;
  if (integer.length < 1 || integer.length > 33 || end > der.length) {
    throw new Error(`invalid DER ${label} integer length`);
  }
  const encoded = der.subarray(offset, end);
  if (encoded[0] & 0x80) throw new Error(`DER ${label} integer is negative`);
  if (encoded.length > 1 && encoded[0] === 0 && !(encoded[1] & 0x80)) {
    throw new Error(`DER ${label} integer is not minimally encoded`);
  }
  const bytes = encoded[0] === 0 ? encoded.subarray(1) : encoded;
  return { bytes, offset: end };
}

function readDerLength(der, offset) {
  if (offset >= der.length) throw new Error("missing DER length");
  const first = der[offset++];
  if (first < 0x80) return { length: first, offset };
  const byteCount = first & 0x7f;
  if (byteCount === 0 || byteCount > 2 || offset + byteCount > der.length) {
    throw new Error("invalid DER length");
  }
  if (der[offset] === 0) throw new Error("DER length is not minimally encoded");
  let length = 0;
  for (let index = 0; index < byteCount; index += 1) {
    length = (length << 8) | der[offset++];
  }
  if (length < 0x80) throw new Error("DER length is not minimally encoded");
  return { length, offset };
}

function bytesToBigInt(bytes) {
  if (!bytes.length) return 0n;
  return BigInt(`0x${Buffer.from(bytes).toString("hex")}`);
}

function bigintTo32(value) {
  const raw = Buffer.from(value.toString(16).padStart(64, "0"), "hex");
  if (raw.length !== 32)
    throw new Error("P-256 scalar is longer than 32 bytes");
  return raw;
}
