import crypto from "node:crypto";
import { NextResponse } from "next/server";

import { currentUser, isOrganizer } from "@/lib/auth";
import { freezeRewardIntegrityIngest, rewardIntegrityReport, sealRewardIntegrityReview } from "@/lib/integrity.mjs";
import { assertIntegrityIngestFrozen, assertIntegrityReviewFrozen, integrityReviewSeal, missingRulesAcknowledgments } from "@/lib/leaderboard-finalization.mjs";
import { resolveLeaderboardConfig } from "@/lib/leaderboard-lifecycle.mjs";
import { leaderboardSnapshot } from "@/lib/leaderboard-service.mjs";
import { createLeaderboardStore } from "@/lib/leaderboard-store.mjs";
import { participantRoster } from "@/lib/registration.mjs";
import { RULES_VERSION } from "@/lib/tickets";
import { assertOrganizerQuorum } from "@/lib/organizers.mjs";
import { consumePortalRequestBudget, portalBudgetErrorResponse } from "@/lib/request-budget.mjs";

export const dynamic = "force-dynamic";

function assertAuthoritativeRewardSource(snapshot, config) {
  if (
    snapshot.performanceSource?.available !== true
    || snapshot.performanceSource?.stale === true
    || snapshot.performanceSource?.eventId !== config.rewardEventId
    || snapshot.performanceSource?.eventGeneration !== config.eventGeneration
    || snapshot.performanceSource?.scoringConfigHash !== config.rewardScoringConfigHash
    || snapshot.performanceSource?.stage !== "complete"
  ) {
    throw new Error("Reward Sniper is not a complete authoritative final source");
  }
}

export async function POST(request) {
  const user = await currentUser();
  if (!user || !isOrganizer(user)) {
    return NextResponse.json({ error: "not authorized" }, { status: 403 });
  }

  try {
    assertOrganizerQuorum();
    await consumePortalRequestBudget("adminCritical", { request, participantId: user.email });
    const store = createLeaderboardStore();
    const config = await resolveLeaderboardConfig({ store, organizer: user.email });
    if (config.scoringMode !== "freezing") {
      return NextResponse.json({ error: "switch scoring mode to freezing before finalization" }, { status: 409 });
    }
    const recoveryEndsAt = new Date(config.scoringEndAt).valueOf() + config.recoveryMinutes * 60_000;
    if (Date.now() < recoveryEndsAt) {
      return NextResponse.json({ error: "the signed score recovery window is still open" }, { status: 409 });
    }

    await store.assertEventConfig(config.configHash);
    const [preview, acknowledgments] = await Promise.all([
      leaderboardSnapshot({ store, skipSharedCache: true }),
      store.rulesAcknowledgments(),
    ]);
    assertAuthoritativeRewardSource(preview, config);
    const missingAcknowledgments = missingRulesAcknowledgments({
      roster: participantRoster(),
      checkedInParticipantIds: config.checkedInParticipantIds,
      acknowledgments,
      rulesVersion: RULES_VERSION,
    });
    if (missingAcknowledgments.length > 0) {
      return NextResponse.json({
        error: `${missingAcknowledgments.length} checked-in participant${missingAcknowledgments.length === 1 ? " has" : "s have"} not acknowledged the current rules`,
      }, { status: 409 });
    }
    // Close signal intake first. If review is incomplete, eligibility remains
    // writable and the next finalization attempt resumes from this durable phase.
    await freezeRewardIntegrityIngest(config, user.email);
    const lockToken = crypto.randomUUID();
    await store.acquireFinalizationLock(lockToken, 300);
    try {
      const [stableSnapshot, integrity, fastSolveReviews, proposals, eligibility] = await Promise.all([
        leaderboardSnapshot({ store, config, skipSharedCache: true }),
        rewardIntegrityReport(),
        store.fastSolveReviews(),
        store.eligibilityProposals(),
        store.eligibilityLedger(),
      ]);
      const pendingFastSolveReviews = fastSolveReviews.filter((entry) => entry.deliveryStatus !== "delivered");
      if (pendingFastSolveReviews.length > 0) {
        return NextResponse.json({
          error: `${pendingFastSolveReviews.length} fast-solve review signal${pendingFastSolveReviews.length === 1 ? " is" : "s are"} still waiting for delivery`,
        }, { status: 409 });
      }
      if (proposals.some((entry) => entry.state === "proposed")) {
        return NextResponse.json({ error: "approve or reject every eligibility proposal before finalization" }, { status: 409 });
      }
      if (eligibility.decisions.some((entry) => entry.state === "approved" && entry.status === "held")) {
        return NextResponse.json({ error: "resolve every eligibility hold before finalization" }, { status: 409 });
      }
      assertAuthoritativeRewardSource(stableSnapshot, config);
      assertIntegrityIngestFrozen(integrity, config);
      const integrityReview = integrityReviewSeal(
        integrity,
        config,
        stableSnapshot.eligibility.disqualifiedParticipantIds,
      );

      // Reward seals the case digest before the portal freezes eligibility. The
      // Redis finalization lock blocks concurrent eligibility mutations, while
      // Reward rejects the seal if an already-running case review changed it.
      await sealRewardIntegrityReview(config, user.email, integrityReview);
      const freeze = await store.acquireEligibilityFreeze({
        configHash: config.configHash,
        eventGeneration: config.eventGeneration,
        rewardEventId: config.rewardEventId,
        organizer: user.email,
      });
      const snapshot = await leaderboardSnapshot({ store, config, skipSharedCache: true });
      assertAuthoritativeRewardSource(snapshot, config);
      if (snapshot.eligibilityRevision !== freeze.revision || snapshot.eligibility?.frozen !== true) {
        throw new Error("eligibility changed while the final leaderboard was being calculated");
      }

      const sealedIntegrity = await rewardIntegrityReport();
      const sealedReview = integrityReviewSeal(sealedIntegrity, config, snapshot.eligibility.disqualifiedParticipantIds);
      if (sealedReview.digest !== integrityReview.digest || sealedReview.activeCaseCount !== integrityReview.activeCaseCount) {
        throw new Error("integrity review changed before the final leaderboard could be sealed");
      }
      assertIntegrityReviewFrozen(sealedIntegrity, config, sealedReview);
      const final = await store.sealFinalPublicSnapshot({
        ...snapshot,
        eligibilityFrozenAt: freeze.acquiredAt,
        integrityReview: sealedReview,
      }, { freezeToken: freeze.token });
      await store.advanceEventLifecycle({
        phase: "frozen",
        configHash: config.configHash,
        organizer: user.email,
      });
      return NextResponse.json({
        finalized: true,
        finalizedAt: final.finalizedAt,
        eventGeneration: final.eventGeneration,
        configHash: final.configHash,
        eligibilityRevision: final.eligibilityRevision,
      }, { headers: { "cache-control": "no-store", "referrer-policy": "no-referrer" } });
    } finally {
      await store.releaseFinalizationLock(lockToken).catch(() => null);
    }
  } catch (error) {
    const budgetResponse = portalBudgetErrorResponse(error);
    if (budgetResponse) return budgetResponse;
    const message = String(error?.message || "leaderboard could not be finalized");
    if (/not complete|another|resolve every|acknowledged|changed while|changed before|frozen|sealed|configuration|recovery window|integrity ingest|integrity review/.test(message)) {
      return NextResponse.json({ error: message }, { status: 409, headers: { "cache-control": "no-store" } });
    }
    console.error("leaderboard finalization failed", error);
    return NextResponse.json({ error: "leaderboard could not be finalized" }, { status: 503 });
  }
}
