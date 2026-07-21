import { NextResponse } from "next/server";

import { currentUser, isOrganizer } from "@/lib/auth";
import { recordFastSolveReview } from "@/lib/integrity.mjs";
import { assertIntegrityWriteAllowed } from "@/lib/integrity-lifecycle.mjs";
import { createLeaderboardStore } from "@/lib/leaderboard-store.mjs";
import { consumePortalRequestBudget, portalBudgetErrorResponse } from "@/lib/request-budget.mjs";

export async function POST(request) {
  const user = await currentUser();
  if (!user || !isOrganizer(user)) {
    return NextResponse.json({ error: "not authorized" }, { status: 403 });
  }
  try {
    await consumePortalRequestBudget("adminMutation", { request, participantId: user.email });
    const config = await assertIntegrityWriteAllowed();
    const store = createLeaderboardStore();
    const pending = (await store.fastSolveReviews())
      .filter((entry) => entry.deliveryStatus !== "delivered")
      .slice(0, 100);
    let delivered = 0;
    for (const review of pending) {
      try {
        const result = await recordFastSolveReview(review, config.eventGeneration);
        await store.markFastSolveReviewDelivered(review.challenge, review.participantId, result.caseId);
        delivered += 1;
      } catch (error) {
        console.error("fast-solve integrity retry failed", {
          challenge: review.challenge,
          participantId: review.participantId,
          error: error?.message || String(error),
        });
      }
    }
    const url = new URL("/admin", request.url);
    url.searchParams.set("integritySynced", String(delivered));
    return NextResponse.redirect(url, 303);
  } catch (error) {
    const budgetResponse = portalBudgetErrorResponse(error);
    if (budgetResponse) return budgetResponse;
    const message = String(error?.message || "integrity signal delivery failed");
    if (/frozen/.test(message)) return NextResponse.json({ error: message }, { status: 409 });
    console.error("fast-solve integrity retry failed", error);
    return NextResponse.json({ error: "integrity signal delivery failed" }, { status: 503 });
  }
}
