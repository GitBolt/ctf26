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
  registerParticipant,
  restoreMarket,
  revealAction,
  resolveTick,
  scoreboard,
  simulateBestTicket,
  snapshot,
  swap,
  verifyVoucher,
} from "../src/market.mjs";

test("sniper ticket captures stale reward that fresh liquidity should not earn", () => {
  const market = createMarket("test-sniper");
  registerParticipant(market, "participant-a");
  const best = simulateBestTicket(market, "participant-a", 900);
  const voucher = issueVoucher(market, "participant-a", { binId: best.binId, nonce: "ticket-n1" });
  const result = claimWithSniperTicket(market, "participant-a", best.binId, 900, voucher);

  assert.equal(Object.hasOwn(result, "fairReward"), false);
  assert.ok(result.extracted > 0);
  assert.equal(result.ticketsRemaining, 2);
});

test("post-settlement checkpoint would not capture backlog, proving the intended primitive", () => {
  const market = createMarket("test-checkpoint-order");
  registerParticipant(market, "participant-a");
  const best = simulateBestTicket(market, "participant-a", 900);
  const staleBin = inspectMarket(market, "participant-a").bins.find((bin) => bin.id === best.binId);

  const postSettlementCheckpointReward = 0;
  const voucher = issueVoucher(market, "participant-a", { binId: best.binId, nonce: "ticket-n1" });
  const result = claimWithSniperTicket(market, "participant-a", best.binId, 900, voucher);

  assert.ok(staleBin.staleTicks > 0);
  assert.equal(postSettlementCheckpointReward, 0);
  assert.ok(result.extracted > postSettlementCheckpointReward);
});

test("tickets are scarce and consumed even when the selected window is low value", () => {
  const market = createMarket("test-tickets");
  registerParticipant(market, "participant-a");

  for (let i = 0; i < 3; i += 1) {
    const voucher = issueVoucher(market, "participant-a", { binId: -4, nonce: `ticket-n${i}` });
    claimWithSniperTicket(market, "participant-a", -4, 1, voucher);
    advanceTick(market, 1);
  }

  const voucher = issueVoucher(market, "participant-a", { binId: -4, nonce: "ticket-n4" });
  assert.throws(() => claimWithSniperTicket(market, "participant-a", -4, 1, voucher), /no sniper tickets/);
});

test("high-value action requires voucher bound to participant, tick, and bin", () => {
  const market = createMarket("test-voucher");
  registerParticipant(market, "participant-a");
  registerParticipant(market, "participant-b");
  const voucher = issueVoucher(market, "participant-a", { binId: 0, nonce: "same-voucher" });

  assert.throws(() => claimWithSniperTicket(market, "participant-b", 0, 900, voucher), /voucher binding/);
  assert.throws(() => claimWithSniperTicket(market, "participant-a", 1, 900, voucher), /voucher binding/);
  advanceTick(market, 1);
  assert.throws(() => claimWithSniperTicket(market, "participant-a", 0, 900, voucher), /voucher binding/);
});

test("commit reveal binds the exact action that resolves", () => {
  const market = createMarket("test-commit");
  registerParticipant(market, "participant-a");
  const best = simulateBestTicket(market, "participant-a");
  const voucher = issueVoucher(market, "participant-a", { binId: best.binId, nonce: "voucher-v" });
  const action = { type: "ticket", binId: best.binId, liquidity: 900, voucher };

  commitAction(market, "participant-a", action, "commit-secret");
  assert.throws(() => commitAction(market, "participant-a", action, "second-secret"), /already committed/);
  assert.throws(() => revealAction(market, "participant-a", action, "commit-secret"), /reveal phase is not open/);
  beginRevealPhase(market);
  assert.throws(
    () => revealAction(market, "participant-a", { ...action, binId: best.binId + 1 }, "commit-secret"),
    /commitment mismatch/,
  );
  const queued = revealAction(market, "participant-a", action, "commit-secret");
  assert.equal(queued.accepted, true);
  assert.equal(inspectMarket(market, "participant-a").participant.escrow, 0);
  const batch = resolveTick(market);
  assert.ok(batch.results[0].result.extracted > 0);
});

