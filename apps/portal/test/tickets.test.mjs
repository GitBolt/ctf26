import assert from "node:assert/strict";
import test from "node:test";

import { verifyParticipantTicket } from "@ctf26/participant-ticket";
import { createChallengeTicket } from "../app/lib/tickets.js";

const CASES = Object.freeze([
  ["reward-sniper", "CHALLENGE_TICKET_SECRET_REWARD_SNIPER"],
  ["imprint", "CHALLENGE_TICKET_SECRET_IMPRINT"],
  ["signet", "CHALLENGE_TICKET_SECRET_SIGNET"],
  ["drift", "CHALLENGE_TICKET_SECRET_DRIFT"],
  ["last-stop", "CHALLENGE_TICKET_SECRET_LAST_STOP"],
  ["after-hours", "CHALLENGE_TICKET_SECRET_AFTER_HOURS"],
  ["player-two", "CHALLENGE_TICKET_SECRET_PLAYER_TWO"],
  ["st-genesis-airdrop", "CHALLENGE_TICKET_SECRET_ST_GENESIS_AIRDROP"],
]);

test("every catalog audience signs with its matching service secret", () => {
  const previous = new Map();
  for (const [, name] of CASES) {
    previous.set(name, process.env[name]);
    process.env[name] = `test-${name.toLowerCase()}-${"x".repeat(48)}`;
  }

  try {
    for (const [audience, name] of CASES) {
      const ticket = createChallengeTicket(
        { participant_id: "participant-1", team_id: "team-1", email: "Player@Example.com" },
        audience,
      );
      const claims = verifyParticipantTicket(ticket, process.env[name], {
        audience,
        eventId: "ctf26",
      });
      assert.equal(claims.aud, audience);
      assert.equal(claims.team_id, "team-1");
      assert.equal(claims.email, "player@example.com");
    }
  } finally {
    for (const [, name] of CASES) {
      const value = previous.get(name);
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

test("unknown ticket audiences fail closed", () => {
  assert.throws(
    () =>
      createChallengeTicket(
        { participant_id: "participant-1", team_id: "team-1" },
        "not-a-challenge",
      ),
    /unknown challenge audience/,
  );
});
