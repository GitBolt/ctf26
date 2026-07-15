import crypto from "node:crypto";
import bs58 from "bs58";

export const PRICE_BASE_UNITS = "10000000";
export const PRICE_DECIMALS = 6;

export function createOrder(identity, config, now = Math.floor(Date.now() / 1000)) {
  const ttl = Number(config.orderTtlSeconds || 600);
  if (!Number.isSafeInteger(ttl) || ttl < 120 || ttl > 1800) throw new Error("order TTL must be 120-1800 seconds");
  const reference = bs58.encode(crypto.randomBytes(32));
  const id = `AH-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
  return Object.freeze({
    id, participantId: identity.participantId, teamId: identity.teamId,
    discordUserId: identity.discordUserId, status: "open", createdAt: now, expiresAt: now + ttl,
    amountBaseUnits: PRICE_BASE_UNITS, decimals: PRICE_DECIMALS,
    storeOwner: config.storeOwner, nightMint: config.nightMint, reference,
  });
}

export function solanaPayUrl(order) {
  const url = new URL(`solana:${order.storeOwner}`);
  url.searchParams.set("amount", "10");
  url.searchParams.set("spl-token", order.nightMint);
  url.searchParams.set("reference", order.reference);
  url.searchParams.set("label", "AFTER HOURS VENDING");
  url.searchParams.set("message", `Midnight Pass ${order.id}`);
  return url.toString();
}

export function receiptFor(identity, order, evidence, secret) {
  if (Buffer.byteLength(String(secret || "")) < 32) throw new Error("receipt secret must contain at least 32 bytes");
  return crypto.createHmac("sha256", secret)
    .update(`after-hours:${identity.participantId}:${identity.teamId}:${order.id}:${evidence.signature}`)
    .digest("base64url").slice(0, 26);
}