test("a matching but invalid reveal fails only at batch settlement", () => {
  const market = createMarket("test-invalid-reveal");
  registerParticipant(market, "participant-a");
  const voucher = issueVoucher(market, "participant-a", { binId: 0, nonce: "invalid-reveal" });
  const invalidAction = { type: "ticket", binId: 0, liquidity: 0, voucher };

  commitAction(market, "participant-a", invalidAction, "invalid-commit-nonce");
  assert.throws(
    () => commitAction(market, "participant-a", { type: "swap", toBin: 1 }, "replacement-nonce"),
    /already committed this tick/,
  );
  beginRevealPhase(market);
  assert.equal(revealAction(market, "participant-a", invalidAction, "invalid-commit-nonce").accepted, true);
  const batch = resolveTick(market);
  assert.equal(batch.results[0].status, "failed");
  assert.match(batch.results[0].error, /positive integer/);
  assert.equal(inspectMarket(market, "participant-a").participant.tickets, 3);
});

test("telemetry combines noisy, partial observations without exposing an outcome label", () => {
  const market = createMarket("test-telemetry");
  registerParticipant(market, "participant-a");
  const view = inspectMarket(market, "participant-a");

  assert.equal(view.participant.telemetry.rewardSamples.length, 3);
  assert.equal(typeof view.participant.telemetry.flow.direction, "string");
  assert.ok(view.participant.telemetry.touches.length < view.bins.length);
  assert.equal(Object.hasOwn(view.bins[0], "window"), false);
});

test("scoreboard is relative share of extracted reward", () => {
  const market = createMarket("test-scoreboard");
  registerParticipant(market, "participant-a");
  registerParticipant(market, "participant-b");
  const best = simulateBestTicket(market, "participant-a");
  claimWithSniperTicket(
    market,
    "participant-a",
    best.binId,
    900,
    issueVoucher(market, "participant-a", { binId: best.binId, nonce: "scoreboard-a" }),
  );
  const rows = scoreboard(market);

  assert.equal(rows[0].participantId, "participant-a");
  assert.equal(rows[0].share, 1);
  assert.equal(rows[1].share, 0);
});

test("voucher authority is random per market and absent from serializable state", () => {
  const first = createMarket("same-seed");
  const second = createMarket("same-seed");
  registerParticipant(first, "participant-a");
  registerParticipant(second, "participant-a");

  const voucher = issueVoucher(first, "participant-a", { binId: 0, nonce: "authority-nonce" });
  assert.throws(() => verifyVoucher(second, "participant-a", 0, voucher), /bad voucher signature/);
  assert.equal(Object.hasOwn(first, "secret"), false);
  assert.equal(JSON.stringify(snapshot(first)).includes("reward-sniper-local-secret"), false);
});

test("ticket liquidity must be positive, bounded, and funded", () => {
  const market = createMarket("bounded-liquidity");
  registerParticipant(market, "participant-a");
  const voucher = issueVoucher(market, "participant-a", { binId: 0, nonce: "bounded-liquidity" });

  for (const amount of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, "900"]) {
    assert.throws(
      () => claimWithSniperTicket(market, "participant-a", 0, amount, voucher),
      /positive integer/,
    );
  }
  assert.throws(
    () => claimWithSniperTicket(market, "participant-a", 0, 1_001, voucher),
    /per-action limit/,
  );

  const result = claimWithSniperTicket(market, "participant-a", 0, 900, voucher);
  assert.ok(result.extracted > 0);
  assert.equal(inspectMarket(market, "participant-a").participant.liquidityBalance, 2_100);
  assert.equal(inspectMarket(market, "participant-a").participant.tickets, 2);

  const underfunded = createMarket("underfunded", { startingLiquidity: 500, maxActionLiquidity: 1_000 });
  registerParticipant(underfunded, "participant-a");
  const underfundedVoucher = issueVoucher(underfunded, "participant-a", { binId: 0, nonce: "underfunded-test" });
  assert.throws(
    () => claimWithSniperTicket(underfunded, "participant-a", 0, 501, underfundedVoucher),
    /insufficient funded liquidity/,
  );
});

