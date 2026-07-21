const MINIMUM_REVIEW_SECONDS = 60;
const MAXIMUM_REVIEW_SECONDS = 3_600;
const EARLY_COMPLETION_CLOCK_SKEW_SECONDS = 5;

export function fastSolveReviewSeconds(env = process.env) {
  const encoded = String(env.FAST_SOLVE_REVIEW_SECONDS ?? "300").trim();
  const seconds = Number(encoded);
  if (
    !Number.isSafeInteger(seconds)
    || seconds < MINIMUM_REVIEW_SECONDS
    || seconds > MAXIMUM_REVIEW_SECONDS
  ) {
    throw new Error("FAST_SOLVE_REVIEW_SECONDS must be an integer between 60 and 3600");
  }
  return seconds;
}

export function fastSolveReviewCandidate({ launch, event, env = process.env }) {
  if (!launch || !event || launch.challenge !== event.challenge) return null;
  if (String(launch.participantId || "") !== String(event.participantId || "")) return null;

  const launchedAt = new Date(String(launch.launchedAt || ""));
  const completedAt = new Date(String(event.occurredAt || ""));
  if (Number.isNaN(launchedAt.valueOf()) || Number.isNaN(completedAt.valueOf())) return null;

  const elapsedMs = completedAt.valueOf() - launchedAt.valueOf();
  const thresholdSeconds = fastSolveReviewSeconds(env);
  if (
    elapsedMs >= thresholdSeconds * 1_000
    || (elapsedMs < 0 && elapsedMs >= -EARLY_COMPLETION_CLOCK_SKEW_SECONDS * 1_000)
  ) return null;

  return Object.freeze({
    challenge: event.challenge,
    participantId: event.participantId,
    email: String(launch.email || ""),
    launchedAt: launchedAt.toISOString(),
    completedAt: completedAt.toISOString(),
    elapsedSeconds: Math.floor(elapsedMs / 1_000),
    timing: elapsedMs < 0 ? "before-launch" : "after-launch",
    thresholdSeconds,
    sourceId: String(event.sourceId || ""),
  });
}
