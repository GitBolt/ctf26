import { NextResponse } from "next/server";

import { leaderboardSnapshot } from "@/lib/leaderboard-service.mjs";
import { consumePortalRequestBudget, portalBudgetErrorResponse } from "@/lib/request-budget.mjs";

export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    await consumePortalRequestBudget("leaderboardRead", { request });
    const snapshot = await leaderboardSnapshot();
    return NextResponse.json(snapshot, {
      headers: {
        "cache-control": "public, s-maxage=3, stale-while-revalidate=12",
        "referrer-policy": "no-referrer",
      },
    });
  } catch (error) {
    const budgetResponse = portalBudgetErrorResponse(error);
    if (budgetResponse) return budgetResponse;
    console.error("leaderboard snapshot failed", error);
    return NextResponse.json(
      { error: "leaderboard temporarily unavailable" },
      { status: 503, headers: { "cache-control": "no-store, max-age=0" } },
    );
  }
}