test("vouchers are one-shot and each participant resolves at most one action per tick", () => {
  const market = createMarket("one-shot");
  registerParticipant(market, "participant-a");
  const firstVoucher = issueVoucher(market, "participant-a", { binId: 0, nonce: "first-voucher" });
  claimWithSniperTicket(market, "participant-a", 0, 300, firstVoucher);

  assert.throws(
    () => claimWithSniperTicket(market, "participant-a", 0, 300, firstVoucher),
    /voucher already used/,
  );

  const secondVoucher = issueVoucher(market, "participant-a", { binId: 1, nonce: "second-voucher" });
  assert.throws(
    () => claimWithSniperTicket(market, "participant-a", 1, 300, secondVoucher),
    /action already resolved this tick/,
  );

  advanceTick(market, 1);
  claimWithSniperTicket(
    market,
    "participant-a",
    1,
    300,
    issueVoucher(market, "participant-a", { binId: 1, nonce: "third-voucher" }),
  );
});

test("round rotation changes the market and replenishes scarce participant resources", () => {
  const market = createMarket("rotating-round", { roundTicks: 4 });
  registerParticipant(market, "participant-a");
  const initialBins = market.bins.map((bin) => ({ id: bin.id, liquidity: bin.liquidity }));
  const voucher = issueVoucher(market, "participant-a", { binId: 0, nonce: "round-one-voucher" });
  claimWithSniperTicket(market, "participant-a", 0, 800, voucher);

  assert.equal(inspectMarket(market, "participant-a").participant.tickets, 2);
  assert.ok(inspectMarket(market, "participant-a").participant.roundEscrow > 0);
  advanceTick(market, 4);

  const view = inspectMarket(market, "participant-a");
  assert.equal(view.round, 2);
  assert.equal(view.participant.tickets, 3);
  assert.equal(view.participant.liquidityBalance, 3_000);
  assert.equal(view.participant.roundEscrow, 0);
  assert.ok(view.participant.escrow > 0);
  assert.notDeepEqual(market.bins.map((bin) => ({ id: bin.id, liquidity: bin.liquidity })), initialBins);
});

test("bounded events discard practice extraction and aggregate normalized scored rounds", () => {
  const market = createMarket("bounded-event", { roundTicks: 4, practiceRounds: 1, scoredRounds: 3 });
  registerParticipant(market, "participant-a");
  registerParticipant(market, "participant-b");

  claimWithSniperTicket(market, "participant-a", 0, 500, issueVoucher(market, "participant-a", { binId: 0, nonce: "practice-a" }));
  assert.equal(inspectMarket(market, "participant-a").event.stage, "practice");
  advanceTick(market, 4);
  assert.equal(inspectMarket(market, "participant-a").participant.escrow, 0);
  assert.equal(inspectMarket(market, "participant-a").event.stage, "live");

  claimWithSniperTicket(market, "participant-a", 1, 500, issueVoucher(market, "participant-a", { binId: 1, nonce: "scored-a-1" }));
  advanceTick(market, 4);
  claimWithSniperTicket(market, "participant-b", -1, 500, issueVoucher(market, "participant-b", { binId: -1, nonce: "scored-b-2" }));
  advanceTick(market, 4);
  claimWithSniperTicket(market, "participant-a", 2, 500, issueVoucher(market, "participant-a", { binId: 2, nonce: "scored-a-3" }));
  claimWithSniperTicket(market, "participant-b", -2, 500, issueVoucher(market, "participant-b", { binId: -2, nonce: "scored-b-3" }));
  advanceTick(market, 4);

  const view = inspectMarket(market, "participant-a");
  const scores = scoreboard(market);
  assert.equal(view.event.stage, "complete");
  assert.equal(view.event.completedScoredRounds, 3);
  assert.equal(scores[0].roundShares.length, 3);
  assert.equal(scores[1].roundShares.length, 3);
  assert.equal(scores.find((row) => row.participantId === "participant-a").successfulScoredRounds, 2);
  assert.equal(scores.find((row) => row.participantId === "participant-a").qualified, true);
  assert.equal(scores.find((row) => row.participantId === "participant-b").successfulScoredRounds, 2);
  assert.equal(scores.find((row) => row.participantId === "participant-b").qualified, true);
  assert.throws(() => issueVoucher(market, "participant-a", { binId: 0, nonce: "after-complete" }), /event is complete/);
});

