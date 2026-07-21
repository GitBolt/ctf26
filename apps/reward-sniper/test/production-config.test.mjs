import assert from "node:assert/strict";
import test from "node:test";

import { validateProductionEnvironment } from "../src/server.mjs";

const SECRET = "reward-sniper-production-secret-value-000000000000";

function productionEnvironment(overrides = {}) {
  return {
    CTF_EVENT_GENERATION: "ctf26-final",
    REDIS_URL: "redis://redis.example:6379",
    PARTICIPANT_TICKET_SECRET: SECRET,
    SESSION_SECRET: SECRET,
    VOUCHER_SECRET: SECRET,
    INTEGRITY_ADMIN_KEY: SECRET,
    MARKET_SEED: "private-event-seed",
    STATE_FILE: "/data/reward-sniper-state.json",
    REWARD_EVENT_MODE: "staging",
    ALLOW_DIRECT_TEST_ACCESS: "false",
    SCORED_ROUNDS: "3",
    START_ON_FIRST_SESSION: "true",
    EVENT_START_AT: "",
    EVENT_END_AT: "",
    ...overrides,
  };
}

test("production accepts an explicit qualifying rehearsal plan", () => {
  assert.doesNotThrow(() => validateProductionEnvironment(productionEnvironment()));
});

test("production accepts a synchronized scheduled event plan", () => {
  assert.doesNotThrow(() => validateProductionEnvironment(productionEnvironment({
    REWARD_EVENT_MODE: "official",
    START_ON_FIRST_SESSION: "false",
    EVENT_START_AT: "2026-07-25T10:00:00+05:30",
    EVENT_END_AT: "2026-07-25T13:00:00+05:30",
    REGISTERED_PARTICIPANT_IDS_JSON: '["participant-one","participant-two"]',
  })));
});

test("official mode requires scheduled start and end times plus the exact preloaded roster", () => {
  assert.throws(
    () => validateProductionEnvironment(productionEnvironment({ REWARD_EVENT_MODE: "official" })),
    /official REWARD_EVENT_MODE requires START_ON_FIRST_SESSION=false, EVENT_START_AT, and EVENT_END_AT/,
  );
  assert.throws(
    () => validateProductionEnvironment(productionEnvironment({
      REWARD_EVENT_MODE: "official",
      START_ON_FIRST_SESSION: "false",
      EVENT_START_AT: "2026-07-25T10:00:00+05:30",
      EVENT_END_AT: "2026-07-25T13:00:00+05:30",
      REGISTERED_PARTICIPANT_IDS_JSON: "",
    })),
    /REGISTERED_PARTICIPANT_IDS_JSON/,
  );
});

test("production requires generation-scoped Redis ticket replay protection", () => {
  assert.throws(
    () => validateProductionEnvironment(productionEnvironment({ CTF_EVENT_GENERATION: "" })),
    /CTF_EVENT_GENERATION is required/,
  );
  assert.throws(
    () => validateProductionEnvironment(productionEnvironment({ REDIS_URL: "" })),
    /REDIS_URL is required/,
  );
});

test("production rejects missing, malformed, or insufficient scored rounds", () => {
  for (const scoredRounds of ["", "one", "1", "2.5"]) {
    assert.throws(
      () => validateProductionEnvironment(productionEnvironment({ SCORED_ROUNDS: scoredRounds })),
      /SCORED_ROUNDS must be explicitly set to at least 2/,
    );
  }
});

test("production requires one coherent explicit start policy", () => {
  assert.throws(
    () => validateProductionEnvironment(productionEnvironment({ START_ON_FIRST_SESSION: "" })),
    /must be explicitly set to true or false/,
  );
  assert.throws(
    () => validateProductionEnvironment(productionEnvironment({ EVENT_START_AT: "2026-07-25T10:00:00+05:30" })),
    /must be empty when START_ON_FIRST_SESSION=true/,
  );
  assert.throws(
    () => validateProductionEnvironment(productionEnvironment({ START_ON_FIRST_SESSION: "false" })),
    /EVENT_START_AT is required/,
  );
  assert.throws(
    () => validateProductionEnvironment(productionEnvironment({
      START_ON_FIRST_SESSION: "false",
      EVENT_START_AT: "2026-07-25T10:00:00+05:30",
    })),
    /REGISTERED_PARTICIPANT_IDS_JSON/,
  );
  assert.throws(
    () => validateProductionEnvironment(productionEnvironment({
      START_ON_FIRST_SESSION: "false",
      EVENT_START_AT: "not-a-time",
      REGISTERED_PARTICIPANT_IDS_JSON: '["participant-one"]',
    })),
    /must be an ISO-8601 timestamp or epoch milliseconds/,
  );
});

test("production rejects an event end at or before its start", () => {
  const base = {
    REWARD_EVENT_MODE: "official",
    START_ON_FIRST_SESSION: "false",
    EVENT_START_AT: "2026-07-25T10:00:00+05:30",
    REGISTERED_PARTICIPANT_IDS_JSON: '["participant-one"]',
  };
  for (const eventEnd of ["2026-07-25T10:00:00+05:30", "2026-07-25T09:59:59+05:30"]) {
    assert.throws(
      () => validateProductionEnvironment(productionEnvironment({ ...base, EVENT_END_AT: eventEnd })),
      /EVENT_END_AT must be after EVENT_START_AT/,
    );
  }
});
