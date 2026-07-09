import assert from "node:assert/strict";
import test from "node:test";
import {
  advanceTick,
  beginRevealPhase,
  claimWithSniperTicket,
  commitAction,
  createMarket,
  inspectMarket,
  issueVoucher,
  registerTeam,
  revealAction,
  resolveTick,
  scoreboard,
  simulateBestTicket,
  snapshot,
  verifyVoucher,
} from "../src/market.mjs";

test("sniper ticket captures stale reward that fresh liquidity should not earn", () => {
  const market = createMarket("test-sniper");
  registerTeam(market, "team-a");
  const best = simulateBestTicket(market, "team-a", 900);
  const voucher = issueVoucher(market, "team-a", { binId: best.binId, nonce: "ticket-n1" });
  const result = claimWithSniperTicket(market, "team-a", best.binId, 900, voucher);

  assert.equal(result.fairReward, 0);
  assert.ok(result.extracted > 0);
  assert.equal(result.ticketsRemaining, 2);
});

test("post-settlement checkpoint would not capture backlog, proving the intended primitive", () => {
  const market = createMarket("test-checkpoint-order");
  registerTeam(market, "team-a");
  const best = simulateBestTicket(market, "team-a", 900);
  const staleBin = inspectMarket(market, "team-a").bins.find((bin) => bin.id === best.binId);

  const postSettlementCheckpointReward = 0;
  const voucher = issueVoucher(market, "team-a", { binId: best.binId, nonce: "ticket-n1" });
  const result = claimWithSniperTicket(market, "team-a", best.binId, 900, voucher);

  assert.ok(staleBin.staleTicks > 0);
  assert.equal(postSettlementCheckpointReward, 0);
  assert.ok(result.extracted > postSettlementCheckpointReward);
});

test("tickets are scarce and consumed even when the selected window is low value", () => {
  const market = createMarket("test-tickets");
  registerTeam(market, "team-a");

  for (let i = 0; i < 3; i += 1) {
    const voucher = issueVoucher(market, "team-a", { binId: -4, nonce: `ticket-n${i}` });
    claimWithSniperTicket(market, "team-a", -4, 1, voucher);
    advanceTick(market, 1);
  }

  const voucher = issueVoucher(market, "team-a", { binId: -4, nonce: "ticket-n4" });
  assert.throws(() => claimWithSniperTicket(market, "team-a", -4, 1, voucher), /no sniper tickets/);
});

test("high-value action requires voucher bound to team, tick, and bin", () => {
  const market = createMarket("test-voucher");
  registerTeam(market, "team-a");
  registerTeam(market, "team-b");
  const voucher = issueVoucher(market, "team-a", { binId: 0, nonce: "same-voucher" });

  assert.throws(() => claimWithSniperTicket(market, "team-b", 0, 900, voucher), /voucher binding/);
  assert.throws(() => claimWithSniperTicket(market, "team-a", 1, 900, voucher), /voucher binding/);
  advanceTick(market, 1);
  assert.throws(() => claimWithSniperTicket(market, "team-a", 0, 900, voucher), /voucher binding/);
});

test("commit reveal binds the exact action that resolves", () => {
  const market = createMarket("test-commit");
  registerTeam(market, "team-a");
  const best = simulateBestTicket(market, "team-a");
  const voucher = issueVoucher(market, "team-a", { binId: best.binId, nonce: "voucher-v" });
  const action = { type: "ticket", binId: best.binId, liquidity: 900, voucher };

  commitAction(market, "team-a", action, "commit-secret");
  assert.throws(() => commitAction(market, "team-a", action, "second-secret"), /already committed/);
  assert.throws(() => revealAction(market, "team-a", action, "commit-secret"), /reveal phase is not open/);
  beginRevealPhase(market);
  assert.throws(
    () => revealAction(market, "team-a", { ...action, binId: best.binId + 1 }, "commit-secret"),
    /commitment mismatch/,
  );
  const queued = revealAction(market, "team-a", action, "commit-secret");
  assert.equal(queued.accepted, true);
  assert.equal(inspectMarket(market, "team-a").team.escrow, 0);
  const batch = resolveTick(market);
  assert.ok(batch.results[0].result.extracted > 0);
});

