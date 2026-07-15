import assert from "node:assert/strict";
import test from "node:test";

import { verifyParticipantTicket } from "../../packages/participant-ticket/index.js";
import { createTestLaunch } from "../issue-test-launch.mjs";

const SECRET = "operator-test-ticket-secret-with-at-least-32-bytes";

test("issues a short-lived audience and identity-bound launch URL", () => {
  const launch = new URL(createTestLaunch({
    CHALLENGE_URL: "https://drift.example.test/",
    TICKET_AUDIENCE: "drift",
    PARTICIPANT_ID: "agent-run-01",
    TEAM_ID: "agent-team-01",
    TICKET_SECRET: SECRET,
    TICKET_TTL_SECONDS: "300",
  }, { now: 1_800_000_000 }));

  const claims = verifyParticipantTicket(launch.searchParams.get("ticket"), SECRET, {
    audience: "drift",
    eventId: "ctf26",
    now: 1_800_000_001,
  });
  assert.equal(claims.participant_id, "agent-run-01");
  assert.equal(claims.team_id, "agent-team-01");
  assert.equal(launch.origin, "https://drift.example.test");
});

test("rejects insecure destinations, embedded credentials, and malformed identities", () => {
  const base = {
    TICKET_AUDIENCE: "signet",
    PARTICIPANT_ID: "tester-01",
    TICKET_SECRET: SECRET,
  };
  assert.throws(() => createTestLaunch({ ...base, CHALLENGE_URL: "http://public.example.test" }), /HTTPS/);
  assert.throws(() => createTestLaunch({ ...base, CHALLENGE_URL: "https://user:pass@example.test" }), /without credentials/);
  assert.throws(() => createTestLaunch({ ...base, CHALLENGE_URL: "https://example.test", TEAM_ID: "bad team" }), /valid identifier/);
});

test("never accepts a pre-ticketed destination", () => {
  assert.throws(() => createTestLaunch({
    CHALLENGE_URL: "https://reward.example.test/web/?ticket=old",
    TICKET_AUDIENCE: "reward-sniper",
    PARTICIPANT_ID: "tester-01",
    TICKET_SECRET: SECRET,
  }), /must not already contain a ticket/);
});
