import { clockDerivedScoringMode, leaderboardConfig, presentField } from "./leaderboard-config.mjs";
import { RULES_VERSION } from "./tickets.js";

export const LIFECYCLE_PHASES = Object.freeze(["staging", "live", "recovery", "freezing", "frozen"]);

function rank(phase) {
  return LIFECYCLE_PHASES.indexOf(String(phase || ""));
}

export function configForLifecyclePhase(phase, env = process.env) {
  if (!LIFECYCLE_PHASES.includes(phase)) throw new Error("event lifecycle phase is invalid");
  return leaderboardConfig({ ...env, LEADERBOARD_SCORING_MODE: phase });
}

export function nextLifecyclePhase(phase) {
  const index = rank(phase);
  return index >= 0 && index < LIFECYCLE_PHASES.length - 1
    ? LIFECYCLE_PHASES[index + 1]
    : null;
}

export async function resolveLeaderboardConfig({
  env = process.env,
  store,
  organizer = "system",
  now = new Date(),
  rulesVersion = RULES_VERSION,
} = {}) {
  const configured = leaderboardConfig(env);
  if (
    !store
    || typeof store.initializeEventLifecycle !== "function"
    || typeof store.advanceEventLifecycle !== "function"
  ) {
    const presence = store
      ? await presentField({ store, env, rulesVersion })
      : {
        checkedInParticipantIds: configured.checkedInParticipantIds,
        fieldSize: configured.fieldSize,
        source: "config",
      };
    const scoringMode = clockDerivedScoringMode(configured, configured.scoringMode, now);
    return Object.freeze({
      ...configured,
      scoringMode,
      checkedInParticipantIds: presence.checkedInParticipantIds,
      fieldSize: presence.fieldSize,
      presenceSource: presence.source,
    });
  }

  await store.assertEventConfig(configured.configHash);
  if (typeof store.assertFastSolveConfig === "function") {
    await store.assertFastSolveConfig(configured.fastSolveSeconds);
  }
  let lifecycle = await store.initializeEventLifecycle({
    phase: "staging",
    launchPaused: configured.launchPaused,
    configHash: configured.configHash,
    organizer,
  });

  if (configured.timedEvent) {
    const current = new Date(now);
    const startsAt = new Date(configured.scoringStartAt);
    const endsAt = new Date(configured.scoringEndAt);
    if (!Number.isNaN(current.valueOf()) && current >= startsAt && lifecycle.phase === "staging") {
      lifecycle = await store.advanceEventLifecycle({
        phase: "live",
        configHash: configured.configHash,
        organizer: "event-clock",
      });
    }
    if (!Number.isNaN(current.valueOf()) && current > endsAt && lifecycle.phase === "live") {
      lifecycle = await store.advanceEventLifecycle({
        phase: "recovery",
        configHash: configured.configHash,
        organizer: "event-clock",
      });
    }
  }

  // A deployment may request an older mode, but it can never roll an event
  // back after official scoring has started. Revalidate all official-only
  // settings against the durable phase before accepting any traffic.
  const effective = leaderboardConfig({
    ...env,
    LEADERBOARD_SCORING_MODE: lifecycle.phase,
    LEADERBOARD_LAUNCH_PAUSED: String(configured.launchPaused || lifecycle.launchPaused),
    ALLOW_STAGING_SCORING: lifecycle.phase === "staging" ? "true" : env.ALLOW_STAGING_SCORING,
  });
  if (effective.configHash !== lifecycle.configHash) {
    throw new Error("event lifecycle belongs to another immutable configuration");
  }

  const scoringMode = clockDerivedScoringMode(effective, lifecycle.phase, now);
  const presence = await presentField({ store, env, rulesVersion });
  return Object.freeze({
    ...effective,
    scoringMode,
    checkedInParticipantIds: presence.checkedInParticipantIds,
    fieldSize: Math.min(effective.registeredCount, presence.fieldSize),
    presenceSource: presence.source,
    lifecyclePhase: lifecycle.phase,
    lifecycleRevision: lifecycle.revision,
    lifecycleUpdatedAt: lifecycle.updatedAt,
    lifecycleUpdatedBy: lifecycle.updatedBy,
  });
}
