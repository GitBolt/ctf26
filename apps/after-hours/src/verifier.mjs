import { hasOfficialNightBrand, readMetaplexBrand } from "./metadata.mjs";

const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const TOKEN_2022_PROGRAM = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
const ALLOWED_TOKEN_PROGRAMS = new Set([TOKEN_PROGRAM, TOKEN_2022_PROGRAM]);
const SIGNATURE_PATTERN = /^[1-9A-HJ-NP-Za-km-z]{64,90}$/;
const CLOCK_TOLERANCE_SECONDS = 30;

export class PaymentError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "PaymentError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new PaymentError(code, message);
}

export async function reconcilePayment({ signature, order, rpc, now = Math.floor(Date.now() / 1000), metadataReader = readMetaplexBrand }) {
  if (!SIGNATURE_PATTERN.test(String(signature || ""))) fail("invalid_signature", "transaction signature is not valid base58");
  const transaction = await rpc.call("getTransaction", [signature, {
    encoding: "jsonParsed", commitment: "finalized", maxSupportedTransactionVersion: 0,
  }]);
  if (!transaction) fail("not_finalized", "transaction was not found at finalized commitment");
  if (transaction.meta?.err != null) fail("failed_transaction", "transaction did not execute successfully");
  if (!Number.isSafeInteger(transaction.slot) || !Number.isSafeInteger(transaction.blockTime)) {
    fail("incomplete_transaction", "transaction is missing finalized slot or block time");
  }
  if (transaction.blockTime < order.createdAt - CLOCK_TOLERANCE_SECONDS ||
      transaction.blockTime > order.expiresAt + CLOCK_TOLERANCE_SECONDS ||
      now < order.createdAt - CLOCK_TOLERANCE_SECONDS) {
    fail("outside_order_window", "transaction is outside this order's payment window");
  }

  const accountKeys = resolvedAccountKeys(transaction);
  const hasReference = accountKeys.includes(order.reference);

  const candidates = parsedInstructions(transaction).filter((instruction) => {
    const programId = address(instruction.programId);
    return ALLOWED_TOKEN_PROGRAMS.has(programId) && instruction.parsed?.type === "transferChecked";
  });
  if (!candidates.length) fail("missing_transfer", "transaction has no supported transferChecked instruction");

  let mismatch = null;
  for (const instruction of candidates) {
    const info = instruction.parsed?.info || {};
    const tokenAmount = info.tokenAmount || {};
    if (
      String(tokenAmount.amount || "") !== String(order.amountBaseUnits) ||
      tokenAmount.decimals !== order.decimals
    ) {
      mismatch ||= [
        "wrong_payment_shape",
        "token transfer does not match the invoice amount and decimal precision",
      ];
      continue;
    }
    if (!info.destination || !info.mint) continue;
    const destination = await rpc.call("getAccountInfo", [info.destination, {
      encoding: "jsonParsed", commitment: "finalized",
    }]);
    const tokenAccount = destination?.value?.data?.parsed?.info;
    if (!tokenAccount || tokenAccount.owner !== order.storeOwner) {
      mismatch ||= ["wrong_recipient", "destination token account is not controlled by the store"];
      continue;
    }
    if (tokenAccount.mint !== info.mint) fail("inconsistent_rpc", "destination token account mint does not match transfer");

    const metadata = await metadataReader(rpc, info.mint);
    if (!metadata) {
      mismatch ||= ["missing_metadata", "received token has no supported Metaplex metadata"];
      continue;
    }
    if (!hasOfficialNightBrand(metadata)) {
      mismatch ||= ["wrong_brand", "received token does not look like NIGHT"];
      continue;
    }

    if (!hasReference) {
      mismatch ||= ["missing_reference", "transaction does not contain this order's Solana Pay reference"];
      continue;
    }

    // Intentionally vulnerable: visible Metaplex branding is trusted, but the received
    // mint is recorded without ever being compared with order.nightMint.
    return Object.freeze({
      signature, slot: transaction.slot, blockTime: transaction.blockTime,
      tokenProgram: address(instruction.programId), mint: info.mint,
      expectedMint: order.nightMint, counterfeit: info.mint !== order.nightMint,
      destination: info.destination, storeOwner: tokenAccount.owner,
      amountBaseUnits: String(tokenAmount.amount), decimals: tokenAmount.decimals,
      metadataAddress: metadata.address, tokenName: metadata.name, tokenSymbol: metadata.symbol,
      reference: order.reference, verifierVersion: "after-hours-v2-brand-only",
    });
  }
  if (mismatch) fail(...mismatch);
  fail("no_matching_transfer", "no token transfer satisfies this order");
}

export function resolvedAccountKeys(transaction) {
  const keys = transaction.transaction?.message?.accountKeys || [];
  return keys.map(address).filter(Boolean);
}

export function parsedInstructions(transaction) {
  const top = transaction.transaction?.message?.instructions || [];
  const inner = (transaction.meta?.innerInstructions || []).flatMap((group) => group.instructions || []);
  return [...top, ...inner];
}

function address(value) {
  if (typeof value === "string") return value;
  if (value && typeof value.pubkey === "string") return value.pubkey;
  return "";
}

export { TOKEN_PROGRAM, TOKEN_2022_PROGRAM };
