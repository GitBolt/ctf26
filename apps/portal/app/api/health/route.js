import { NextResponse } from "next/server";

import { cachedPortalHealth } from "@/lib/health.mjs";
import { consumePortalRequestBudget, portalBudgetErrorResponse } from "@/lib/request-budget.mjs";

export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    await consumePortalRequestBudget("health", { request });
    return NextResponse.json(await cachedPortalHealth(), {
      headers: { "cache-control": "no-store", "referrer-policy": "no-referrer" },
    });
  } catch (error) {
    const budgetResponse = portalBudgetErrorResponse(error);
    if (budgetResponse) return budgetResponse;
    console.error("portal health check failed", error);
    return NextResponse.json(
      { ok: false, error: "portal configuration unavailable" },
      { status: 503, headers: { "cache-control": "no-store", "referrer-policy": "no-referrer" } },
    );
  }
}