test("completed event ranks use finalized scores without counting the last round twice", () => {
  const market = createMarket("completed-ranking", { scoredRounds: 2 });
  registerParticipant(market, "participant-a");
  registerParticipant(market, "participant-b");
  market.event.stage = "complete";
  market.participants["participant-a"].roundScores = [
    { round: 1, reward: 4, share: 0.4 },
    { round: 2, reward: 2, share: 0.2 },
  ];
  market.participants["participant-b"].roundScores = [
    { round: 1, reward: 2, share: 0.2 },
    { round: 2, reward: 4, share: 0.4 },
  ];
  market.participants["participant-a"].roundEscrow = 2;
  market.participants["participant-b"].roundEscrow = 4;

  const rows = scoreboard(market);
  assert.deepEqual(rows.map((row) => row.participantId), ["participant-a", "participant-b"]);
  assert.deepEqual(rows.map((row) => row.rank), [1, 1]);
  assert.deepEqual(rows.map((row) => row.score), [0.6, 0.6]);
  assert.ok(rows.every((row) => row.currentRoundShare === 0));
});

test("tiny positive finalized shares remain score-bearing", () => {
  const market = createMarket("tiny-positive-share", { roundTicks: 4, scoredRounds: 2 });
  registerParticipant(market, "tiny-participant");
  registerParticipant(market, "large-participant");

  for (let round = 0; round < 2; round += 1) {
    market.participants["tiny-participant"].roundEscrow = 1;
    market.participants["large-participant"].roundEscrow = 499_999;
    advanceTick(market, 4);
  }

  const tiny = scoreboard(market).find((row) => row.participantId === "tiny-participant");
  assert.equal(tiny.qualified, true);
  assert.equal(tiny.score, 0.000004);
  assert.ok(tiny.roundShares.every((round) => round.share > 0));
});

test("rank one in an empty rehearsal does not validate a one-round-only extraction", () => {
  const market = createMarket("solo-validation", { roundTicks: 4, scoredRounds: 3 });
  registerParticipant(market, "solo-participant");

  advanceTick(market, 8);
  claimWithSniperTicket(
    market,
    "solo-participant",
    0,
    1_000,
    issueVoucher(market, "solo-participant", { binId: 0, nonce: "solo-final-round" }),
  );
  advanceTick(market, 4);

  const [solo] = scoreboard(market);
  assert.equal(solo.rank, 1);
  assert.equal(solo.successfulScoredRounds, 1);
  assert.equal(solo.requiredSuccessfulRounds, 2);
  assert.equal(solo.qualified, false);
});

test("a market swap settles the departing bin while preserving destination backlog", () => {
  const market = createMarket("pressure-swap");
  registerParticipant(market, "participant-a");
  const before = inspectMarket(market, "participant-a");
  const target = before.bins.find((bin) => bin.id === 2);
  assert.ok(target.staleTicks > 0);

  const result = swap(market, "participant-a", 2);
  const after = inspectMarket(market, "participant-a");
  assert.equal(result.activeBin, 2);
  assert.equal(result.liquidityFee, 50);
  assert.equal(after.participant.liquidityBalance, before.participant.liquidityBalance - 50);
  assert.equal(after.bins.find((bin) => bin.id === 0).staleTicks, 0);
  assert.equal(after.bins.find((bin) => bin.id === 2).staleTicks, target.staleTicks);
});
