import { leaderboardConfig } from "./leaderboard-config.mjs";

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

export async function resolveLeaderboardConfig({ env = process.env, store, organizer = "system" } = {}) {
  const configured = leaderboardConfig(env);
  if (
    !store
    || typeof store.initializeEventLifecycle !== "function"
    || typeof store.advanceEventLifecycle !== "function"
  ) {
    return configured;
  }

  await store.assertEventConfig(configured.configHash);
  if (typeof store.assertFastSolveConfig === "function") {
    await store.assertFastSolveConfig(configured.fastSolveSeconds);
  }
  const lifecycle = await store.initializeEventLifecycle({
    phase: "staging",
    launchPaused: configured.launchPaused,
    configHash: configured.configHash,
    organizer,
  });

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
  return Object.freeze({
    ...effective,
    lifecycleRevision: lifecycle.revision,
    lifecycleUpdatedAt: lifecycle.updatedAt,
    lifecycleUpdatedBy: lifecycle.updatedBy,
  });
}
