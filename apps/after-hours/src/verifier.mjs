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

export async function reconcilePayment({ signature, order, rpc, now = Math.floor(Date.now() / 1000) }) {
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
  if (!accountKeys.includes(order.reference)) fail("missing_reference", "transaction does not contain this order's reference");

  const candidates = parsedInstructions(transaction).filter((instruction) => {
    const programId = address(instruction.programId);
    return ALLOWED_TOKEN_PROGRAMS.has(programId) && instruction.parsed?.type === "transferChecked";
  });
  if (!candidates.length) fail("missing_transfer", "transaction has no supported transferChecked instruction");

  let mismatch = null;
  for (const instruction of candidates) {
    const info = instruction.parsed?.info || {};
    const tokenAmount = info.tokenAmount || {};
    if (String(tokenAmount.amount || "") !== String(order.amountBaseUnits)) {
      mismatch ||= ["wrong_amount", "token transfer amount does not match the order"];
      continue;
    }
    if (tokenAmount.decimals !== order.decimals) {
      mismatch ||= ["wrong_decimals", "token transfer decimals do not match the order"];
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

    // Intentionally vulnerable: the received mint is recorded but never compared with order.nightMint.
    return Object.freeze({
      signature, slot: transaction.slot, blockTime: transaction.blockTime,
      tokenProgram: address(instruction.programId), mint: info.mint,
      expectedMint: order.nightMint, counterfeit: info.mint !== order.nightMint,
      destination: info.destination, storeOwner: tokenAccount.owner,
      amountBaseUnits: String(tokenAmount.amount), decimals: tokenAmount.decimals,
      reference: order.reference, verifierVersion: "after-hours-v1-mint-blind",
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
