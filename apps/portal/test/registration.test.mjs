import assert from "node:assert/strict";
import test from "node:test";

import {
  participantRoster,
  registrationForEmail,
} from "../app/lib/registration.mjs";

test("registration falls back to an individual team when no roster is configured", () => {
  assert.deepEqual(
    registrationForEmail("Player@Example.com", "participant_123", {}),
    { email: "player@example.com", teamId: "participant_123" },
  );
  assert.equal(participantRoster({}), null);
});

test("configured roster binds registered accounts to their event team", () => {
  const env = {
    PARTICIPANT_ROSTER_JSON: JSON.stringify({
      "one@example.com": "team-orbit",
      "two@example.com": "team-orbit",
    }),
  };
  assert.equal(registrationForEmail("ONE@example.com", "fallback", env).teamId, "team-orbit");
  assert.equal(registrationForEmail("missing@example.com", "fallback", env), null);
});

test("roster accepts explicit entries and rejects malformed identity data", () => {
  const roster = participantRoster({
    PARTICIPANT_ROSTER_JSON: JSON.stringify([
      { email: "player@example.com", teamId: "team_01" },
    ]),
  });
  assert.equal(roster.get("player@example.com").teamId, "team_01");

  assert.throws(
    () => participantRoster({ PARTICIPANT_ROSTER_JSON: '{"bad":"team:invalid"}' }),
    /invalid email|invalid team ID/,
  );
  assert.throws(
    () => participantRoster({ PARTICIPANT_ROSTER_JSON: "not-json" }),
    /valid JSON/,
  );
});
