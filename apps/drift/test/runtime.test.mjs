import assert from "node:assert/strict";
import test from "node:test";
import {
  ATTACKER_STARTING_BALANCE,
  MAX_TRACE_STEPS,
  accrue,
  createLocalnet,
  deposit,
  referenceRewindExploit,
  runExploit,
  setClock,
  withdraw,
} from "../src/runtime.mjs";

test("normal forward time accrues modest backed balance", () => {
  const net = createLocalnet("participant-a");
  deposit(net, 10n);
  assert.equal(net.attacker.tokenBalance, ATTACKER_STARTING_BALANCE - 10n);
  setClock(net, net.clock + 10n);
  const { interest } = accrue(net);
  withdraw(net, 10n + interest);

  assert.ok(interest > 0n);
  assert.ok(net.attacker.tokenBalance - net.initialAttackerBalance < net.threshold);
});

test("deposit requires funded attacker tokens and does not mint vault liquidity", () => {
  const net = createLocalnet("participant-funded-deposit");
  const reserveBefore = net.vault.reserve;

  assert.throws(
    () => deposit(net, ATTACKER_STARTING_BALANCE + 1n),
    /attacker balance too low/,
  );
  assert.equal(net.attacker.tokenBalance, ATTACKER_STARTING_BALANCE);
  assert.equal(net.vault.reserve, reserveBefore);
  assert.equal(net.position.balance, 0n);
});

test("deposit then withdraw is a conserved round trip, not a solve", () => {
  const net = createLocalnet("participant-round-trip");
  const result = runExploit(net, [
    { op: "deposit", amount: "100" },
    { op: "withdraw", amount: "100" },
  ]);

  assert.equal(result.grossDeposited, 100n);
  assert.equal(result.grossWithdrawn, 100n);
  assert.equal(result.reserveDrain, 0n);
  assert.equal(result.attackerProfit, 0n);
  assert.equal(result.netWithdrawn, 0n);
  assert.equal(result.accountingConsistent, true);
  assert.equal(result.solved, false);
  assert.equal(result.reserve, result.initialReserve);
  assert.equal(result.attackerBalance, ATTACKER_STARTING_BALANCE);
});

test("the original self-funding bypass is rejected before replay can score it", () => {
  const net = createLocalnet("participant-old-bypass");
  const amount = net.initialVaultReserve.toString();

  assert.throws(
    () =>
      runExploit(createLocalnet("participant-old-bypass"), [
          { op: "deposit", amount },
          { op: "withdraw", amount },
      ]),
    /attacker balance too low/,
  );
});

test("recycling funded liquidity cannot turn gross volume into a solve", () => {
  const net = createLocalnet("participant-recycled-volume");
  const steps = Array.from({ length: 8 }, () => [
    { op: "deposit", amount: "500" },
    { op: "withdraw", amount: "500" },
  ]).flat();
  const result = runExploit(net, steps);

  assert.equal(result.grossDeposited, 4_000n);
  assert.equal(result.grossWithdrawn, 4_000n);
  assert.equal(result.netWithdrawn, 0n);
  assert.equal(result.reserveDrain, 0n);
  assert.equal(result.attackerProfit, 0n);
  assert.equal(result.solved, false);
});

test("rewinding time after a high timestamp creates a u64 underflow", () => {
  const net = createLocalnet("participant-b");
  deposit(net, 10n);
  setClock(net, net.clock + 1_000_000n);
  accrue(net);
  setClock(net, net.clock - 1n);
  const { elapsed } = accrue(net);

  assert.ok(elapsed > 2n ** 63n);
});

test("reference exploit drains the reserve past threshold", () => {
  const net = createLocalnet("participant-c");
  const steps = referenceRewindExploit(net);
  const result = runExploit(net, steps);

  assert.equal(result.solved, true);
  assert.ok(result.reserveDrain >= net.threshold);
  assert.ok(result.attackerProfit >= net.threshold);
  assert.ok(result.netWithdrawn >= net.threshold);
  assert.equal(result.reserveDrain, result.attackerProfit);
  assert.equal(result.netWithdrawn, result.attackerProfit);
  assert.equal(result.accountingConsistent, true);
});

test("a forward clock exploit still drains the original reserve", () => {
  const net = createLocalnet("participant-forward-clock");
  const initialReserve = net.initialVaultReserve;
  const result = runExploit(net, [
    { op: "deposit", amount: "10" },
    { op: "set_clock", unixTimestamp: (net.clock + 1_000_000n).toString() },
    { op: "accrue" },
    { op: "withdraw", amount: initialReserve.toString() },
  ]);

  assert.equal(result.solved, true);
  assert.ok(result.reserveDrain >= result.threshold);
  assert.equal(result.attackerProfit, result.reserveDrain);
  assert.equal(result.netWithdrawn, result.reserveDrain);
});

test("model refuses arbitrary localnet state mutation operations", () => {
  assert.throws(
    () =>
      runExploit(createLocalnet("participant-e"), [
        { op: "set_account", account: "position", balance: "999999999" },
      ]),
    /unknown op set_account/,
  );
});

test("model enforces bounded, canonical traces", () => {
  assert.throws(
    () =>
      runExploit(
        createLocalnet("participant-too-many"),
        Array.from({ length: MAX_TRACE_STEPS + 1 }, () => ({ op: "accrue" })),
      ),
    /trace exceeds 32 steps/,
  );

  assert.throws(
    () => runExploit(createLocalnet("participant-number"), [{ op: "deposit", amount: 10 }]),
    /must be a decimal string/,
  );
  assert.throws(
    () => runExploit(createLocalnet("participant-leading-zero"), [{ op: "deposit", amount: "010" }]),
    /canonical decimal string/,
  );
  assert.throws(
    () =>
      runExploit(createLocalnet("participant-extra-field"), [
        { op: "accrue", positionBalance: "18446744073709551615" },
      ]),
    /unexpected fields/,
  );
  assert.throws(
    () =>
      runExploit(createLocalnet("participant-clock-range"), [
        { op: "set_clock", unixTimestamp: "9223372036854775808" },
      ]),
    /out of range/,
  );
});

test("model rejects malformed participant identifiers", () => {
  assert.throws(
    () => createLocalnet("participant:other"),
    /invalid participantId/,
  );
});
