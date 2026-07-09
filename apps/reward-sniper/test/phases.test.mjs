import assert from "node:assert/strict";
import test from "node:test";

import {
  beginRevealPhase,
  commitAction,
  createMarket,
  inspectMarket,
  issueVoucher,
  registerTeam,
  revealAction,
  resolveTick,
  scoreboard,
} from "../src/market.mjs";

test("commit and reveal endpoints are separated by explicit phase boundaries", () => {
  const market = createMarket("phase-boundaries");
  registerTeam(market, "team-a");
  const action = ticketAction(market, "team-a", 0, 400, "phase-voucher");

  assert.equal(market.phase, "commit");
  assert.throws(() => revealAction(market, "team-a", action, "phase-action-nonce"), /reveal phase is not open/);
  assert.throws(() => resolveTick(market), /reveal phase is not open/);
  commitAction(market, "team-a", action, "phase-action-nonce");

  beginRevealPhase(market);
  assert.equal(market.phase, "reveal");
  assert.throws(
    () => commitAction(market, "team-a", action, "late-commit-nonce"),
    /commit phase is not open/,
  );
  assert.throws(
    () => issueVoucher(market, "team-a", { binId: 0, nonce: "late-voucher" }),
    /commit phase is not open/,
  );
  assert.equal(revealAction(market, "team-a", action, "phase-action-nonce").accepted, true);

  const batch = resolveTick(market);
  assert.equal(batch.tick, 12);
  assert.equal(market.tick, 13);
  assert.equal(market.phase, "commit");
});

test("commitments and queued reveals are immutable for the whole tick", () => {
  const market = createMarket("immutable-commit");
  registerTeam(market, "team-a");
  const action = ticketAction(market, "team-a", 0, 900, "immutable-voucher");
  const originalAction = structuredClone(action);

  commitAction(market, "team-a", action, "immutable-action-nonce");
  assert.throws(
    () => commitAction(market, "team-a", { type: "swap", toBin: 2 }, "replacement-action"),
    /already committed this tick/,
  );
  beginRevealPhase(market);
  assert.throws(
    () => revealAction(market, "team-a", { ...action, liquidity: 1 }, "immutable-action-nonce"),
    /commitment mismatch/,
  );
  revealAction(market, "team-a", action, "immutable-action-nonce");
  assert.throws(
    () => revealAction(market, "team-a", action, "immutable-action-nonce"),
    /already revealed this tick/,
  );

  action.liquidity = 1;
  action.voucher.signature = "0".repeat(64);
  const batch = resolveTick(market);
  assert.equal(batch.results[0].status, "resolved");
  assert.equal(inspectMarket(market, "team-a").team.liquidityBalance, 2_100);
  assert.equal(originalAction.liquidity, 900);
});

test("a missed reveal closes without consuming tickets or funded liquidity", () => {
  const market = createMarket("missed-reveal");
  registerTeam(market, "team-a");
  const action = ticketAction(market, "team-a", 0, 700, "missed-voucher");

  commitAction(market, "team-a", action, "missed-action-nonce");
  beginRevealPhase(market);
  const batch = resolveTick(market);

  assert.deepEqual(batch.results, [{ tick: 12, teamId: "team-a", status: "missed-reveal" }]);
  const view = inspectMarket(market, "team-a");
  assert.equal(view.team.tickets, 3);
  assert.equal(view.team.liquidityBalance, 3_000);
  assert.equal(view.team.escrow, 0);
  assert.equal(view.team.lastResolution.status, "missed-reveal");
});

test("reveals settle as one deterministic batch independent of reveal arrival order", () => {
  const market = createMarket("batch-settlement");
  registerTeam(market, "team-b");
  registerTeam(market, "team-a");
  const actions = {
    "team-a": ticketAction(market, "team-a", 0, 600, "batch-voucher-a"),
    "team-b": ticketAction(market, "team-b", 3, 800, "batch-voucher-b"),
  };
  const nonces = { "team-a": "batch-action-a", "team-b": "batch-action-b" };

  commitAction(market, "team-a", actions["team-a"], nonces["team-a"]);
  commitAction(market, "team-b", actions["team-b"], nonces["team-b"]);
  beginRevealPhase(market);
  revealAction(market, "team-b", actions["team-b"], nonces["team-b"]);
  revealAction(market, "team-a", actions["team-a"], nonces["team-a"]);

  assert.equal(inspectMarket(market, "team-a").team.escrow, 0);
  assert.equal(inspectMarket(market, "team-b").team.escrow, 0);
  assert.ok(scoreboard(market).every((row) => row.escrow === 0));

  const batch = resolveTick(market);
  assert.deepEqual(batch.results.map((result) => result.teamId), ["team-a", "team-b"]);
  assert.ok(batch.results.every((result) => result.status === "resolved"));
  assert.ok(batch.results.every((result) => result.result.extracted > 0));
  assert.equal(market.tick, 13);
  assert.ok(scoreboard(market).every((row) => row.escrow > 0));
});

function ticketAction(market, teamId, binId, liquidity, voucherNonce) {
  return {
    type: "ticket",
    binId,
    liquidity,
    voucher: issueVoucher(market, teamId, { binId, nonce: voucherNonce }),
  };
}
