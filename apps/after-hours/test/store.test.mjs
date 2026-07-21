import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryStore, createStore } from "../src/store.mjs";

const IDENTITY = Object.freeze({ participantId: "participant-1", email: "p@example.com" });

test("production refuses volatile challenge state", async () => {
  await assert.rejects(() => createStore({ NODE_ENV: "production", CTF_EVENT_GENERATION: "event-a" }), /REDIS_URL is required/);
});

test("production requires an explicit event generation", async () => {
  await assert.rejects(() => createStore({ NODE_ENV: "production" }), /CTF_EVENT_GENERATION is required/);
});

test("passages are one-use and Discord identity is bound both ways", async () => {
  const store = createMemoryStore();
  const code = await store.issuePassage(IDENTITY);
  const first = await store.bindPassage(code, "123456789");
  assert.equal(first.ok, true);
  assert.equal((await store.bindPassage(code, "123456789")).reason, "invalid");
  const secondCode = await store.issuePassage({ participantId: "participant-2" });
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
  assert.equal(await store.completionForParticipant("participant-1"), 200);
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

test("an expected-mint checkout consumes its signature without completing the CTF", async () => {
  const store = createMemoryStore();
  const order = { id: "AH-HONEST", participantId: "participant-1", status: "open", createdAt: 100, expiresAt: 700 };
  await store.createOrder(order);
  const settled = await store.settleExpectedPayment(order.id, "honest-signature", { mint: "official-mint", counterfeit: false }, 200);
  assert.equal(settled.ok, true);
  assert.equal(settled.order.status, "expected-payment");
  assert.equal(await store.completionForParticipant("participant-1"), null);
  await store.createOrder({ ...order, id: "AH-NEXT", createdAt: 201 });
  assert.equal((await store.fulfill("AH-NEXT", "honest-signature", { mint: "fake" }, 202)).reason, "signature_used");
});

test("ticket replay is rejected", async () => {
  const store = createMemoryStore();
  assert.equal(await store.consumeTicket("jti"), true);
  assert.equal(await store.consumeTicket("jti"), false);
});

test("official NIGHT allotment is participant-bound and issued once", async () => {
  const store = createMemoryStore();
  const first = await store.beginAllotment("participant-1", "wallet-1", "mint-1", 100);
  assert.equal(first.ok, true);
  assert.equal((await store.beginAllotment("participant-1", "wallet-1", "mint-1", 101)).reason, "pending");
  assert.equal((await store.beginAllotment("participant-1", "wallet-2", "mint-1", 101)).reason, "wallet_conflict");
  assert.equal((await store.completeAllotment("participant-1", "wallet-1", "mint-1", first.allotment.leaseId, { signature: "sig" }, 102)).ok, true);
  const repeated = await store.beginAllotment("participant-1", "wallet-1", "mint-1", 103);
  assert.equal(repeated.reason, "issued");
  assert.equal(repeated.allotment.evidence.signature, "sig");
});

test("a failed NIGHT transfer can be retried only for the same wallet", async () => {
  const store = createMemoryStore();
  const first = await store.beginAllotment("participant-1", "wallet-1", "mint-1", 100);
  await store.failAllotment("participant-1", "wallet-1", "mint-1", first.allotment.leaseId, "rpc", 101);
  assert.equal((await store.beginAllotment("participant-1", "wallet-2", "mint-1", 102)).reason, "wallet_conflict");
  const retry = await store.beginAllotment("participant-1", "wallet-1", "mint-1", 102);
  assert.equal(retry.ok, true);
  assert.equal(retry.allotment.attempts, 2);
});

test("a replacement official mint receives a fresh participant allotment", async () => {
  const store = createMemoryStore();
  const first = await store.beginAllotment("participant-1", "old-wallet", "old-mint", 100);
  await store.completeAllotment("participant-1", "old-wallet", "old-mint", first.allotment.leaseId, { signature: "old" }, 101);
  const replacement = await store.beginAllotment("participant-1", "new-wallet", "new-mint", 102);
  assert.equal(replacement.ok, true);
  assert.equal(replacement.allotment.mint, "new-mint");
  assert.equal(replacement.allotment.attempts, 1);
});

test("an expired allotment lease can be reclaimed and stale work cannot overwrite it", async () => {
  const store = createMemoryStore({ leaseSeconds: 90 });
  const first = await store.beginAllotment("participant-1", "wallet-1", "mint-1", 100);
  assert.equal((await store.beginAllotment("participant-1", "wallet-1", "mint-1", 189)).reason, "pending");
  const replacement = await store.beginAllotment("participant-1", "wallet-1", "mint-1", 190);
  assert.equal(replacement.ok, true);
  assert.notEqual(replacement.allotment.leaseId, first.allotment.leaseId);
  assert.equal(await store.completeAllotment("participant-1", "wallet-1", "mint-1", first.allotment.leaseId, { signature: "stale" }, 191).then((result) => result.ok), false);
  await store.failAllotment("participant-1", "wallet-1", "mint-1", first.allotment.leaseId, "stale", 191);
  assert.equal((await store.allotmentForParticipant("participant-1")).status, "pending");
  assert.equal((await store.completeAllotment("participant-1", "wallet-1", "mint-1", replacement.allotment.leaseId, { signature: "fresh" }, 192)).ok, true);
});

test("issued allotment capacity counts each participant once for the active generation", async () => {
  const store = createMemoryStore({ generation: "capacity-event" });
  assert.equal(await store.issuedAllotmentCount(), 0);
  const first = await store.beginAllotment("participant-1", "wallet-1", "mint-1", 100);
  assert.equal((await store.completeAllotment("participant-1", "wallet-1", "mint-1", first.allotment.leaseId, { signature: "one" }, 101)).ok, true);
  assert.equal(await store.issuedAllotmentCount(), 1);
  assert.equal((await store.completeAllotment("participant-1", "wallet-1", "mint-1", first.allotment.leaseId, { signature: "duplicate" }, 102)).ok, false);
  const replacement = await store.beginAllotment("participant-1", "wallet-2", "mint-2", 103);
  assert.equal((await store.completeAllotment("participant-1", "wallet-2", "mint-2", replacement.allotment.leaseId, { signature: "replacement" }, 104)).ok, true);
  assert.equal(await store.issuedAllotmentCount(), 1);
});
