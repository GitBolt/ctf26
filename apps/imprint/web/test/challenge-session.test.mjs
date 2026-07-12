import assert from "node:assert/strict";
import test from "node:test";
import { issueParticipantTicket } from "@ctf26/participant-ticket";

import {
  createChallengeSession,
  verifyChallengeSession,
} from "../lib/challenge-session.mjs";

const TICKET_SECRET = "t".repeat(32);
const SESSION_SECRET = "s".repeat(32);
const env = {
  CHALLENGE_TICKET_SECRET: TICKET_SECRET,
  IMPRINT_SESSION_SECRET: SESSION_SECRET,
};

test("creates a session only from a valid IMPRINT launch ticket", () => {
  const ticket = issueParticipantTicket(
    { audience: "imprint", participantId: "participant-a", teamId: "team-a" },
    TICKET_SECRET
  );
  const session = createChallengeSession(ticket, env);
  assert.deepEqual(verifyChallengeSession(session, env), {
    participantId: "participant-a",
    teamId: "team-a",
    email: "",
    exp: verifyChallengeSession(session, env).exp,
  });
});

test("rejects a tampered session and a ticket for another challenge", () => {
  const ticket = issueParticipantTicket(
    { audience: "drift", participantId: "participant-a", teamId: "team-a" },
    TICKET_SECRET
  );
  assert.throws(() => createChallengeSession(ticket, env), /another challenge/);

  const imprintTicket = issueParticipantTicket(
    { audience: "imprint", participantId: "participant-a", teamId: "team-a" },
    TICKET_SECRET
  );
  const session = createChallengeSession(imprintTicket, env);
  assert.throws(
    () => verifyChallengeSession(`${session}x`, env),
    /signature is invalid/
  );
});
