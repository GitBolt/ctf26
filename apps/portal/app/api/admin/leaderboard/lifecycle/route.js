import { NextResponse } from "next/server";

import { currentUser, isOrganizer } from "@/lib/auth";
import {
  configForLifecyclePhase,
  nextLifecyclePhase,
  resolveLeaderboardConfig,
} from "@/lib/leaderboard-lifecycle.mjs";
import { createLeaderboardStore } from "@/lib/leaderboard-store.mjs";
import { assertOrganizerQuorum } from "@/lib/organizers.mjs";
import { consumePortalRequestBudget, portalBudgetErrorResponse } from "@/lib/request-budget.mjs";

export const dynamic = "force-dynamic";

function reply(body, status = 200) {
  return NextResponse.json(body, { status, headers: { "cache-control": "no-store" } });
}

export async function POST(request) {
  const user = await currentUser();
  if (!user || !isOrganizer(user)) return reply({ error: "not authorized" }, 403);

  try {
    assertOrganizerQuorum();
    await consumePortalRequestBudget("adminCritical", { request, participantId: user.email });
    const body = await request.json();
    const store = createLeaderboardStore();
    const current = await resolveLeaderboardConfig({ store, organizer: user.email });

    if (body?.action === "pause" || body?.action === "resume") {
      const paused = body.action === "pause";
      if (!paused && String(process.env.LEADERBOARD_LAUNCH_PAUSED || "").toLowerCase() === "true") {
        return reply({ error: "deployment-level emergency pause is still enabled" }, 409);
      }
      const lifecycle = await store.setEventLaunchPaused({
        paused,
        configHash: current.configHash,
        organizer: user.email,
      });
      return reply({ lifecycle });
    }

    if (body?.action !== "advance") return reply({ error: "action must be pause, resume, or advance" }, 400);
    const target = nextLifecyclePhase(current.scoringMode);
    if (!target) return reply({ error: "event lifecycle is already frozen" }, 409);
    if (target === "frozen") return reply({ error: "seal the final leaderboard to freeze the event" }, 409);
    if (String(body.phase || "") !== target) return reply({ error: `next lifecycle phase must be ${target}` }, 409);

    const targetConfig = configForLifecyclePhase(target);
    if (targetConfig.configHash !== current.configHash) {
      return reply({ error: "official event settings must be complete and immutable before advancing" }, 409);
    }
    if (target === "freezing") {
      const recoveryEndsAt = new Date(targetConfig.scoringEndAt).valueOf() + targetConfig.recoveryMinutes * 60_000;
      if (Date.now() < recoveryEndsAt) return reply({ error: "the signed score recovery window is still open" }, 409);
      const pendingFastSolveReviews = (await store.fastSolveReviews())
        .filter((entry) => entry.deliveryStatus !== "delivered");
      if (pendingFastSolveReviews.length > 0) {
        return reply({ error: "deliver every fast-solve review signal before beginning final review" }, 409);
      }
    }
    const lifecycle = await store.advanceEventLifecycle({
      phase: target,
      configHash: targetConfig.configHash,
      organizer: user.email,
    });
    return reply({ lifecycle });
  } catch (error) {
    const budgetResponse = portalBudgetErrorResponse(error);
    if (budgetResponse) return budgetResponse;
    const message = String(error?.message || "event lifecycle could not be updated");
    const status = /invalid|must|requires|cannot|closed|phase|configuration|pause|window|settings/.test(message) ? 409 : 503;
    if (status === 503) console.error("event lifecycle update failed", error);
    return reply({ error: message }, status);
  }
}
