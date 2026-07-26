import { cookies } from "next/headers";

import {
  IMPRINT_SESSION_COOKIE,
  verifyChallengeSession,
} from "@/lib/challenge-session.mjs";
import {
  consumeImprintRequestBudget,
  imprintRequestErrorResponse,
  imprintRpcCost,
  readBoundedText,
} from "@/lib/request-budget.mjs";

const MAX_BODY_BYTES = 128 * 1024;
export const runtime = "nodejs";
const ALLOWED_METHODS = new Set([
  "getAccountInfo",
  "getLatestBlockhash",
  "getMinimumBalanceForRentExemption",
  "getMultipleAccounts",
  "getSignatureStatuses",
  "sendTransaction",
  "simulateTransaction",
]);

export async function POST(request) {
  let session;
  try {
    const jar = await cookies();
    session = verifyChallengeSession(jar.get(IMPRINT_SESSION_COOKIE)?.value);
  } catch {
    return Response.json(
      { error: "challenge session is required" },
      { status: 401 }
    );
  }
  const rpcUrl = String(process.env.SOLANA_RPC_URL || "");
  if (!rpcUrl)
    return Response.json({ error: "RPC unavailable" }, { status: 503 });

  let body;
  try {
    body = await readBoundedText(request, MAX_BODY_BYTES);
  } catch (error) {
    const controlled = imprintRequestErrorResponse(error);
    if (controlled) return controlled;
    throw error;
  }
  let payload;
  try {
    payload = JSON.parse(body);
  } catch {
    return Response.json({ error: "invalid JSON" }, { status: 400 });
  }
  const calls = Array.isArray(payload) ? payload : [payload];
  if (
    !calls.length ||
    calls.length > 10 ||
    calls.some((call) => !ALLOWED_METHODS.has(call?.method))
  ) {
    return Response.json({ error: "RPC method unavailable" }, { status: 403 });
  }
  try {
    await consumeImprintRequestBudget("rpc", {
      request,
      participantId: session.participantId,
      cost: imprintRpcCost(calls),
    });
  } catch (error) {
    const controlled = imprintRequestErrorResponse(error);
    if (controlled) return controlled;
    throw error;
  }

  let upstream;
  try {
    upstream = await fetch(rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return Response.json(
      { error: "RPC upstream unavailable" },
      { status: 504 }
    );
  }
  return new Response(await upstream.arrayBuffer(), {
    status: upstream.status,
    headers: {
      "content-type":
        upstream.headers.get("content-type") || "application/json",
      "cache-control": "no-store",
    },
  });
}
