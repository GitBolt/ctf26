import assert from "node:assert/strict";
import test from "node:test";

import {
  RequestBudgetExceededError,
  consumeFixedWindowBudget,
  createMemoryBudgetExecutor,
  trustedClientAddress,
} from "../index.js";

function consume(execute, participant) {
  return consumeFixedWindowBudget({
    execute,
    prefix: "ctf26:test:budget",
    buckets: [
      { key: "global", limit: 3, windowMs: 60_000 },
      { key: `participant:${participant}`, limit: 1, windowMs: 60_000 },
    ],
  });
}

test("a rejected identity cannot consume the shared budget of other participants", async () => {
  const execute = createMemoryBudgetExecutor();
  await consume(execute, "one");
  for (let index = 0; index < 50; index += 1) {
    await assert.rejects(() => consume(execute, "one"), RequestBudgetExceededError);
  }
  await consume(execute, "two");
  await consume(execute, "three");
  await assert.rejects(() => consume(execute, "four"), RequestBudgetExceededError);
});

test("fixed-window rejection provides a conservative retry interval", async () => {
  const execute = createMemoryBudgetExecutor();
  await consume(execute, "one");
  await assert.rejects(async () => consume(execute, "one"), (error) => {
    assert.ok(error.retryAfter >= 1);
    assert.ok(error.retryAfter <= 61);
    return true;
  });
});

test("a wall-clock boundary does not reset an active request budget", async () => {
  const execute = createMemoryBudgetExecutor();
  const options = {
    execute,
    prefix: "ctf26:test:boundary",
    buckets: [{ key: "source", limit: 1, windowMs: 60_000 }],
  };
  await consumeFixedWindowBudget({ ...options, now: 59_999 });
  await assert.rejects(
    () => consumeFixedWindowBudget({ ...options, now: 60_001 }),
    RequestBudgetExceededError,
  );
});

test("Railway's validated client address wins over a spoofable forwarding chain", () => {
  const request = {
    headers: {
      "x-real-ip": "203.0.113.7",
      "x-forwarded-for": "192.0.2.1, 198.51.100.2",
    },
    socket: { remoteAddress: "10.0.0.4" },
  };
  assert.equal(trustedClientAddress(request), "203.0.113.7");
});

test("client address extraction rejects non-IP header values and supports local sockets", () => {
  assert.equal(trustedClientAddress({
    headers: { "x-real-ip": "not-an-ip", "x-forwarded-for": "also-invalid" },
    socket: { remoteAddress: "::1" },
  }), "::1");
  assert.equal(trustedClientAddress({ headers: {}, socket: {} }), "unknown");
});
