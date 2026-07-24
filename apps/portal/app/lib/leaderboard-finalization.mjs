import crypto from "node:crypto";

function normalizedCase(entry) {
  const participantId = String(entry?.participantId || "");
  return {
    id: String(entry?.id || ""),
    challenge: String(entry?.challenge || ""),
    eventId: String(entry?.eventId || ""),
    participantId,
    status: String(entry?.status || ""),
    updatedAt: Number(entry?.updatedAt || 0),
  };
}

export function activeIntegrityCases(report, config) {
  if (!report || typeof report !== "object" || !Array.isArray(report.cases)) {
    throw new Error("integrity review is malformed");
  }
  return report.cases.filter((entry) => {
    const expectedEventId = entry?.challenge === "reward-sniper"
      ? config.rewardEventId
      : config.eventGeneration;
    return String(entry?.eventId || "") === expectedEventId;
  });
}

export function integrityReviewSeal(report, config) {
  if (String(report?.event?.eventId || "") !== config.rewardEventId) {
    throw new Error("integrity review belongs to another Reward Sniper event");
  }
  if (String(report?.event?.stage || "") !== "complete") {
    throw new Error("Reward Sniper integrity review is not complete");
  }
  const generatedAt = Number(report?.generatedAt);
  if (!Number.isFinite(generatedAt) || generatedAt <= 0) {
    throw new Error("integrity review timestamp is invalid");
  }
  const cases = activeIntegrityCases(report, config);
  const normalized = cases.map(normalizedCase).sort((left, right) => (
    left.id.localeCompare(right.id)
    || left.challenge.localeCompare(right.challenge)
    || left.participantId.localeCompare(right.participantId)
  ));
  return Object.freeze({
    rewardEventId: config.rewardEventId,
    eventGeneration: config.eventGeneration,
    reportGeneratedAt: new Date(generatedAt).toISOString(),
    activeCaseCount: normalized.length,
    digest: crypto.createHash("sha256").update(JSON.stringify(normalized)).digest("hex"),
  });
}

export function assertIntegrityIngestFrozen(report, config) {
  const freeze = report?.event?.ingestFreeze;
  if (
    report?.event?.ingestFrozen !== true
    || !freeze
    || String(freeze.eventId || "") !== config.rewardEventId
    || String(freeze.eventGeneration || "") !== config.eventGeneration
    || String(freeze.scoringConfigHash || "").toLowerCase() !== config.rewardScoringConfigHash
    || !Number.isSafeInteger(Number(freeze.frozenAt))
    || Number(freeze.frozenAt) <= 0
  ) {
    throw new Error("integrity ingest is not durably frozen for this event configuration");
  }
  return Object.freeze({
    eventId: config.rewardEventId,
    eventGeneration: config.eventGeneration,
    scoringConfigHash: config.rewardScoringConfigHash,
    frozenAt: new Date(Number(freeze.frozenAt)).toISOString(),
  });
}

export function assertIntegrityReviewFrozen(report, config, review) {
  const freeze = report?.event?.reviewFreeze;
  if (
    report?.event?.reviewFrozen !== true
    || !freeze
    || String(freeze.eventId || "") !== config.rewardEventId
    || String(freeze.eventGeneration || "") !== config.eventGeneration
    || String(freeze.scoringConfigHash || "").toLowerCase() !== config.rewardScoringConfigHash
    || String(freeze.digest || "").toLowerCase() !== review.digest
    || Number(freeze.activeCaseCount) !== review.activeCaseCount
    || !Number.isSafeInteger(Number(freeze.frozenAt))
    || Number(freeze.frozenAt) <= 0
  ) {
    throw new Error("integrity review is not durably sealed for this event configuration");
  }
  return Object.freeze({
    eventId: config.rewardEventId,
    eventGeneration: config.eventGeneration,
    scoringConfigHash: config.rewardScoringConfigHash,
    digest: review.digest,
    activeCaseCount: review.activeCaseCount,
    frozenAt: new Date(Number(freeze.frozenAt)).toISOString(),
  });
}

export function missingRulesAcknowledgments({
  roster,
  checkedInParticipantIds,
  acknowledgments,
  rulesVersion,
}) {
  if (!(roster instanceof Map)) throw new Error("participant roster is unavailable");
  const checkedIn = new Set(checkedInParticipantIds.map(String));
  const current = new Map((acknowledgments || []).map((entry) => [String(entry?.participantId || ""), entry]));
  return [...roster.values()]
    .filter((entry) => checkedIn.has(entry.participantId))
    .filter((entry) => {
      const acknowledgment = current.get(entry.participantId);
      return !acknowledgment
        || acknowledgment.participantId !== entry.participantId
        || acknowledgment.rulesVersion !== rulesVersion;
    });
}
