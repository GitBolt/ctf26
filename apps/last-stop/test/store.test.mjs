import assert from "node:assert/strict";
import test from "node:test";

import { createStore } from "../src/store.mjs";

test("the store keeps audit evidence but no resumable journey state", async () => {
  const store = await createStore({});
  assert.equal(store.getTeam, undefined);
  assert.equal(store.setTeam, undefined);

  await store.appendCommand("team-a", { at: "first", command: "kiosk" });
  await store.appendCommand("team-a", { at: "second", command: "buy airport" });
  assert.deepEqual(await store.getRecentCommands("team-a", 1), [{ at: "second", command: "buy airport" }]);

  const first = await store.recordCompletion("team-a", { receipt: "first", completedAt: "now" });
  const repeated = await store.recordCompletion("team-a", { receipt: "replacement", completedAt: "later" });
  assert.deepEqual(first, { receipt: "first", completedAt: "now" });
  assert.deepEqual(repeated, first);
  await store.close();
});