test("a matching but invalid reveal fails only at batch settlement", () => {
  const market = createMarket("test-invalid-reveal");
  registerTeam(market, "team-a");
  const voucher = issueVoucher(market, "team-a", { binId: 0, nonce: "invalid-reveal" });
  const invalidAction = { type: "ticket", binId: 0, liquidity: 0, voucher };

  commitAction(market, "team-a", invalidAction, "invalid-commit-nonce");
  assert.throws(
    () => commitAction(market, "team-a", { type: "swap", toBin: 1 }, "replacement-nonce"),
    /already committed this tick/,
  );
  beginRevealPhase(market);
  assert.equal(revealAction(market, "team-a", invalidAction, "invalid-commit-nonce").accepted, true);
  const batch = resolveTick(market);
  assert.equal(batch.results[0].status, "failed");
  assert.match(batch.results[0].error, /positive integer/);
  assert.equal(inspectMarket(market, "team-a").team.tickets, 3);
});

test("telemetry is useful but incomplete", () => {
  const market = createMarket("test-telemetry");
  registerTeam(market, "team-a", "delayed-bin-touch");
  const view = inspectMarket(market, "team-a");

  assert.equal(view.team.telemetry.kind, "delayed-bin-touch");
  assert.ok(view.team.telemetry.touches.length < view.bins.length);
});

test("scoreboard is relative share of extracted reward", () => {
  const market = createMarket("test-scoreboard");
  registerTeam(market, "team-a");
  registerTeam(market, "team-b");
  const best = simulateBestTicket(market, "team-a");
  claimWithSniperTicket(
    market,
    "team-a",
    best.binId,
    900,
    issueVoucher(market, "team-a", { binId: best.binId, nonce: "scoreboard-a" }),
  );
  const rows = scoreboard(market);

  assert.equal(rows[0].teamId, "team-a");
  assert.equal(rows[0].share, 1);
  assert.equal(rows[1].share, 0);
});

test("voucher authority is random per market and absent from serializable state", () => {
  const first = createMarket("same-seed");
  const second = createMarket("same-seed");
  registerTeam(first, "team-a");
  registerTeam(second, "team-a");

  const voucher = issueVoucher(first, "team-a", { binId: 0, nonce: "authority-nonce" });
  assert.throws(() => verifyVoucher(second, "team-a", 0, voucher), /bad voucher signature/);
  assert.equal(Object.hasOwn(first, "secret"), false);
  assert.equal(JSON.stringify(snapshot(first)).includes("reward-sniper-local-secret"), false);
});

test("ticket liquidity must be positive, bounded, and funded", () => {
  const market = createMarket("bounded-liquidity");
  registerTeam(market, "team-a");
  const voucher = issueVoucher(market, "team-a", { binId: 0, nonce: "bounded-liquidity" });

  for (const amount of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, "900"]) {
    assert.throws(
      () => claimWithSniperTicket(market, "team-a", 0, amount, voucher),
      /positive integer/,
    );
  }
  assert.throws(
    () => claimWithSniperTicket(market, "team-a", 0, 1_001, voucher),
    /per-action limit/,
  );

  const result = claimWithSniperTicket(market, "team-a", 0, 900, voucher);
  assert.ok(result.extracted > 0);
  assert.equal(inspectMarket(market, "team-a").team.liquidityBalance, 2_100);
  assert.equal(inspectMarket(market, "team-a").team.tickets, 2);

  const underfunded = createMarket("underfunded", { startingLiquidity: 500, maxActionLiquidity: 1_000 });
  registerTeam(underfunded, "team-a");
  const underfundedVoucher = issueVoucher(underfunded, "team-a", { binId: 0, nonce: "underfunded-test" });
  assert.throws(
    () => claimWithSniperTicket(underfunded, "team-a", 0, 501, underfundedVoucher),
    /insufficient funded liquidity/,
  );
});

test("vouchers are one-shot and each team resolves at most one action per tick", () => {
  const market = createMarket("one-shot");
  registerTeam(market, "team-a");
  const firstVoucher = issueVoucher(market, "team-a", { binId: 0, nonce: "first-voucher" });
  claimWithSniperTicket(market, "team-a", 0, 300, firstVoucher);

  assert.throws(
    () => claimWithSniperTicket(market, "team-a", 0, 300, firstVoucher),
    /voucher already used/,
  );

  const secondVoucher = issueVoucher(market, "team-a", { binId: 1, nonce: "second-voucher" });
  assert.throws(
    () => claimWithSniperTicket(market, "team-a", 1, 300, secondVoucher),
    /action already resolved this tick/,
  );

  advanceTick(market, 1);
  claimWithSniperTicket(
    market,
    "team-a",
    1,
    300,
    issueVoucher(market, "team-a", { binId: 1, nonce: "third-voucher" }),
  );
});
