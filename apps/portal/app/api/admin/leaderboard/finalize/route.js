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
    // Close signal intake so the final snapshot can preserve one stable,
    // read-only evidence digest without making integrity data part of scoring.
    await freezeRewardIntegrityIngest(config, user.email);
    const lockToken = crypto.randomUUID();
    await store.acquireFinalizationLock(lockToken, 300);
    try {
      const [stableSnapshot, integrity] = await Promise.all([
        leaderboardSnapshot({ store, config, skipSharedCache: true }),
        rewardIntegrityReport(),
      ]);
      assertAuthoritativeRewardSource(stableSnapshot, config);
      assertIntegrityIngestFrozen(integrity, config);
      const integrityReview = integrityReviewSeal(integrity, config);

      // Reward seals the observation digest while the Redis finalization lock
      // blocks late score writes. Observations never remove a participant.
      await sealRewardIntegrityReview(config, user.email, integrityReview);
      const snapshot = await leaderboardSnapshot({ store, config, skipSharedCache: true });
      assertAuthoritativeRewardSource(snapshot, config);

      const sealedIntegrity = await rewardIntegrityReport();
      const sealedReview = integrityReviewSeal(sealedIntegrity, config);
      if (sealedReview.digest !== integrityReview.digest || sealedReview.activeCaseCount !== integrityReview.activeCaseCount) {
        throw new Error("integrity review changed before the final leaderboard could be sealed");
      }
      assertIntegrityReviewFrozen(sealedIntegrity, config, sealedReview);
      const final = await store.sealFinalPublicSnapshot({
        ...snapshot,
        integrityEvidence: sealedReview,
      }, { finalizationToken: lockToken });
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
        snapshotRevision: final.snapshotRevision,
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
