import assert from "node:assert/strict";
import test from "node:test";

import { createSessionChannelGate, hostKey, sessionTiming, sshAdmissionConfig, sshCandidateRateKey } from "../src/server.mjs";

test("LAST STOP applies a bounded five-minute hard journey window", () => {
  assert.deepEqual(sessionTiming({}), { maxMs: 300_000 });
  assert.deepEqual(sessionTiming({ LAST_STOP_SESSION_MAX_MS: "120000" }), { maxMs: 120_000 });
  assert.deepEqual(sessionTiming({ LAST_STOP_SESSION_MAX_MS: "invalid" }), { maxMs: 300_000 });
});

test("one authenticated SSH transport can claim only one journey channel", () => {
  const claimSessionChannel = createSessionChannelGate();

  assert.equal(claimSessionChannel(), true);
  assert.equal(claimSessionChannel(), false);
  assert.equal(claimSessionChannel(), false);
});

test("SSH admission is proxy-safe and passage keys do not expose credentials", () => {
  const config = sshAdmissionConfig({});
  assert.equal(config.maxConnections, 100);
  assert.equal(config.globalAttemptsPerMinute, 1_200);
  assert.equal(config.attemptsPerCodePerMinute, 8);
  const key = sshCandidateRateKey("secret-passage");
  assert.match(key, /^[A-Za-z0-9_-]{24}$/);
  assert.doesNotMatch(key, /secret|passage/);
});

test("production requires an explicit SSH host key source", async () => {
  await assert.rejects(() => hostKey({ NODE_ENV: "production" }), /SSH_HOST_KEY_BASE64.*SSH_HOST_KEY_PATH.*required in production/);
  const encoded = Buffer.from("test-only-host-key-material").toString("base64");
  assert.deepEqual(await hostKey({ NODE_ENV: "production", LAST_STOP_SSH_HOST_KEY_BASE64: encoded }), Buffer.from("test-only-host-key-material"));
});
