import { fastSolveReviewCandidate } from "./fast-solve.mjs";
import { recordFastSolveReview } from "./integrity.mjs";

export async function evaluateFastSolveReview({
  store,
  event,
  eventGeneration,
  env = process.env,
  fetchImpl = fetch,
  logger = console,
}) {
  if (
    typeof store?.challengeLaunch !== "function"
    || typeof store?.recordFastSolveReview !== "function"
    || typeof store?.markFastSolveReviewDelivered !== "function"
  ) {
    return Object.freeze({ review: false, deliveryStatus: "unsupported-store" });
  }
  const launch = await store.challengeLaunch(event.challenge, event.participantId);
  const candidate = fastSolveReviewCandidate({ launch, event, env });
  if (!candidate) return Object.freeze({ review: false, deliveryStatus: "not-applicable" });

  const review = await store.recordFastSolveReview(candidate);
  if (review.deliveryStatus === "delivered") {
    return Object.freeze({ review: true, deliveryStatus: "delivered", caseId: review.caseId });
  }

  try {
    const delivered = await recordFastSolveReview(review, eventGeneration, { env, fetchImpl });
    await store.markFastSolveReviewDelivered(
      review.challenge,
      review.participantId,
      delivered.caseId,
    );
    return Object.freeze({ review: true, deliveryStatus: "delivered", caseId: delivered.caseId });
  } catch (error) {
    // Scoring must never change because an integrity-review dependency is down.
    // The Redis record remains pending and is surfaced in the organizer console.
    logger.error?.("fast-solve integrity delivery failed", {
      challenge: review.challenge,
      participantId: review.participantId,
      error: error?.message || String(error),
    });
    return Object.freeze({ review: true, deliveryStatus: "pending", caseId: null });
  }
}
