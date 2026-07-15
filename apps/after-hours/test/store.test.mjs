import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryStore } from "../src/store.mjs";

const IDENTITY = Object.freeze({ participantId: "participant-1", teamId: "team-1", email: "p@example.com" });

test("passages are one-use and Discord identity is bound both ways", async () => {
  const store = createMemoryStore();
  const code = await store.issuePassage(IDENTITY);
  const first = await store.bindPassage(code, "123456789");
  assert.equal(first.ok, true);
  assert.equal((await store.bindPassage(code, "123456789")).reason, "invalid");
  const secondCode = await store.issuePassage({ participantId: "participant-2", teamId: "team-2" });
  assert.equal((await store.bindPassage(secondCode, "123456789")).reason, "discord_conflict");
});

test("passages expire after ten minutes", async () => {
  let clock = 1_000;
  const store = createMemoryStore({ now: () => clock, passageTtlMs: 600_000 });
  const code = await store.issuePassage(IDENTITY);
  clock += 600_001;
  assert.equal((await store.bindPassage(code, "123456789")).reason, "invalid");
});

test("one active order is reused and fulfillment consumes signature atomically", async () => {
  const store = createMemoryStore();
  const order = { id: "AH-ONE", participantId: "participant-1", status: "open", createdAt: 100, expiresAt: 700 };
  assert.equal((await store.createOrder(order)).created, true);
  assert.equal((await store.createOrder({ ...order, id: "AH-TWO", createdAt: 101 })).order.id, "AH-ONE");
  assert.equal((await store.orderById("AH-ONE")).id, "AH-ONE");
  const [first, second] = await Promise.all([
    store.fulfill("AH-ONE", "signature", { mint: "fake" }, 200),
    store.fulfill("AH-ONE", "signature", { mint: "fake" }, 200),
  ]);
  assert.equal([first.ok, second.ok].filter(Boolean).length, 1);
});

test("an expired checkout is replaced instead of reused", async () => {
  const store = createMemoryStore();
  const expired = { id: "AH-OLD", participantId: "participant-1", status: "open", createdAt: 100, expiresAt: 150 };
  const fresh = { ...expired, id: "AH-NEW", createdAt: 151, expiresAt: 751 };
  assert.equal((await store.createOrder(expired)).created, true);
  const replacement = await store.createOrder(fresh);
  assert.equal(replacement.created, true);
  assert.equal(replacement.order.id, "AH-NEW");
});

test("ticket replay is rejected", async () => {
  const store = createMemoryStore();
  assert.equal(await store.consumeTicket("jti"), true);
  assert.equal(await store.consumeTicket("jti"), false);
});

test("official NIGHT allotment is team-bound and issued once", async () => {
  const store = createMemoryStore();
  const first = await store.beginAllotment("participant-1", "wallet-1", "mint-1", 100);
  assert.equal(first.ok, true);
  assert.equal((await store.beginAllotment("participant-1", "wallet-1", "mint-1", 101)).reason, "pending");
  assert.equal((await store.beginAllotment("participant-1", "wallet-2", "mint-1", 101)).reason, "wallet_conflict");
  assert.equal((await store.completeAllotment("participant-1", "wallet-1", "mint-1", { signature: "sig" }, 102)).ok, true);
  const repeated = await store.beginAllotment("participant-1", "wallet-1", "mint-1", 103);
  assert.equal(repeated.reason, "issued");
  assert.equal(repeated.allotment.evidence.signature, "sig");
});

test("a failed NIGHT transfer can be retried only for the same wallet", async () => {
  const store = createMemoryStore();
  await store.beginAllotment("participant-1", "wallet-1", "mint-1", 100);
  await store.failAllotment("participant-1", "wallet-1", "mint-1", "rpc", 101);
  assert.equal((await store.beginAllotment("participant-1", "wallet-2", "mint-1", 102)).reason, "wallet_conflict");
  const retry = await store.beginAllotment("participant-1", "wallet-1", "mint-1", 102);
  assert.equal(retry.ok, true);
  assert.equal(retry.allotment.attempts, 2);
});

test("a replacement official mint receives a fresh team allotment", async () => {
  const store = createMemoryStore();
  await store.beginAllotment("team-1", "old-wallet", "old-mint", 100);
  await store.completeAllotment("team-1", "old-wallet", "old-mint", { signature: "old" }, 101);
  const replacement = await store.beginAllotment("team-1", "new-wallet", "new-mint", 102);
  assert.equal(replacement.ok, true);
  assert.equal(replacement.allotment.mint, "new-mint");
  assert.equal(replacement.allotment.attempts, 1);
});
