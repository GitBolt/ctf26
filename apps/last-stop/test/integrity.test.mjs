import assert from "node:assert/strict";
import test from "node:test";

import { forwardLastStopActivity, lastStopIntegrityActivity } from "../src/server.mjs";

test("LAST STOP forwards only controlled workflow outcomes", async () => {
  const calls = [];
  const credential = "passphrase-that-must-not-leave-the-ssh-service";
  const rawCommand = "buy secret-route-from-terminal";
  const env = {
    INTEGRITY_INGEST_URL: "https://integrity.example/api/internal/integrity/disclosure",
    INTEGRITY_INGEST_KEY: "i".repeat(32),
  };
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return { ok: true, status: 202, json: async () => ({ recorded: true }) };
  };

  const result = await forwardLastStopActivity({
    identity: {
      participantId: "participant-7",
      email: "private@example.com",
      password: credential,
      command: rawCommand,
    },
    activityKey: "card-issued",
    generation: "integrity-test-event",
    env,
    fetchImpl,
  });

  assert.equal(result.recorded, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://integrity.example/api/internal/integrity/event");
  const payload = JSON.parse(calls[0].init.body);
  assert.deepEqual(payload.identity, { participantId: "participant-7", eventId: "integrity-test-event" });
  assert.deepEqual(payload.event, {
    action: "ssh:card-issued",
    category: "challenge-action",
    outcome: "issued",
    request: {
      source: "service",
      client: { kind: "unknown", family: "unknown" },
      fetchSite: "",
      fetchMode: "",
      fetchDest: "",
      fetchUser: "",
      accept: "missing",
      referer: "missing",
      origin: "missing",
      clientHints: false,
    },
  });
  const forwarded = JSON.stringify(payload);
  assert.doesNotMatch(forwarded, new RegExp(credential));
  assert.doesNotMatch(forwarded, /private@example\.com/);
  assert.doesNotMatch(forwarded, /secret-route-from-terminal/);

  const skipped = await forwardLastStopActivity({
    identity: { participantId: "participant-7" },
    activityKey: rawCommand,
    generation: "integrity-test-event",
    env,
    fetchImpl,
  });
  assert.deepEqual(skipped, { recorded: false, skipped: true });
  assert.equal(calls.length, 1);
});

test("LAST STOP workflow vocabulary carries useful outcomes without command arguments", () => {
  assert.deepEqual(lastStopIntegrityActivity("session-started"), {
    action: "ssh:session-started",
    category: "challenge-action",
    outcome: "connected",
  });
  assert.deepEqual(lastStopIntegrityActivity("journey-completed"), {
    action: "ssh:challenge-completed",
    category: "completion",
    outcome: "completed",
  });
  assert.equal(lastStopIntegrityActivity("tap some-private-card"), null);
});
