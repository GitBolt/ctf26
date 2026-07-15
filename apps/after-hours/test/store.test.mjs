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
  const [first, second] = await Promise.all([
    store.fulfill("AH-ONE", "signature", { mint: "fake" }, 200),
    store.fulfill("AH-ONE", "signature", { mint: "fake" }, 200),
  ]);
  assert.equal([first.ok, second.ok].filter(Boolean).length, 1);
});

test("ticket replay is rejected", async () => {
  const store = createMemoryStore();
  assert.equal(await store.consumeTicket("jti"), true);
  assert.equal(await store.consumeTicket("jti"), false);
});
