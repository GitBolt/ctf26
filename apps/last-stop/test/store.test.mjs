import assert from "node:assert/strict";
import test from "node:test";

import { createStore } from "../src/store.mjs";

test("production refuses volatile challenge state", async () => {
  await assert.rejects(() => createStore({ NODE_ENV: "production", CTF_EVENT_GENERATION: "event-a" }), /REDIS_URL is required/);
});

test("the store keeps audit evidence but no resumable journey state", async () => {
  const store = await createStore({});
  assert.equal(store.getParticipant, undefined);
  assert.equal(store.setParticipant, undefined);

  await store.appendCommand("participant-a", { at: "first", command: "kiosk" });
  await store.appendCommand("participant-a", { at: "second", command: "buy airport" });
  assert.deepEqual(await store.getRecentCommands("participant-a", 1), [{ at: "second", command: "buy airport" }]);

  const first = await store.recordCompletion("participant-a", { receipt: "first", completedAt: "now" });
  const repeated = await store.recordCompletion("participant-a", { receipt: "replacement", completedAt: "later" });
  assert.deepEqual(first, { receipt: "first", completedAt: "now" });
  assert.deepEqual(repeated, first);
  assert.deepEqual(await store.getCompletion("participant-a"), first);
  assert.equal(await store.getCompletion("participant-b"), null);
  await store.close();
});
