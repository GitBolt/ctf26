import { NextResponse } from "next/server";
import { currentUser, isOrganizer } from "@/lib/auth";
import { resetRewardSniperEvent } from "@/lib/integrity.mjs";
import { assertIntegrityWriteAllowed } from "@/lib/integrity-lifecycle.mjs";
import { consumePortalRequestBudget, portalBudgetErrorResponse } from "@/lib/request-budget.mjs";

export async function POST(request) {
  const user = await currentUser();
  if (!user || !isOrganizer(user)) return NextResponse.json({ error: "not authorized" }, { status: 403 });
  try {
    await consumePortalRequestBudget("adminCritical", { request, participantId: user.email });
    const config = await assertIntegrityWriteAllowed();
    if (config.scoringMode !== "staging") {
      return NextResponse.json({ error: "Reward Sniper reset is locked outside staging" }, { status: 409 });
    }
    const form = await request.formData();
    const eventId = String(form.get("eventId") || "");
    if (String(form.get("confirmation") || "") !== eventId) {
      return NextResponse.json({ error: "type the current event ID to confirm reset" }, { status: 400 });
    }
    await resetRewardSniperEvent(eventId, user.email);
    return NextResponse.redirect(new URL("/admin?event=reset", request.url), 303);
  } catch (error) {
    const budgetResponse = portalBudgetErrorResponse(error);
    if (budgetResponse) return budgetResponse;
    const message = String(error?.message || "Reward Sniper event could not be reset");
    if (/frozen/.test(message)) return NextResponse.json({ error: message }, { status: 409 });
    console.error("Reward Sniper event reset failed", error);
    return NextResponse.json({ error: "Reward Sniper event could not be reset" }, { status: 503 });
  }
}
