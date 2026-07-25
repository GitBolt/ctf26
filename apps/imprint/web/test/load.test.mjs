import assert from "node:assert/strict";
import test from "node:test";

import {
  RequestBudgetExceededError,
  RequestBudgetStorageError,
  createMemoryBudgetExecutor,
} from "@ctf26/request-budget";

import {
  consumeImprintRequestBudget,
  imprintRpcCost,
} from "../lib/request-budget.mjs";

const ENV = { NODE_ENV: "test", CTF_EVENT_GENERATION: "imprint-load" };

function request(ip = "203.0.113.20") {
  return new Request("https://imprint.example/api/test", { headers: { "x-forwarded-for": ip } });
}

test("IMPRINT session budget accepts 50 participants and rejects a sustained source flood", async () => {
  const execute = createMemoryBudgetExecutor();
  await Promise.all(Array.from({ length: 50 }, () => consumeImprintRequestBudget("session", {
    request: request(), env: ENV, execute,
  })));
  for (let index = 0; index < 70; index += 1) {
    await consumeImprintRequestBudget("session", { request: request(), env: ENV, execute });
  }
  await assert.rejects(
    () => consumeImprintRequestBudget("session", { request: request(), env: ENV, execute }),
    RequestBudgetExceededError,
  );
});

test("IMPRINT participant budgets isolate 50 concurrent claims and repeated spam", async () => {
  const execute = createMemoryBudgetExecutor();
  const participants = Array.from({ length: 50 }, (_, index) => `imprint-player-${index + 1}`);
  const scoreState = new Map([["existing-player", 100]]);
  const eligibilityState = new Map([["existing-player", "eligible"]]);
  await Promise.all(participants.map((participantId) => consumeImprintRequestBudget("passkeyClaim", {
    request: request(), participantId, env: ENV, execute,
  })));
  for (let index = 0; index < 5; index += 1) {
    await consumeImprintRequestBudget("passkeyClaim", {
      request: request(), participantId: participants[0], env: ENV, execute,
    });
  }
  await assert.rejects(() => consumeImprintRequestBudget("passkeyClaim", {
    request: request(), participantId: participants[0], env: ENV, execute,
  }), RequestBudgetExceededError);
  await assert.doesNotReject(() => consumeImprintRequestBudget("passkeyClaim", {
    request: request(), participantId: participants[1], env: ENV, execute,
  }));
  assert.deepEqual([...scoreState], [["existing-player", 100]]);
  assert.deepEqual([...eligibilityState], [["existing-player", "eligible"]]);
});

test("weighted RPC budgets bound expensive batches without coupling identities", async () => {
  const execute = createMemoryBudgetExecutor();
  const participants = Array.from({ length: 50 }, (_, index) => `rpc-player-${index + 1}`);
  const lightCalls = [{ method: "getAccountInfo" }];
  const heavyCalls = Array.from({ length: 10 }, () => ({ method: "sendTransaction" }));
  assert.equal(imprintRpcCost(lightCalls), 1);
  assert.equal(imprintRpcCost(heavyCalls), 80);
  await Promise.all(participants.map((participantId, index) => consumeImprintRequestBudget("rpc", {
    request: request(`198.51.100.${index + 1}`),
    participantId,
    cost: imprintRpcCost(lightCalls),
    env: ENV,
    execute,
  })));
  for (let index = 0; index < 12; index += 1) {
    await consumeImprintRequestBudget("rpc", {
      request: request("198.51.100.200"),
      participantId: participants[0],
      cost: imprintRpcCost(heavyCalls),
      env: ENV,
      execute,
    });
  }
  await assert.rejects(() => consumeImprintRequestBudget("rpc", {
    request: request("198.51.100.200"),
    participantId: participants[0],
    cost: imprintRpcCost(heavyCalls),
    env: ENV,
    execute,
  }), RequestBudgetExceededError);
  await assert.doesNotReject(() => consumeImprintRequestBudget("rpc", {
    request: request("198.51.100.201"),
    participantId: participants[1],
    cost: imprintRpcCost(heavyCalls),
    env: ENV,
    execute,
  }));
});

test("production request controls fail safe when shared storage is unavailable", async () => {
  await assert.rejects(() => consumeImprintRequestBudget("session", {
    request: request(),
    env: { NODE_ENV: "production", CTF_EVENT_GENERATION: "official" },
  }), RequestBudgetStorageError);
});
