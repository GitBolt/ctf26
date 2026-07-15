import assert from "node:assert/strict";
import test from "node:test";

import { completionFor, createInstance, inspectAccount, migrationTrace, openJackpot, publicCabinet } from "../src/model.mjs";

test("public cabinet withholds the earlier pass", () => {
  const instance = createInstance("team-a", "fixed");
  const view = publicCabinet(instance);
  assert.equal(view.currentPass, instance.currentPass);
  assert.equal(JSON.stringify(view).includes(instance.previousPass), false);
});

test("migration evidence exposes an inspectable input without answer semantics", () => {
  const instance = createInstance("team-a", "fixed");
  const trace = migrationTrace(instance);
  const input = trace.accounts.find(({ address }) => address === instance.previousPass);
  assert.equal(input.role, "credential input");
  assert.equal(input.changed, false);
  assert.deepEqual(inspectAccount(instance, input.address), {
    found: true,
    address: instance.previousPass,
    owner: "local-test-program",
    holder: instance.holder,
    generation: 1,
    active: true,
  });
});

test("duplicate current pass is rejected", () => {
  const instance = createInstance("team-a", "fixed");
  const result = openJackpot(instance, {
    leftPass: instance.currentPass,
    rightPass: instance.currentPass,
    leftHolder: instance.holder,
    rightHolder: instance.holder,
  });
  assert.equal(result.code, "duplicate_pass");
  assert.equal(instance.opened, false);
});

test("stale and current passes open the jackpot for one holder", () => {
  const instance = createInstance("team-a", "fixed");
  const result = openJackpot(instance, {
    leftPass: instance.currentPass,
    rightPass: instance.previousPass,
    leftHolder: instance.holder,
    rightHolder: instance.holder,
  });
  assert.equal(result.ok, true);
  assert.equal(instance.opened, true);
  const receipt = completionFor(instance, "completion-secret-that-is-at-least-32-bytes");
  assert.match(receipt, /^pt_[A-Za-z0-9_-]{30}$/);
});

test("foreign holder and unknown pass are rejected", () => {
  const instance = createInstance("team-a", "fixed");
  assert.equal(openJackpot(instance, {
    leftPass: instance.currentPass,
    rightPass: instance.previousPass,
    leftHolder: instance.holder,
    rightHolder: "foreign",
  }).code, "holder_mismatch");
  assert.equal(openJackpot(instance, {
    leftPass: instance.currentPass,
    rightPass: "missing",
    leftHolder: instance.holder,
    rightHolder: instance.holder,
  }).code, "unknown_pass");
});
