import assert from "node:assert/strict";
import test from "node:test";

import {
  beginRevealPhase,
  commitAction,
  createMarket,
  inspectMarket,
  issueVoucher,
  registerParticipant,
  revealAction,
  resolveTick,
  scoreboard,
} from "../src/market.mjs";

test("commit and reveal endpoints are separated by explicit phase boundaries", () => {
  const market = createMarket("phase-boundaries");
  registerParticipant(market, "participant-a");
  const action = ticketAction(market, "participant-a", 0, 400, "phase-voucher");

  assert.equal(market.phase, "commit");
  assert.throws(() => revealAction(market, "participant-a", action, "phase-action-nonce"), /reveal phase is not open/);
  assert.throws(() => resolveTick(market), /reveal phase is not open/);
  commitAction(market, "participant-a", action, "phase-action-nonce");

  beginRevealPhase(market);
  assert.equal(market.phase, "reveal");
  assert.throws(
    () => commitAction(market, "participant-a", action, "late-commit-nonce"),
    /commit phase is not open/,
  );
  assert.throws(
    () => issueVoucher(market, "participant-a", { binId: 0, nonce: "late-voucher" }),
    /commit phase is not open/,
  );
  assert.equal(revealAction(market, "participant-a", action, "phase-action-nonce").accepted, true);

  const batch = resolveTick(market);
  assert.equal(batch.tick, 12);
  assert.equal(market.tick, 13);
  assert.equal(market.phase, "commit");
});

test("commitments and queued reveals are immutable for the whole tick", () => {
  const market = createMarket("immutable-commit");
  registerParticipant(market, "participant-a");
  const action = ticketAction(market, "participant-a", 0, 900, "immutable-voucher");
  const originalAction = structuredClone(action);

  commitAction(market, "participant-a", action, "immutable-action-nonce");
  assert.throws(
    () => commitAction(market, "participant-a", { type: "swap", toBin: 2 }, "replacement-action"),
    /already committed this tick/,
  );
  beginRevealPhase(market);
  assert.throws(
    () => revealAction(market, "participant-a", { ...action, liquidity: 1 }, "immutable-action-nonce"),
    /commitment mismatch/,
  );
  revealAction(market, "participant-a", action, "immutable-action-nonce");
  assert.throws(
    () => revealAction(market, "participant-a", action, "immutable-action-nonce"),
    /already revealed this tick/,
  );

  action.liquidity = 1;
  action.voucher.signature = "0".repeat(64);
  const batch = resolveTick(market);
  assert.equal(batch.results[0].status, "resolved");
  assert.equal(inspectMarket(market, "participant-a").participant.liquidityBalance, 2_100);
  assert.equal(originalAction.liquidity, 900);
});

test("a missed reveal closes without consuming tickets or funded liquidity", () => {
  const market = createMarket("missed-reveal");
  registerParticipant(market, "participant-a");
  const action = ticketAction(market, "participant-a", 0, 700, "missed-voucher");

  commitAction(market, "participant-a", action, "missed-action-nonce");
  beginRevealPhase(market);
  const batch = resolveTick(market);

  assert.deepEqual(batch.results, [{ tick: 12, participantId: "participant-a", status: "missed-reveal" }]);
  const view = inspectMarket(market, "participant-a");
  assert.equal(view.participant.tickets, 3);
  assert.equal(view.participant.liquidityBalance, 3_000);
  assert.equal(view.participant.escrow, 0);
  assert.equal(view.participant.lastResolution.status, "missed-reveal");
});

test("reveals settle as one deterministic batch independent of reveal arrival order", () => {
  const market = createMarket("batch-settlement");
  registerParticipant(market, "participant-b");
  registerParticipant(market, "participant-a");
  const actions = {
    "participant-a": ticketAction(market, "participant-a", 0, 600, "batch-voucher-a"),
    "participant-b": ticketAction(market, "participant-b", 3, 800, "batch-voucher-b"),
  };
  const nonces = { "participant-a": "batch-action-a", "participant-b": "batch-action-b" };

  commitAction(market, "participant-a", actions["participant-a"], nonces["participant-a"]);
  commitAction(market, "participant-b", actions["participant-b"], nonces["participant-b"]);
  beginRevealPhase(market);
  revealAction(market, "participant-b", actions["participant-b"], nonces["participant-b"]);
  revealAction(market, "participant-a", actions["participant-a"], nonces["participant-a"]);

  assert.equal(inspectMarket(market, "participant-a").participant.escrow, 0);
  assert.equal(inspectMarket(market, "participant-b").participant.escrow, 0);
  assert.ok(scoreboard(market).every((row) => row.escrow === 0));

  const batch = resolveTick(market);
  assert.deepEqual(batch.results.map((result) => result.participantId), ["participant-a", "participant-b"]);
  assert.ok(batch.results.every((result) => result.status === "resolved"));
  assert.ok(batch.results.every((result) => result.result.extracted > 0));
  assert.equal(market.tick, 13);
  assert.ok(scoreboard(market).every((row) => row.escrow > 0));
});

function ticketAction(market, participantId, binId, liquidity, voucherNonce) {
  return {
    type: "ticket",
    binId,
    liquidity,
    voucher: issueVoucher(market, participantId, { binId, nonce: voucherNonce }),
  };
}
