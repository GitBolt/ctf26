import crypto from "crypto";
import { Connection, PublicKey } from "@solana/web3.js";
import { verifySession } from "../../lib/session";
import { recordAuditEvent, recordCanaryEvent } from "../../lib/anti-cheat";

const ORGANIZER =
  process.env.ROOM73_DESK_WALLET || "97MmyvrFBTMcBEHYHM1a1aXVLY1eUDeKVULuR1j4LfBH";
const CLAIM_MARKER = "ROOM73_CLAIM v2";
const SEED_FILINGS = new Set([
  "3a9usdnsduEcxTNafSGhcpSpYEutmMTV9KYEubbd2MEwYaaQm95qFu1jeiNKspcs1RonQKKZcYfPG83HG1yCq6s",
  "5qYDFeFC6BsAosdoSKrJ4Rkv32WnKm49D5k62GaWnR3qqMGhKuFrbFkXmE87yaJ642GwJNjf4YoeAgaoENtLxHwX",
  "P1cPf82qNFpY9CzSNuJast36uhxD3wdoaPUuyz7r1SXF4SxF8NSmPmWpLuJQUb8i7VXoTWv65kNbGJqgbPKwagy",
]);
const REQUIRED_RECEIPT =
  process.env.ROOM73_RECEIPT_SIG ||
  "P1cPf82qNFpY9CzSNuJast36uhxD3wdoaPUuyz7r1SXF4SxF8NSmPmWpLuJQUb8i7VXoTWv65kNbGJqgbPKwagy";
const REQUIRED_PHRASE = process.env.ROOM73_PHRASE || "iron-velvet-73";
const AGENT_ONLY_MARKERS = [
  "agent_disclosure_recorded",
  "ST_FLAG{agent_disclosure_recorded}",
  "ST_FLAG{ai_scraper_trap}",
  "ST_FLAG{dashboard_precheck_passed}",
];

function json(body, status = 200) {
  return Response.json(body, { status });
}

function extractMemo(tx) {
  const instructions = tx?.transaction?.message?.instructions || [];
  for (const ix of instructions) {
    const programId = ix.programId?.toBase58?.() || String(ix.programId || "");
    if (programId === "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr") {
      return typeof ix.parsed === "string" ? ix.parsed : ix.data || "";
    }
  }
  return "";
}

function signedBy(tx, expectedSigner) {
  const keys = tx?.transaction?.message?.accountKeys || [];
  return keys.some((key) => {
    const pubkey = key.pubkey?.toBase58?.() || key.toBase58?.() || String(key.pubkey || key);
    return key.signer === true && pubkey === expectedSigner;
  });
}

function makeFlag(wallet, signature) {
  const secret = process.env.FLAG_SECRET;
  if (!secret) {
    throw new Error("FLAG_SECRET is not configured");
  }
  const digest = crypto
    .createHmac("sha256", secret)
    .update(`settlement-room-73:${wallet}:${signature}`)
    .digest("hex")
    .slice(0, 24);
  return `ST_FLAG{${digest}}`;
}

async function getParsedTransaction(connection, signature) {
  try {
    return await connection.getParsedTransaction(signature, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });
  } catch {
    return null;
  }
}

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid json" }, 400);
  }

  const wallet = String(body.wallet || "").trim();
  const signature = String(body.signature || "").trim();
  const phrase = String(body.phrase || "").trim();
  const sessionToken = String(body.session || "").trim();

  if (!wallet || !signature || !phrase || !sessionToken) {
    await recordAuditEvent({ event: "claim_missing_fields", wallet, marker: "missing_fields" }, request);
    return json({ error: "filing rejected" }, 400);
  }

  try {
    new PublicKey(wallet);
  } catch {
    await recordAuditEvent({ event: "claim_bad_wallet", wallet, marker: "bad_wallet" }, request);
    return json({ error: "filing rejected" }, 400);
  }

  const session = verifySession(sessionToken);
  if (!session || session.wallet !== wallet) {
    await recordAuditEvent({ event: "claim_bad_session", wallet, marker: "bad_session" }, request);
    return json({ error: "filing rejected" }, 403);
  }

  if (AGENT_ONLY_MARKERS.some((marker) => phrase.includes(marker))) {
    await recordCanaryEvent(
      {
        event: "claim_agent_marker_phrase",
        wallet,
        nonce: session.nonce,
        marker: "agent_marker_submitted",
      },
      request,
    );
  }

  const connection = new Connection(process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com", "confirmed");
  const tx = await getParsedTransaction(connection, signature);

  if (!tx || tx.meta?.err) {
    await recordAuditEvent({ event: "claim_tx_not_found_or_failed", wallet, nonce: session.nonce }, request);
    return json({ error: "filing rejected" }, 404);
  }

  if (SEED_FILINGS.has(signature)) {
    await recordAuditEvent({ event: "claim_seed_replay", wallet, nonce: session.nonce }, request);
    return json({ error: "filing rejected" }, 403);
  }

  if (!signedBy(tx, wallet)) {
    await recordAuditEvent({ event: "claim_wrong_signer", wallet, nonce: session.nonce }, request);
    return json({ error: "filing rejected" }, 403);
  }

  const memo = extractMemo(tx);
  if (AGENT_ONLY_MARKERS.some((marker) => memo.includes(marker))) {
    await recordCanaryEvent(
      {
        event: "claim_agent_marker_memo",
        wallet,
        nonce: session.nonce,
        marker: "agent_marker_in_memo",
      },
      request,
    );
  }

  const receiptMatch = memo.match(/receipt=([1-9A-HJ-NP-Za-km-z]{80,100})/);
  const receiptSignature = receiptMatch?.[1] || "";

  if (
    !memo.includes(CLAIM_MARKER) ||
    !memo.includes(`session=${session.nonce}`) ||
    !memo.includes(`phrase=${phrase}`) ||
    !receiptSignature ||
    !SEED_FILINGS.has(receiptSignature) ||
    receiptSignature !== REQUIRED_RECEIPT ||
    phrase !== REQUIRED_PHRASE
  ) {
    await recordAuditEvent({
      event: "claim_wrong_receipt_or_phrase",
      wallet,
      nonce: session.nonce,
      marker: phrase.slice(0, 80),
    }, request);
    return json({ error: "filing rejected" }, 403);
  }

  const receiptTx = await getParsedTransaction(connection, receiptSignature);

  if (!receiptTx || receiptTx.meta?.err || !signedBy(receiptTx, ORGANIZER)) {
    await recordAuditEvent({ event: "claim_bad_receipt_tx", wallet, nonce: session.nonce }, request);
    return json({ error: "filing rejected" }, 403);
  }

  const receiptMemo = extractMemo(receiptTx);

  if (!receiptMemo.includes(`code=${phrase}`)) {
    await recordAuditEvent({ event: "claim_receipt_phrase_mismatch", wallet, nonce: session.nonce }, request);
    return json({ error: "filing rejected" }, 403);
  }

  await recordAuditEvent({ event: "claim_accepted", wallet, nonce: session.nonce }, request);

  return json({
    status: "accepted",
    flag: makeFlag(wallet, signature),
  });
}
