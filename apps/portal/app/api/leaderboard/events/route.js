import { LeaderboardError, verifySolveEventRequest } from "@ctf26/leaderboard";
import { NextResponse } from "next/server";

import { createLeaderboardStore } from "@/lib/leaderboard-store.mjs";
import { evaluateFastSolveReview } from "@/lib/fast-solve-delivery.mjs";
import { assertScoreEventAllowed } from "@/lib/leaderboard-config.mjs";
import { resolveLeaderboardConfig } from "@/lib/leaderboard-lifecycle.mjs";
import { challengeTicketSecret } from "@/lib/tickets";
import { consumePortalRequestBudget, portalBudgetErrorResponse } from "@/lib/request-budget.mjs";

export const dynamic = "force-dynamic";

function reply(body, status) {
  return NextResponse.json(body, {
    status,
    headers: {
      "cache-control": "no-store, max-age=0",
      "referrer-policy": "no-referrer",
    },
  });
}

async function readScoreEventBody(request) {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 4_096) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks).toString("utf8");
}

export async function POST(request) {
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > 4_096) return reply({ error: "score event is too large" }, 413);
  try {
    await consumePortalRequestBudget("scoreAttempt", { request });
  } catch (error) {
    const budgetResponse = portalBudgetErrorResponse(error);
    if (budgetResponse) return budgetResponse;
    throw error;
  }
  const rawBody = await readScoreEventBody(request);
  if (rawBody === null) return reply({ error: "score event is too large" }, 413);

  const challenge = String(request.headers.get("x-ctf-challenge") || "");
  try {
    const store = createLeaderboardStore();
    const activeConfig = await resolveLeaderboardConfig({ store });
    const event = verifySolveEventRequest({
      rawBody,
      timestamp: request.headers.get("x-ctf-timestamp"),
      signature: request.headers.get("x-ctf-signature"),
      secret: challengeTicketSecret(challenge),
      eventId: activeConfig.eventGeneration,
    });
    if (event.challenge !== challenge) return reply({ error: "challenge signature mismatch" }, 401);
    await consumePortalRequestBudget("scoreIngest", {
      request,
      participantId: event.participantId,
    });
    let config;
    try {
      config = assertScoreEventAllowed(event, process.env, new Date(), activeConfig);
    } catch {
      if (activeConfig.practiceParticipantIds.includes(event.participantId)) {
        return reply({ accepted: true, practice: true }, 202);
      }
      return reply({ error: "score event is outside the active event field or scoring window" }, 409);
    }
    await store.assertEventConfig(config.configHash);
    await evaluateFastSolveReview({ store, event, eventGeneration: config.eventGeneration });
    const created = await store.recordSolve(event);
    return reply({ accepted: true, duplicate: !created }, created ? 201 : 200);
  } catch (error) {
    const budgetResponse = portalBudgetErrorResponse(error);
    if (budgetResponse) return budgetResponse;
    if (error instanceof LeaderboardError || /unknown challenge audience/.test(String(error?.message))) {
      return reply({ error: "score event is not authorized" }, 401);
    }
    console.error("score event ingest failed", error);
    return reply({ error: "score event could not be stored" }, 503);
  }
}
