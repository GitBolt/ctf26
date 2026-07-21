import assert from "node:assert/strict";
import test from "node:test";

import {
  eventTargetForParticipant,
  publicEventTargetForParticipant,
  validateTargetConfiguration,
} from "../lib/target-config.mjs";

const vaultA = "11111111111111111111111111111111";
const vaultB = "SysvarC1ock11111111111111111111111111111111";

function map(entries) {
  return JSON.stringify(
    Object.fromEntries(
      entries.map(([participantId, vault]) => [
        participantId,
        {
          vault,
          initialLamports: "501579920",
          minimumDrainLamports: "450000000",
        },
      ])
    )
  );
}

test("selects only the authenticated participant's production target", () => {
  const env = {
    NODE_ENV: "production",
    IMPRINT_PARTICIPANT_TARGETS_JSON: map([
      ["participant-a", vaultA],
      ["participant-b", vaultB],
    ]),
  };
  const target = eventTargetForParticipant("participant-b", env);
  assert.equal(target.vault.toString(), vaultB);
  assert.equal(target.initialLamports, 501579920n);
  assert.equal(target.minimumDrainLamports, 450000000n);
  assert.deepEqual(publicEventTargetForParticipant("participant-a", env), { vault: vaultA });
  assert.deepEqual(Object.keys(publicEventTargetForParticipant("participant-a", env)), [
    "vault",
  ]);
  assert.throws(
    () => eventTargetForParticipant("participant-c", env),
    /no IMPRINT target is assigned/
  );
});

test("production rejects missing maps, legacy target variables, and duplicate vaults", () => {
  assert.throws(
    () => eventTargetForParticipant("participant-a", { NODE_ENV: "production" }),
    /IMPRINT_PARTICIPANT_TARGETS_JSON is required/
  );
  assert.throws(
    () =>
      eventTargetForParticipant("participant-a", {
        NODE_ENV: "production",
        IMPRINT_PARTICIPANT_TARGETS_JSON: map([["participant-a", vaultA]]),
        IMPRINT_TARGET_VAULT: vaultA,
      }),
    /legacy single-target variables are not allowed/
  );
  assert.throws(
    () =>
      validateTargetConfiguration({
        NODE_ENV: "production",
        IMPRINT_PARTICIPANT_TARGETS_JSON: map([
          ["participant-a", vaultA],
          ["participant-b", vaultA],
        ]),
      }),
    /assigns vault .* more than once/
  );
});

test("target map schema and roster membership fail closed", () => {
  assert.throws(
    () =>
      validateTargetConfiguration({
        NODE_ENV: "production",
        IMPRINT_PARTICIPANT_TARGETS_JSON: JSON.stringify({
          "participant-a": {
            vault: vaultA,
            initialLamports: "10",
            minimumDrainLamports: "9",
            typo: "ignored",
          },
        }),
      }),
    /must contain exactly/
  );
  assert.throws(
    () =>
      validateTargetConfiguration({
        NODE_ENV: "production",
        IMPRINT_PARTICIPANT_TARGETS_JSON: JSON.stringify({
          "participant-a": {
            vault: vaultA,
            initialLamports: "18446744073709551616",
            minimumDrainLamports: "9",
          },
        }),
      }),
    /exceeds the Solana u64 lamport range/
  );
  assert.throws(
    () =>
      validateTargetConfiguration(
        {
          NODE_ENV: "production",
          IMPRINT_PARTICIPANT_TARGETS_JSON: map([["participant-a", vaultA]]),
        },
        ["participant-a", "participant-b"]
      ),
    /missing: participant-b/
  );
});

test("non-production keeps the single-target rehearsal fallback", () => {
  const env = {
    NODE_ENV: "development",
    IMPRINT_TARGET_VAULT: vaultA,
    IMPRINT_INITIAL_TARGET_LAMPORTS: "501579920",
    IMPRINT_MINIMUM_DRAIN_LAMPORTS: "450000000",
  };
  assert.equal(eventTargetForParticipant("test-participant", env).vault.toString(), vaultA);
  assert.deepEqual(validateTargetConfiguration(env), {
    mode: "single-target-rehearsal",
    participantCount: 1,
  });
});

test("an explicitly labelled production rehearsal may keep the legacy target", () => {
  const env = {
    NODE_ENV: "production",
    IMPRINT_TARGET_MODE: "single-target-rehearsal",
    IMPRINT_TARGET_VAULT: vaultA,
    IMPRINT_INITIAL_TARGET_LAMPORTS: "501579920",
    IMPRINT_MINIMUM_DRAIN_LAMPORTS: "450000000",
    NEXT_PUBLIC_TARGET_VAULT: vaultA,
  };
  assert.equal(
    eventTargetForParticipant("staging-participant", env).vault.toString(),
    vaultA
  );
  assert.deepEqual(validateTargetConfiguration(env, ["staging-participant"]), {
    mode: "single-target-rehearsal",
    participantCount: 1,
  });
  assert.throws(
    () =>
      validateTargetConfiguration({
        ...env,
        IMPRINT_PARTICIPANT_TARGETS_JSON: map([["staging-participant", vaultA]]),
      }),
    /is not allowed in single-target rehearsal mode/
  );
});

test("an unknown target mode fails closed", () => {
  assert.throws(
    () =>
      validateTargetConfiguration({
        NODE_ENV: "development",
        IMPRINT_TARGET_MODE: "automatic",
      }),
    /IMPRINT_TARGET_MODE must be per-participant or single-target-rehearsal/
  );
});
