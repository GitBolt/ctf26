import assert from "node:assert/strict";
import test from "node:test";
import { issueParticipantTicket } from "@ctf26/participant-ticket";

import {
  createChallengeSession,
  directTestAccessAllowed,
  verifyChallengeSession,
} from "../lib/challenge-session.mjs";

const TICKET_SECRET = "t".repeat(32);
const SESSION_SECRET = "s".repeat(32);
const env = {
  CTF_EVENT_GENERATION: "ctf26-final",
  CHALLENGE_TICKET_SECRET: TICKET_SECRET,
  IMPRINT_SESSION_SECRET: SESSION_SECRET,
};

function ticket(audience = "imprint") {
  return issueParticipantTicket(
    {
      eventId: env.CTF_EVENT_GENERATION,
      audience,
      participantId: "participant-a",
    },
    TICKET_SECRET
  );
}

function replayStore() {
  const seen = new Set();
  return async ({ jti }) => {
    if (seen.has(jti)) return false;
    seen.add(jti);
    return true;
  };
}

test("creates a session only from a valid one-time IMPRINT launch ticket", async () => {
  const consumeJti = replayStore();
  const session = await createChallengeSession(
    ticket(),
    env,
    Date.now(),
    consumeJti
  );
  const identity = verifyChallengeSession(session, env);
  assert.deepEqual(identity, {
    eventId: "ctf26-final",
    participantId: "participant-a",
    email: "",
    exp: identity.exp,
  });

  await assert.rejects(
    createChallengeSession(ticket(), env, Date.now(), async () => false),
    /already been consumed/
  );
});

test("rejects a replay of the exact same launch ticket", async () => {
  const launchTicket = ticket();
  const consumeJti = replayStore();
  await createChallengeSession(launchTicket, env, Date.now(), consumeJti);
  await assert.rejects(
    createChallengeSession(launchTicket, env, Date.now(), consumeJti),
    /already been consumed/
  );
});

test("rejects a launch ticket from another event generation", async () => {
  const ticket = issueParticipantTicket(
    {
      eventId: "ctf26-rehearsal",
      audience: "imprint",
      participantId: "participant-a",
    },
    TICKET_SECRET
  );
  await assert.rejects(
    createChallengeSession(ticket, env, Date.now(), replayStore()),
    /another event/
  );
});

test("direct test access can never be enabled in production", () => {
  assert.equal(
    directTestAccessAllowed({
      NODE_ENV: "development",
      ALLOW_DIRECT_TEST_ACCESS: "true",
    }),
    true
  );
  assert.equal(
    directTestAccessAllowed({
      NODE_ENV: "production",
      ALLOW_DIRECT_TEST_ACCESS: "true",
    }),
    false
  );
});

test("rejects a tampered session and a ticket for another challenge", async () => {
  await assert.rejects(
    createChallengeSession(ticket("drift"), env, Date.now(), replayStore()),
    /another challenge/
  );

  const session = await createChallengeSession(
    ticket(),
    env,
    Date.now(),
    replayStore()
  );
  assert.throws(
    () => verifyChallengeSession(`${session}x`, env),
    /signature is invalid/
  );
});
