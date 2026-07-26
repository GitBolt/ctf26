import assert from "node:assert/strict";
import test from "node:test";

import { leaderboardConfig } from "../app/lib/leaderboard-config.mjs";
import { resolveLeaderboardConfig } from "../app/lib/leaderboard-lifecycle.mjs";
import { participantIdForEmail } from "../app/lib/registration.mjs";

const PARTICIPANT_ID_SECRET = "participant-id-test-secret-at-least-32-bytes";

function officialEnvironment(scoringMode = "staging") {
  const roster = [
    { email: "one@example.com", displayName: "One" },
    { email: "two@example.com", displayName: "Two" },
  ];
  const identityEnvironment = {
    PARTICIPANT_ID_SECRET,
    PARTICIPANT_ROSTER_JSON: JSON.stringify(roster),
  };
  const checkedIn = roster.map((entry) => participantIdForEmail(entry.email, identityEnvironment));
  return {
    ...identityEnvironment,
    LEADERBOARD_FIELD_SIZE: "2",
    LEADERBOARD_CHECKED_IN_PARTICIPANT_IDS: JSON.stringify(checkedIn),
    LEADERBOARD_SCORING_MODE: scoringMode,
    LEADERBOARD_PRIZE_POOL_USD: "100",
    LEADERBOARD_MIN_INDIVIDUAL_AWARD_USD: "1",
    LEADERBOARD_SCORING_START_AT: "2026-07-26T04:30:00.000Z",
    LEADERBOARD_SCORING_END_AT: "2026-07-26T10:30:00.000Z",
    LEADERBOARD_EVENT_GENERATION: "ctf26-final",
    REWARD_SNIPER_EVENT_ID: "reward-event-final",
    REWARD_SNIPER_SCORING_CONFIG_HASH: "a".repeat(64),
  };
}

function lifecycleStore() {
  const phases = ["staging", "live", "recovery", "freezing", "frozen"];
  let configHash = "";
  let lifecycle = null;
  return {
    async assertEventConfig(value) {
      if (configHash && configHash !== value) throw new Error("configuration changed");
      configHash = value;
    },
    async initializeEventLifecycle(metadata) {
      lifecycle ||= {
        ...metadata,
        official: metadata.phase !== "staging",
        revision: 0,
        updatedAt: "2026-07-21T00:00:00.000Z",
        updatedBy: metadata.organizer,
      };
      return lifecycle;
    },
    async advanceEventLifecycle(metadata) {
      assert.equal(metadata.configHash, configHash);
      assert.equal(phases.indexOf(metadata.phase), phases.indexOf(lifecycle.phase) + 1);
      lifecycle = {
        ...lifecycle,
        phase: metadata.phase,
        launchPaused: metadata.phase !== "live",
        official: true,
        revision: lifecycle.revision + 1,
        updatedAt: "2026-07-21T00:01:00.000Z",
        updatedBy: metadata.organizer,
      };
      return lifecycle;
    },
  };
}

test("official lifecycle phases share one immutable scoring configuration", () => {
  const staging = leaderboardConfig(officialEnvironment("staging"));
  for (const phase of ["live", "recovery", "freezing", "frozen"]) {
    assert.equal(leaderboardConfig(officialEnvironment(phase)).configHash, staging.configHash);
  }
});

test("a deployment rollback cannot move the durable event lifecycle backward", async () => {
  const store = lifecycleStore();
  const staging = await resolveLeaderboardConfig({
    env: officialEnvironment("staging"),
    store,
    now: new Date("2026-07-26T03:00:00.000Z"),
  });
  assert.equal(staging.lifecyclePhase, "staging");
  assert.equal(staging.scoringMode, "staging");

  await store.advanceEventLifecycle({ phase: "live", configHash: staging.configHash, organizer: "one@example.com" });
  await store.advanceEventLifecycle({ phase: "recovery", configHash: staging.configHash, organizer: "one@example.com" });
  const recovery = await resolveLeaderboardConfig({
    env: officialEnvironment("staging"),
    store,
    now: new Date("2026-07-26T08:00:00.000Z"),
  });
  assert.equal(recovery.scoringMode, "recovery");
  assert.equal(recovery.lifecyclePhase, "recovery");
  assert.equal(recovery.lifecycleRevision, 2);

  const rolledBackDeployment = await resolveLeaderboardConfig({
    env: officialEnvironment("live"),
    store,
    now: new Date("2026-07-26T08:00:00.000Z"),
  });
  assert.equal(rolledBackDeployment.scoringMode, "recovery");
  assert.equal(rolledBackDeployment.launchPaused, true);
  assert.equal(rolledBackDeployment.lifecycleRevision, 2);
});

test("a deployment-level emergency pause overrides a durable open lifecycle", async () => {
  const store = lifecycleStore();
  const staged = await resolveLeaderboardConfig({
    env: officialEnvironment("staging"),
    store,
    now: new Date("2026-07-26T03:00:00.000Z"),
  });
  await store.advanceEventLifecycle({ phase: "live", configHash: staged.configHash, organizer: "one@example.com" });
  const config = await resolveLeaderboardConfig({
    env: { ...officialEnvironment("live"), LEADERBOARD_LAUNCH_PAUSED: "true" },
    store,
    now: new Date("2026-07-26T08:00:00.000Z"),
  });
  assert.equal(config.scoringMode, "live");
  assert.equal(config.launchPaused, true);
});

test("deployment configuration cannot advance an event without an organizer action", async () => {
  const store = lifecycleStore();
  const config = await resolveLeaderboardConfig({
    env: officialEnvironment("frozen"),
    store,
    now: new Date("2026-07-26T03:00:00.000Z"),
  });
  assert.equal(config.lifecyclePhase, "staging");
  assert.equal(config.lifecycleRevision, 0);
});
