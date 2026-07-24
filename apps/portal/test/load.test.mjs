import assert from "node:assert/strict";
import test from "node:test";

import { RequestBudgetExceededError, createMemoryBudgetExecutor } from "@ctf26/request-budget";

import { consumePortalRequestBudget } from "../app/lib/request-budget.mjs";
import { createLeaderboardStore } from "../app/lib/leaderboard-store.mjs";

const ENV = { NODE_ENV: "test", CTF_EVENT_GENERATION: "load-test" };

function request(ip = "203.0.113.10") {
  return new Request("https://portal.example/api/test", { headers: { "x-forwarded-for": ip } });
}

test("portal budgets accept a 40-participant burst and isolate participant spam", async () => {
  const execute = createMemoryBudgetExecutor();
  const participants = Array.from({ length: 40 }, (_, index) => `participant-${index + 1}`);
  await Promise.all(participants.map((participantId) => consumePortalRequestBudget("launch", {
    request: request(), participantId, env: ENV, execute,
  })));

  for (let index = 0; index < 11; index += 1) {
    await consumePortalRequestBudget("launch", { request: request(), participantId: participants[0], env: ENV, execute });
  }
  await assert.rejects(
    () => consumePortalRequestBudget("launch", { request: request(), participantId: participants[0], env: ENV, execute }),
    RequestBudgetExceededError,
  );
  await assert.doesNotReject(() => consumePortalRequestBudget("launch", {
    request: request(), participantId: participants[1], env: ENV, execute,
  }));
});

test("score ingest and completion recovery remain isolated at 40-person concurrency", async () => {
  const execute = createMemoryBudgetExecutor();
  const participants = Array.from({ length: 40 }, (_, index) => `scorer-${index + 1}`);
  const scores = new Map([["existing-player", 100]]);

  await Promise.all(participants.flatMap((participantId, index) => [
    consumePortalRequestBudget("scoreAttempt", {
      request: request(`198.51.100.${index + 1}`), env: ENV, execute,
    }),
    consumePortalRequestBudget("scoreIngest", {
      request: request(`198.51.100.${index + 1}`), participantId, env: ENV, execute,
    }),
    consumePortalRequestBudget("completionRecovery", { participantId, cost: 8, env: ENV, execute }),
  ]));

  for (let index = 1; index < 30; index += 1) {
    await consumePortalRequestBudget("scoreIngest", {
      request: request("198.51.100.200"), participantId: participants[0], env: ENV, execute,
    });
  }
  await assert.rejects(() => consumePortalRequestBudget("scoreIngest", {
    request: request("198.51.100.200"), participantId: participants[0], env: ENV, execute,
  }), RequestBudgetExceededError);
  assert.deepEqual([...scores], [["existing-player", 100]]);
});

test("unsigned score floods are bounded before body parsing without coupling source addresses", async () => {
  const execute = createMemoryBudgetExecutor();
  for (let index = 0; index < 240; index += 1) {
    await consumePortalRequestBudget("scoreAttempt", {
      request: request("198.51.100.90"), env: ENV, execute,
    });
  }
  await assert.rejects(() => consumePortalRequestBudget("scoreAttempt", {
    request: request("198.51.100.90"), env: ENV, execute,
  }), RequestBudgetExceededError);
  await assert.doesNotReject(() => consumePortalRequestBudget("scoreAttempt", {
    request: request("198.51.100.91"), env: ENV, execute,
  }));
});

test("public leaderboard polling supports the field but bounds one-source invocation spam", async () => {
  const execute = createMemoryBudgetExecutor();
  const normalMinute = Array.from({ length: 40 * 12 }, () => consumePortalRequestBudget("leaderboardRead", {
    request: request("198.51.100.42"), env: ENV, execute,
  }));
  await Promise.all(normalMinute);
  for (let index = normalMinute.length; index < 1_200; index += 1) {
    await consumePortalRequestBudget("leaderboardRead", {
      request: request("198.51.100.42"), env: ENV, execute,
    });
  }
  await assert.rejects(() => consumePortalRequestBudget("leaderboardRead", {
    request: request("198.51.100.42"), env: ENV, execute,
  }), RequestBudgetExceededError);
  await assert.doesNotReject(() => consumePortalRequestBudget("leaderboardRead", {
    request: request("198.51.100.43"), env: ENV, execute,
  }));
});

test("completion recovery is charged by downstream fanout", async () => {
  const execute = createMemoryBudgetExecutor();
  await consumePortalRequestBudget("completionRecovery", {
    participantId: "recovery-player", cost: 8, env: ENV, execute,
  });
  await consumePortalRequestBudget("completionRecovery", {
    participantId: "recovery-player", cost: 8, env: ENV, execute,
  });
  await assert.rejects(() => consumePortalRequestBudget("completionRecovery", {
    participantId: "recovery-player", cost: 1, env: ENV, execute,
  }), RequestBudgetExceededError);
  await assert.doesNotReject(() => consumePortalRequestBudget("completionRecovery", {
    participantId: "other-recovery-player", cost: 8, env: ENV, execute,
  }));
});

test("40 concurrent duplicate solve deliveries remain idempotent and isolated from legacy review state", async () => {
  const hashes = new Map();
  const touched = [];
  const command = async (parts) => {
    const [verb, key] = parts;
    if (verb === "EVAL" && String(parts[1]).includes("local created=redis.call('HSETNX',KEYS[3]")) {
      const keys = parts.slice(3, 8);
      const [participantId, encoded] = parts.slice(8);
      const solveKey = keys[2];
      touched.push(...keys);
      const hash = hashes.get(solveKey) || new Map();
      hashes.set(solveKey, hash);
      if (hash.has(participantId)) return 0;
      hash.set(participantId, encoded);
      return 1;
    }
    touched.push(key);
    const hash = hashes.get(key) || new Map();
    hashes.set(key, hash);
    if (verb === "HSETNX") {
      if (hash.has(parts[2])) return 0;
      hash.set(parts[2], parts[3]);
      return 1;
    }
    if (verb === "HGETALL") return [...hash].flatMap(([entryKey, encoded]) => [entryKey, encoded]);
    if (verb === "DEL") return 1;
    throw new Error(`unsupported fake Redis command ${verb}`);
  };
  const store = createLeaderboardStore({ command, env: { LEADERBOARD_EVENT_GENERATION: "load-test" } });
  const results = await Promise.all(Array.from({ length: 40 }, (_, index) => {
    const participantId = `duplicate-player-${index + 1}`;
    return ["first", "retry"].map((sourceId) => store.recordSolve({
      challenge: "imprint",
      participantId,
      sourceId: `${sourceId}-${index}`,
      occurredAt: "2026-07-26T08:00:00.000Z",
    }));
  }).flat());
  assert.equal(results.filter(Boolean).length, 40);
  assert.equal((await store.solves()).length, 40);
  assert.equal(touched.some((key) => key.includes("participant-adjustment")), false);
});
