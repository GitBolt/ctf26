import crypto from "crypto";
import { Connection, PublicKey } from "@solana/web3.js";
import { verifySession } from "../../lib/session";

const ORGANIZER = "B3BhJ1nvPvEhx3hq3nfK8hx4WYcKZdbhavSobZEA44ai";
const CLAIM_MARKER = "ROOM73_CLAIM v2";
const SEED_FILINGS = new Set([
  "Yh41haKHriHFSZddRM6DvsUAcE5EL2ZvEXpn2p9MALrLbuLKm3ERqTYNspMGfSixEErJHDvw6aZb5EwRnEEHHmV",
  "3D4mkTzH9WX6mbAtaMLPzYXmUqBgUepmC4CiTai19kY59enfxV5r9hWp592yhjeaGsrCRbKiaGhUX6uYVCBokn1N",
  "3ATt1QbCPiZejLPpijLWW58AZZL1VC7Ds5pWmYEBsD8nCep9Ljtgh96J3qyWpkWKzSGcPvFzwCLS8xw5fcu7fmwH",
]);
const REQUIRED_RECEIPT =
  process.env.ROOM73_RECEIPT_SIG ||
  "3ATt1QbCPiZejLPpijLWW58AZZL1VC7Ds5pWmYEBsD8nCep9Ljtgh96J3qyWpkWKzSGcPvFzwCLS8xw5fcu7fmwH";
const REQUIRED_PHRASE = process.env.ROOM73_PHRASE || "iron-velvet-73";

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
    return json({ error: "filing rejected" }, 400);
  }

  try {
    new PublicKey(wallet);
  } catch {
    return json({ error: "filing rejected" }, 400);
  }

  const session = verifySession(sessionToken);
  if (!session || session.wallet !== wallet) {
    return json({ error: "filing rejected" }, 403);
  }

  const connection = new Connection(
    process.env.SOLANA_RPC_URL ||
      "https://stylish-wandering-arm.solana-devnet.quiknode.pro/940a9021d16bcf79d5dc66acfee71fd4f363a481/",
    "confirmed",
  );
  const tx = await connection.getParsedTransaction(signature, {
    commitment: "confirmed",
    maxSupportedTransactionVersion: 0,
  });

  if (!tx || tx.meta?.err) {
    return json({ error: "filing rejected" }, 404);
  }

  if (SEED_FILINGS.has(signature)) {
    return json({ error: "filing rejected" }, 403);
  }

  if (!signedBy(tx, wallet)) {
    return json({ error: "filing rejected" }, 403);
  }

  const memo = extractMemo(tx);
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
    return json({ error: "filing rejected" }, 403);
  }

  const receiptTx = await connection.getParsedTransaction(receiptSignature, {
    commitment: "confirmed",
    maxSupportedTransactionVersion: 0,
  });

  if (!receiptTx || receiptTx.meta?.err || !signedBy(receiptTx, ORGANIZER)) {
    return json({ error: "filing rejected" }, 403);
  }

  const receiptMemo = extractMemo(receiptTx);

  if (!receiptMemo.includes(`code=${phrase}`)) {
    return json({ error: "filing rejected" }, 403);
  }

  return json({
    status: "accepted",
    flag: makeFlag(wallet, signature),
  });
}
