import assert from "node:assert/strict";
import test from "node:test";

import {
  ParticipantTicketError,
  consumeParticipantTicket,
  createRedisTicketJtiConsumer,
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
      ...overrides,
    },
    SECRET,
    { now: NOW, ttlSeconds: 300, jti: "test-jti-0001" },
  );
}

test("issues a deterministic, audience-bound ticket", () => {
  const token = deterministicTicket();
  const body = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
  assert.equal(body.participant_id, "participant_73");

  const claims = verifyParticipantTicket(token, SECRET, {
    audience: "imprint",
    now: NOW + 1,
  });
  assert.equal(claims.participant_id, "participant_73");
  assert.equal(claims.jti, "test-jti-0001");
  assert.equal(Object.isFrozen(claims), true);
});

test("rejects cross-challenge replay, expiry, tampering, and extra segments", () => {
  const token = deterministicTicket();

  assert.throws(
    () =>
      verifyParticipantTicket(token, SECRET, {
        audience: "drift",
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

test("Redis JTI consumption is atomic, event-scoped, audience-scoped, and ticket-lived", async () => {
  const calls = [];
  const keys = new Set();
  const redis = {
    async set(key, value, options) {
      calls.push({ key, value, options });
      if (keys.has(key)) return null;
      keys.add(key);
      return "OK";
    },
  };
  const consumeJti = createRedisTicketJtiConsumer(redis, {
    eventId: "ctf26-final",
    prefix: "ctf26:ticket:v1",
    now: () => NOW,
  });
  const claim = {
    eventId: "ctf26-final",
    audience: "imprint",
    jti: "test-jti-0001",
    expiresAt: NOW + 300,
  };

  assert.equal(await consumeJti(claim), true);
  assert.equal(await consumeJti(claim), false);
  assert.deepEqual(calls[0], {
    key: "ctf26:ticket:v1:ctf26-final:imprint:test-jti-0001",
    value: "1",
    options: { NX: true, EX: 300 },
  });
  await assert.rejects(
    consumeJti({ ...claim, eventId: "ctf26-rehearsal" }),
    (error) => error instanceof ParticipantTicketError && error.code === "wrong_event",
  );
});

test("optionally binds a normalized participant email to the signed ticket", () => {
  const token = deterministicTicket({ email: "Player@Example.COM" });
  const claims = verifyParticipantTicket(token, SECRET, { audience: "imprint", now: NOW + 1 });
  assert.equal(claims.email, "player@example.com");
  assert.throws(
    () => deterministicTicket({ email: "not-an-email" }),
    (error) => error instanceof ParticipantTicketError && error.code === "invalid_claim",
  );
});

test("refuses short secrets and overlong ticket lifetimes", () => {
  assert.throws(
    () =>
      issueParticipantTicket(
        { audience: "imprint", participantId: "p1" },
        "too-short",
      ),
    (error) => error instanceof ParticipantTicketError && error.code === "invalid_secret",
  );
  assert.throws(
    () =>
      issueParticipantTicket(
        { audience: "imprint", participantId: "p1" },
        SECRET,
        { ttlSeconds: 601 },
      ),
    (error) => error instanceof ParticipantTicketError && error.code === "invalid_ttl",
  );
});

test("generated ticket IDs always satisfy the identifier grammar", () => {
  for (let index = 0; index < 512; index += 1) {
    const token = issueParticipantTicket(
      { audience: "imprint", participantId: "p1" },
      SECRET,
      { now: NOW },
    );
    const claims = verifyParticipantTicket(token, SECRET, { audience: "imprint", now: NOW });
    assert.match(claims.jti, /^jti_[A-Za-z0-9_-]+$/);
  }
});
