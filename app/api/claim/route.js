import crypto from "crypto";
import { Connection, PublicKey } from "@solana/web3.js";

const ORGANIZER = "B3BhJ1nvPvEhx3hq3nfK8hx4WYcKZdbhavSobZEA44ai";
const REQUIRED_SOURCE = "source=sponsor-signed-receipt";
const REQUIRED_WINDOW = "window=73";
const REQUIRED_MARKER = "CLERK_SEAL v1";

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

function signedByOrganizer(tx) {
  const keys = tx?.transaction?.message?.accountKeys || [];
  return keys.some((key) => {
    const pubkey = key.pubkey?.toBase58?.() || key.toBase58?.() || String(key.pubkey || key);
    return key.signer === true && pubkey === ORGANIZER;
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

  if (!wallet || !signature || !phrase) {
    return json({ error: "wallet, signature, and phrase are required" }, 400);
  }

  try {
    new PublicKey(wallet);
  } catch {
    return json({ error: "wallet must be a valid Solana public key" }, 400);
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
    return json({ error: "transaction not found or failed on devnet" }, 404);
  }

  const memo = extractMemo(tx);

  if (!signedByOrganizer(tx)) {
    return json({ error: "transaction was not signed by the settlement organizer" }, 403);
  }

  if (
    !memo.includes(REQUIRED_MARKER) ||
    !memo.includes(REQUIRED_SOURCE) ||
    !memo.includes(REQUIRED_WINDOW) ||
    !memo.includes(`phrase=${phrase}`)
  ) {
    return json({
      error: "clerk refused the filing",
      hint: "wrong desk, wrong ink, or wrong phrase",
    }, 403);
  }

  return json({
    status: "accepted",
    flag: makeFlag(wallet, signature),
  });
}
