import assert from "node:assert/strict";
import test from "node:test";

import {
  ParticipantTicketError,
  consumeParticipantTicket,
  issueParticipantTicket,
  verifyParticipantTicket,
} from "../index.js";

const SECRET = "0123456789abcdef0123456789abcdef";
const NOW = 1_800_000_000;

function deterministicTicket(overrides = {}) {
  return issueParticipantTicket(
    {
      audience: "imprint",
      participantId: "participant_73",
      teamId: "team_9",
      ...overrides,
    },
    SECRET,
    { now: NOW, ttlSeconds: 300, jti: "test-jti-0001" },
  );
}

test("issues a deterministic, audience-bound ticket", () => {
  const token = deterministicTicket();

  assert.equal(
    token,
    "v1.eyJpc3MiOiJjdGYyNi1wb3J0YWwiLCJ0eXAiOiJjaGFsbGVuZ2UtbGF1bmNoIiwiZXZlbnRfaWQiOiJjdGYyNiIsImF1ZCI6ImltcHJpbnQiLCJwYXJ0aWNpcGFudF9pZCI6InBhcnRpY2lwYW50XzczIiwidGVhbV9pZCI6InRlYW1fOSIsImlhdCI6MTgwMDAwMDAwMCwiZXhwIjoxODAwMDAwMzAwLCJqdGkiOiJ0ZXN0LWp0aS0wMDAxIn0.BVopKwvau9kHEny7VjFT5_I2bc8wKVliX3bmb14XjPc",
  );

  const claims = verifyParticipantTicket(token, SECRET, {
    audience: "imprint",
    now: NOW + 1,
  });
  assert.equal(claims.team_id, "team_9");
  assert.equal(claims.jti, "test-jti-0001");
  assert.equal(Object.isFrozen(claims), true);
});

test("rejects cross-challenge replay, expiry, tampering, and extra segments", () => {
  const token = deterministicTicket();

  assert.throws(
    () =>
      verifyParticipantTicket(token, SECRET, {
        audience: "overclock",
        now: NOW + 1,
      }),
    (error) => error instanceof ParticipantTicketError && error.code === "wrong_audience",
  );
  assert.throws(
    () =>
      verifyParticipantTicket(token, SECRET, {
        audience: "imprint",
        now: NOW + 300,
      }),
    (error) => error instanceof ParticipantTicketError && error.code === "expired",
  );
  assert.throws(
    () => verifyParticipantTicket(`${token}x`, SECRET, { audience: "imprint", now: NOW }),
    (error) => error instanceof ParticipantTicketError && error.code === "bad_signature",
  );
  assert.throws(
    () => verifyParticipantTicket(`${token}.ignored`, SECRET, { audience: "imprint", now: NOW }),
    (error) => error instanceof ParticipantTicketError && error.code === "malformed",
  );
});

test("requires an atomic replay-store decision when consuming a ticket", async () => {
  const token = deterministicTicket();
  const seen = new Set();
  const consumeJti = async ({ jti }) => {
    if (seen.has(jti)) return false;
    seen.add(jti);
    return true;
  };

  const claims = await consumeParticipantTicket(token, SECRET, {
    audience: "imprint",
    now: NOW + 1,
    consumeJti,
  });
  assert.equal(claims.participant_id, "participant_73");

  await assert.rejects(
    consumeParticipantTicket(token, SECRET, {
      audience: "imprint",
      now: NOW + 1,
      consumeJti,
    }),
    (error) => error instanceof ParticipantTicketError && error.code === "replayed",
  );
});

test("refuses short secrets and overlong ticket lifetimes", () => {
  assert.throws(
    () =>
      issueParticipantTicket(
        { audience: "imprint", participantId: "p1", teamId: "t1" },
        "too-short",
      ),
    (error) => error instanceof ParticipantTicketError && error.code === "invalid_secret",
  );
  assert.throws(
    () =>
      issueParticipantTicket(
        { audience: "imprint", participantId: "p1", teamId: "t1" },
        SECRET,
        { ttlSeconds: 601 },
      ),
    (error) => error instanceof ParticipantTicketError && error.code === "invalid_ttl",
  );
});
