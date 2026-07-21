import assert from "node:assert/strict";
import test from "node:test";

import {
  participantIdForEmail,
  participantRoster,
  registrationForEmail,
} from "../app/lib/registration.mjs";

const SECRET = "participant-id-secret-at-least-32-bytes";
const baseEnv = { PARTICIPANT_ID_SECRET: SECRET };

test("registration derives one stable individual identity from the registered email", () => {
  const participantId = participantIdForEmail("Player@Example.com", baseEnv);
  assert.deepEqual(
    registrationForEmail("Player@Example.com", participantId, baseEnv),
    { email: "player@example.com", participantId, displayName: participantId },
  );
  assert.equal(participantRoster(baseEnv), null);
  assert.throws(
    () => registrationForEmail("player@example.com", "another-id", baseEnv),
    /stable derived ID/,
  );
});

test("production registration fails closed unless open staging is explicitly enabled", () => {
  const participantId = participantIdForEmail("player@example.com", baseEnv);
  assert.equal(
    registrationForEmail("player@example.com", participantId, { ...baseEnv, NODE_ENV: "production" }),
    null,
  );
  assert.deepEqual(
    registrationForEmail("player@example.com", participantId, {
      ...baseEnv,
      NODE_ENV: "production",
      ALLOW_OPEN_REGISTRATION: "true",
    }),
    { email: "player@example.com", participantId, displayName: participantId },
  );
});

test("configured roster authorizes individuals without grouping them", () => {
  const env = {
    ...baseEnv,
    PARTICIPANT_ROSTER_JSON: JSON.stringify([
      { email: "one@example.com", displayName: "Orbit One" },
      { email: "two@example.com", displayName: "Orbit Two" },
    ]),
  };
  const expected = participantIdForEmail("one@example.com", env);
  assert.deepEqual(registrationForEmail("ONE@example.com", expected, env), {
    email: "one@example.com",
    participantId: expected,
    displayName: "Orbit One",
  });
  assert.equal(registrationForEmail(
    "missing@example.com",
    participantIdForEmail("missing@example.com", env),
    env,
  ), null);
});

test("roster rejects malformed or ambiguous participant data", () => {
  const env = {
    ...baseEnv,
    PARTICIPANT_ROSTER_JSON: JSON.stringify([
      { email: "player@example.com", displayName: "Packet Witch" },
    ]),
  };
  const roster = participantRoster(env);
  assert.equal(roster.get("player@example.com").participantId, participantIdForEmail("player@example.com", env));
  assert.equal(roster.get("player@example.com").displayName, "Packet Witch");

  assert.throws(
    () => participantRoster({ ...baseEnv, PARTICIPANT_ROSTER_JSON: '{"bad":"name"}' }),
    /invalid email/,
  );
  assert.throws(
    () => participantRoster({ ...baseEnv, PARTICIPANT_ROSTER_JSON: "not-json" }),
    /valid JSON/,
  );
  assert.throws(
    () => participantRoster({
      ...baseEnv,
      PARTICIPANT_ROSTER_JSON: JSON.stringify([
        { email: "one@example.com", displayName: "Same Name" },
        { email: "two@example.com", displayName: "same name" },
      ]),
    }),
    /duplicate display name/,
  );
  assert.throws(
    () => participantRoster({
      ...baseEnv,
      PARTICIPANT_ROSTER_JSON: JSON.stringify([
        { email: "one@example.com", participantId: "invented-id", displayName: "One" },
      ]),
    }),
    /stable derived ID/,
  );
  assert.throws(
    () => participantRoster({
      ...baseEnv,
      PARTICIPANT_ROSTER_JSON: JSON.stringify([
        { email: "one@example.com", groupId: "unsupported", displayName: "One" },
      ]),
    }),
    /unsupported fields/,
  );
});
