import assert from "node:assert/strict";
import test from "node:test";

import { imprintHealth } from "../lib/health.mjs";

const vaultA = "11111111111111111111111111111111";
const vaultB = "SysvarC1ock11111111111111111111111111111111";

function targets(entries) {
  return JSON.stringify(
    Object.fromEntries(
      entries.map(([participantId, vault]) => [
        participantId,
        {
          vault,
          initialLamports: "501579920",
          minimumDrainLamports: "500000000",
        },
      ])
    )
  );
}

const parseRoster = () => [{ participantId: "participant-a" }, { participantId: "participant-b" }];
const productionReplay = {
  NODE_ENV: "production",
  CTF_EVENT_GENERATION: "ctf26-final",
  REDIS_URL: "redis://redis.example:6379",
};

test("production health requires one unique target for every rostered participant", () => {
  assert.deepEqual(
    imprintHealth(
      {
        ...productionReplay,
        IMPRINT_PARTICIPANT_TARGETS_JSON: targets([
          ["participant-a", vaultA],
          ["participant-b", vaultB],
        ]),
      },
      { parseRoster }
    ),
    {
      ok: true,
      eventReady: true,
      targetMode: "per-participant",
      participantCount: 2,
      eventGeneration: "ctf26-final",
      ticketReplay: "redis",
    }
  );
});

test("production health fails closed for a missing, malformed, or incomplete map", () => {
  assert.throws(
    () => imprintHealth({ NODE_ENV: "production" }, { parseRoster }),
    /IMPRINT_PARTICIPANT_TARGETS_JSON is required/
  );
  assert.throws(
    () =>
      imprintHealth(
        { NODE_ENV: "production", IMPRINT_PARTICIPANT_TARGETS_JSON: "{" },
        { parseRoster }
      ),
    /must be valid JSON/
  );
  assert.throws(
    () =>
      imprintHealth(
        {
          ...productionReplay,
          IMPRINT_PARTICIPANT_TARGETS_JSON: targets([["participant-a", vaultA]]),
        },
        { parseRoster }
      ),
    /missing: participant-b/
  );
});

test("production rehearsal health is available only through the explicit target mode", () => {
  assert.deepEqual(
    imprintHealth(
      {
        ...productionReplay,
        IMPRINT_TARGET_MODE: "single-target-rehearsal",
        IMPRINT_TARGET_VAULT: vaultA,
        IMPRINT_INITIAL_TARGET_LAMPORTS: "501579920",
        IMPRINT_MINIMUM_DRAIN_LAMPORTS: "500000000",
      },
      { parseRoster }
    ),
    {
      ok: true,
      eventReady: false,
      targetMode: "single-target-rehearsal",
      participantCount: 1,
      eventGeneration: "ctf26-final",
      ticketReplay: "redis",
    }
  );
});

test("production health requires generation-scoped durable ticket replay storage", () => {
  const targetEnv = {
    NODE_ENV: "production",
    IMPRINT_PARTICIPANT_TARGETS_JSON: targets([
      ["participant-a", vaultA],
      ["participant-b", vaultB],
    ]),
  };
  assert.throws(
    () => imprintHealth(targetEnv, { parseRoster }),
    /CTF_EVENT_GENERATION is required/,
  );
  assert.throws(
    () => imprintHealth({ ...targetEnv, CTF_EVENT_GENERATION: "ctf26-final" }, { parseRoster }),
    /REDIS_URL is required/,
  );
});
