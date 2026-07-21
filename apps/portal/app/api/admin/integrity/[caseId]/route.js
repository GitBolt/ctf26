import { NextResponse } from "next/server";
import { currentUser, isOrganizer } from "@/lib/auth";
import { updateRewardIntegrityCase } from "@/lib/integrity.mjs";
import { createLeaderboardStore } from "@/lib/leaderboard-store.mjs";
import { consumePortalRequestBudget, portalBudgetErrorResponse } from "@/lib/request-budget.mjs";

export async function POST(request, { params }) {
  const user = await currentUser();
  if (!user || !isOrganizer(user)) return NextResponse.json({ error: "not authorized" }, { status: 403 });
  try {
    await consumePortalRequestBudget("adminMutation", { request, participantId: user.email });
    await createLeaderboardStore().assertIntegrityReviewWritable();
    const { caseId } = await params;
    const form = await request.formData();
    await updateRewardIntegrityCase(caseId, {
      status: String(form.get("status") || ""),
      note: String(form.get("note") || ""),
    }, user.email);
    return NextResponse.redirect(new URL("/admin", request.url), 303);
  } catch (error) {
    const budgetResponse = portalBudgetErrorResponse(error);
    if (budgetResponse) return budgetResponse;
    const message = String(error?.message || "integrity review could not be updated");
    if (/frozen/.test(message)) return NextResponse.json({ error: message }, { status: 409 });
    console.error("integrity review update failed", error);
    return NextResponse.json({ error: "integrity review could not be updated" }, { status: 503 });
  }
}
