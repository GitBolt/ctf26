import assert from "node:assert/strict";
import test from "node:test";
import {
  OFFICIAL_STRATEGY_PROGRAM,
  buildExploit,
  checkSubmission,
  createLatestFixedTarget,
  createLiveTarget,
  deriveVaultAuthority,
  executeStrategy,
} from "../src/protocol.mjs";

test("pre-fix live target forwards its trusted signer to a caller-selected strategy", () => {
  const target = createLiveTarget("team-a");
  const exploit = buildExploit({ target, attackerProgramId: "AttackerStrategy111111111111111111111111" });
  const result = executeStrategy(target, exploit);

  assert.equal(target.vaultAuthority, deriveVaultAuthority(target.vaultId));
  assert.ok(result.teamEscrow >= target.threshold);
  assert.equal(result.solved, true);
});

test("latest fixed target rejects attacker supplied strategy program", () => {
  const target = createLatestFixedTarget("team-a");
  const exploit = buildExploit({ target, attackerProgramId: "AttackerStrategy111111111111111111111111" });

  assert.throws(() => executeStrategy(target, exploit), /not pinned/);
});

test("latest fixed target still accepts the official strategy", () => {
  const target = createLatestFixedTarget("team-a");
  const exploit = {
    strategyProgramId: OFFICIAL_STRATEGY_PROGRAM,
    amount: 1,
  };

  const result = executeStrategy(target, exploit);
  assert.equal(result.teamEscrow, 1);
});

test("checker validates state transition, not a text answer", () => {
  const target = createLiveTarget("team-b");
  const exploit = buildExploit({ target, attackerProgramId: "AttackerStrategy222222222222222222222222" });
  const result = checkSubmission({ teamId: "team-b", exploit });

  assert.equal(result.ok, true);
  assert.match(result.flag, /^CTF26\{signet_[a-f0-9]{24}\}$/);
});

test("malformed strategy programs cannot reach the stale target", () => {
  const target = createLiveTarget("team-c");
  const exploit = {
    strategyProgramId: "bad",
    amount: target.threshold,
  };

  assert.throws(() => executeStrategy(target, exploit), /bad strategy program/);
});

test("production flag issuance fails closed without a strong secret", () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousSecret = process.env.FLAG_SECRET;
  process.env.NODE_ENV = "production";
  delete process.env.FLAG_SECRET;

  try {
    const target = createLiveTarget("team-prod");
    const exploit = buildExploit({
      target,
      attackerProgramId: "AttackerStrategyProduction11111111111111111",
    });
    assert.throws(
      () => checkSubmission({ teamId: "team-prod", exploit }),
      /FLAG_SECRET must contain at least 32 characters/
    );
  } finally {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
    if (previousSecret === undefined) delete process.env.FLAG_SECRET;
    else process.env.FLAG_SECRET = previousSecret;
  }
});
