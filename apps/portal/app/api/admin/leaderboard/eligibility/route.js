import { NextResponse } from "next/server";

import { currentUser, isOrganizer } from "@/lib/auth";
import { resolveLeaderboardConfig } from "@/lib/leaderboard-lifecycle.mjs";
import { createLeaderboardStore } from "@/lib/leaderboard-store.mjs";
import { assertOrganizerQuorum } from "@/lib/organizers.mjs";
import { consumePortalRequestBudget, portalBudgetErrorResponse } from "@/lib/request-budget.mjs";

export const dynamic = "force-dynamic";

function organizerEmail(user) {
  return String(user?.email || "").trim().toLowerCase();
}

export async function GET(request) {
  const user = await currentUser();
  if (!user || !isOrganizer(user)) return NextResponse.json({ error: "not authorized" }, { status: 403 });
  try {
    assertOrganizerQuorum();
    await consumePortalRequestBudget("adminMutation", { request, participantId: user.email });
    const store = createLeaderboardStore();
    const [ledger, proposals] = await Promise.all([
      store.eligibilityLedger(),
      store.eligibilityProposals(),
    ]);
    return NextResponse.json({
      decisions: ledger.decisions,
      proposals,
      revision: ledger.revision,
      frozen: ledger.frozen,
      frozenAt: ledger.freeze?.acquiredAt || null,
    }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    const budgetResponse = portalBudgetErrorResponse(error);
    if (budgetResponse) return budgetResponse;
    console.error("eligibility read failed", error);
    return NextResponse.json({ error: "eligibility ledger is unavailable" }, { status: 503 });
  }
}

export async function POST(request) {
  const user = await currentUser();
  if (!user || !isOrganizer(user)) return NextResponse.json({ error: "not authorized" }, { status: 403 });
  try {
    assertOrganizerQuorum();
    await consumePortalRequestBudget("adminMutation", { request, participantId: user.email });
    const store = createLeaderboardStore();
    const lifecycle = await resolveLeaderboardConfig({ store, organizer: user.email });
    if (lifecycle.scoringMode === "frozen") {
      return NextResponse.json({ error: "eligibility ledger is frozen" }, { status: 409 });
    }
    const body = await request.json();
    if (body?.action === "propose") {
      if (!lifecycle.checkedInParticipantIds.includes(String(body.participantId || ""))) {
        return NextResponse.json({ error: "participant is not checked in for this event" }, { status: 400 });
      }
      const proposal = await store.proposeEligibilityDecision({
        participantId: body.participantId,
        status: body.status,
        reason: body.reason,
        organizer: organizerEmail(user),
      });
      return NextResponse.json({ proposal }, { status: 201, headers: { "cache-control": "no-store" } });
    }
    if (body?.action === "approve") {
      const decision = await store.approveEligibilityDecision(body.proposalId, organizerEmail(user));
      return NextResponse.json({ decision }, { headers: { "cache-control": "no-store" } });
    }
    if (body?.action === "reject") {
      const proposal = await store.rejectEligibilityProposal(body.proposalId, organizerEmail(user));
      return NextResponse.json({ proposal }, { headers: { "cache-control": "no-store" } });
    }
    return NextResponse.json({ error: "action must be propose, approve, or reject" }, { status: 400 });
  } catch (error) {
    const message = String(error?.message || "eligibility update failed");
    const status = /frozen/.test(message)
      ? 409
      : /invalid|must|contain|not found|already|second organizer/.test(message)
        ? 400
        : 503;
    if (status === 503) console.error("eligibility update failed", error);
    return NextResponse.json({ error: message }, { status, headers: { "cache-control": "no-store" } });
  }
}
