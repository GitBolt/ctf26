import assert from "node:assert/strict";
import test from "node:test";

import { verifyParticipantTicket } from "@ctf26/participant-ticket";
import {
  RULES_VERSION,
  createChallengeTicket,
  createRulesAcknowledgment,
  createUserSession,
  verifyRulesAcknowledgment,
  verifyUserSession,
} from "../app/lib/tickets.js";

const CASES = Object.freeze([
  ["reward-sniper", "CHALLENGE_TICKET_SECRET_REWARD_SNIPER"],
  ["imprint", "CHALLENGE_TICKET_SECRET_IMPRINT"],
  ["signet", "CHALLENGE_TICKET_SECRET_SIGNET"],
  ["drift", "CHALLENGE_TICKET_SECRET_DRIFT"],
  ["last-stop", "CHALLENGE_TICKET_SECRET_LAST_STOP"],
  ["after-hours", "CHALLENGE_TICKET_SECRET_AFTER_HOURS"],
  ["player-two", "CHALLENGE_TICKET_SECRET_PLAYER_TWO"],
  ["the-broadcast", "CHALLENGE_TICKET_SECRET_THE_BROADCAST"],
  ["evidence-room", "CHALLENGE_TICKET_SECRET_EVIDENCE_ROOM"],
  ["second-key", "CHALLENGE_TICKET_SECRET_SECOND_KEY"],
]);

test("every catalog audience signs with its matching service secret", () => {
  const previous = new Map();
  previous.set("LEADERBOARD_EVENT_GENERATION", process.env.LEADERBOARD_EVENT_GENERATION);
  process.env.LEADERBOARD_EVENT_GENERATION = "event-a";
  for (const [, name] of CASES) {
    previous.set(name, process.env[name]);
    process.env[name] = `test-${name.toLowerCase()}-${"x".repeat(48)}`;
  }

  try {
    for (const [audience, name] of CASES) {
      const ticket = createChallengeTicket(
        { participant_id: "participant-1", email: "Player@Example.com" },
        audience,
      );
      const claims = verifyParticipantTicket(ticket, process.env[name], {
        audience,
        eventId: "event-a",
      });
      assert.equal(claims.aud, audience);
      assert.equal(claims.participant_id, "participant-1");
      assert.equal(claims.email, "player@example.com");
    }
  } finally {
    for (const [, name] of CASES) {
      const value = previous.get(name);
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    const generation = previous.get("LEADERBOARD_EVENT_GENERATION");
    if (generation === undefined) delete process.env.LEADERBOARD_EVENT_GENERATION;
    else process.env.LEADERBOARD_EVENT_GENERATION = generation;
  }
});

test("unknown ticket audiences fail closed", () => {
  assert.throws(
    () =>
      createChallengeTicket(
        { participant_id: "participant-1" },
        "not-a-challenge",
      ),
    /unknown challenge audience/,
  );
});

test("ticket issuance fails closed while new challenge sessions are paused", () => {
  const previousMode = process.env.LEADERBOARD_SCORING_MODE;
  const previousPause = process.env.LEADERBOARD_LAUNCH_PAUSED;
  process.env.LEADERBOARD_SCORING_MODE = "staging";
  process.env.LEADERBOARD_LAUNCH_PAUSED = "true";
  try {
    assert.throws(
      () => createChallengeTicket(
        { participant_id: "participant-1", email: "player@example.com" },
        "signet",
      ),
      /temporarily paused/,
    );
  } finally {
    if (previousMode === undefined) delete process.env.LEADERBOARD_SCORING_MODE;
    else process.env.LEADERBOARD_SCORING_MODE = previousMode;
    if (previousPause === undefined) delete process.env.LEADERBOARD_LAUNCH_PAUSED;
    else process.env.LEADERBOARD_LAUNCH_PAUSED = previousPause;
  }
});

test("rules acknowledgment is signed, versioned, and bound to one participant", () => {
  const previous = process.env.CENTRAL_SESSION_SECRET;
  const previousGeneration = process.env.LEADERBOARD_EVENT_GENERATION;
  process.env.CENTRAL_SESSION_SECRET = "central-session-test-secret-at-least-32-bytes";
  process.env.LEADERBOARD_EVENT_GENERATION = "event-a";
  try {
    const user = { participant_id: "participant-1" };
    const token = createRulesAcknowledgment(user);
    assert.equal(verifyRulesAcknowledgment(token, user), true);
    assert.equal(verifyRulesAcknowledgment(token, { participant_id: "participant-2" }), false);
    const session = createUserSession(user);
    process.env.LEADERBOARD_EVENT_GENERATION = "event-b";
    assert.equal(verifyRulesAcknowledgment(token, user), false);
    assert.equal(verifyUserSession(session), null);
    assert.match(RULES_VERSION, /^\d{4}-\d{2}-\d{2}$/);
  } finally {
    if (previous === undefined) delete process.env.CENTRAL_SESSION_SECRET;
    else process.env.CENTRAL_SESSION_SECRET = previous;
    if (previousGeneration === undefined) delete process.env.LEADERBOARD_EVENT_GENERATION;
    else process.env.LEADERBOARD_EVENT_GENERATION = previousGeneration;
  }
});
