import crypto from "node:crypto";

const U64 = 1n << 64n;
const U64_MAX = U64 - 1n;
const I64_MIN = -(1n << 63n);
const I64_MAX = (1n << 63n) - 1n;

export const MAX_TRACE_STEPS = 32;
export const ATTACKER_STARTING_BALANCE = 1_000n;

export function createLocalnet(teamId = "team-local") {
  assertTeamId(teamId);
  const seed = crypto.createHash("sha256").update(teamId).digest();
  const rate = BigInt(3 + (seed[0] % 5));
  const reserve = BigInt(40_000 + seed[1] * 100);
  return {
    teamId,
    clock: 1_700_000_000n,
    rate,
    threshold: reserve - 1_000n,
    initialVaultReserve: reserve,
    initialAttackerBalance: ATTACKER_STARTING_BALANCE,
    vault: {
      reserve,
    },
    position: {
      principal: 0n,
      balance: 0n,
      lastTs: 0n,
    },
    attacker: {
      tokenBalance: ATTACKER_STARTING_BALANCE,
    },
    accounting: {
      deposited: 0n,
      withdrawn: 0n,
    },
    trace: [],
  };
}

export function setClock(net, unixTimestamp) {
  unixTimestamp = parseRuntimeInteger(unixTimestamp, "unixTimestamp", {
    minimum: I64_MIN,
    maximum: I64_MAX,
  });
  net.clock = unixTimestamp;
  net.trace.push({ op: "set_clock", unixTimestamp: net.clock.toString() });
}

export function deposit(net, amount) {
  amount = parseRuntimeInteger(amount, "deposit amount", { minimum: 1n, maximum: U64_MAX });
  if (amount > net.attacker.tokenBalance) throw new Error("attacker balance too low");
  assertU64Addition(net.position.principal, amount, "position principal");
  assertU64Addition(net.position.balance, amount, "position balance");
  assertU64Addition(net.vault.reserve, amount, "vault reserve");

  net.attacker.tokenBalance -= amount;
  net.position.principal += amount;
  net.position.balance += amount;
  net.position.lastTs = net.clock;
  net.vault.reserve += amount;
  net.accounting.deposited += amount;
  net.trace.push({ op: "deposit", amount: amount.toString(), clock: net.clock.toString() });
}

export function accrue(net) {
  const elapsed = wrapU64(net.clock - net.position.lastTs);
  const interest = wrapU64(wrapU64(net.position.principal * net.rate) * elapsed);
  net.position.balance = wrapU64(net.position.balance + interest);
  net.position.lastTs = net.clock;
  net.trace.push({
    op: "accrue",
    elapsed: elapsed.toString(),
    interest: interest.toString(),
    clock: net.clock.toString(),
  });
  return { elapsed, interest };
}

export function withdraw(net, amount) {
  amount = parseRuntimeInteger(amount, "withdraw amount", { minimum: 1n, maximum: U64_MAX });
  if (amount > net.position.balance) throw new Error("position balance too low");
  if (amount > net.vault.reserve) throw new Error("vault reserve too low");
  assertU64Addition(net.attacker.tokenBalance, amount, "attacker balance");

  net.position.balance = wrapU64(net.position.balance - amount);
  net.vault.reserve -= amount;
  net.attacker.tokenBalance += amount;
  net.accounting.withdrawn += amount;
  net.trace.push({ op: "withdraw", amount: amount.toString() });
  return amount;
}

export function runExploit(net, steps) {
  const normalizedSteps = validateTrace(steps);
  for (const step of normalizedSteps) {
    if (step.op === "set_clock") setClock(net, step.unixTimestamp);
    else if (step.op === "deposit") deposit(net, step.amount);
    else if (step.op === "accrue") accrue(net);
    else if (step.op === "withdraw") withdraw(net, step.amount);
  }

  const reserveDrain = net.initialVaultReserve > net.vault.reserve
    ? net.initialVaultReserve - net.vault.reserve
    : 0n;
  const attackerProfit = net.attacker.tokenBalance - net.initialAttackerBalance;
  const netWithdrawn = net.accounting.withdrawn - net.accounting.deposited;
  const conservedValue = net.vault.reserve + net.attacker.tokenBalance;
  const initialValue = net.initialVaultReserve + net.initialAttackerBalance;
  const accountingConsistent =
    conservedValue === initialValue &&
    netWithdrawn === attackerProfit &&
    attackerProfit === reserveDrain;

  return {
    // `drained` deliberately means net drain of the canonical reserve, not gross withdrawals.
    drained: reserveDrain,
    reserveDrain,
    attackerProfit,
    netWithdrawn,
    grossDeposited: net.accounting.deposited,
    grossWithdrawn: net.accounting.withdrawn,
    attackerBalance: net.attacker.tokenBalance,
    initialReserve: net.initialVaultReserve,
    reserve: net.vault.reserve,
    threshold: net.threshold,
    accountingConsistent,
    solved:
      accountingConsistent &&
      reserveDrain >= net.threshold &&
      attackerProfit >= net.threshold &&
      netWithdrawn >= net.threshold,
    trace: net.trace,
  };
}

export function referenceRewindExploit(net) {
  const high = net.clock + 1_000_000n;
  return [
    { op: "set_clock", unixTimestamp: high.toString() },
    { op: "deposit", amount: "10" },
    { op: "set_clock", unixTimestamp: (high - 1n).toString() },
    { op: "accrue" },
    { op: "withdraw", amount: net.vault.reserve.toString() },
  ];
}

export function wrapU64(value) {
  return ((BigInt(value) % U64) + U64) % U64;
}

export function validateTrace(steps) {
  if (!Array.isArray(steps)) throw new Error("steps must be an array");
  if (steps.length === 0) throw new Error("steps must not be empty");
  if (steps.length > MAX_TRACE_STEPS) {
    throw new Error(`trace exceeds ${MAX_TRACE_STEPS} steps`);
  }

  return steps.map((step, index) => {
    if (step === null || typeof step !== "object" || Array.isArray(step)) {
      throw new Error(`step ${index} must be an object`);
    }
    if (typeof step.op !== "string") throw new Error(`step ${index} has no valid op`);

    if (step.op === "accrue") {
      assertExactKeys(step, ["op"], index);
      return { op: "accrue" };
    }
    if (step.op === "deposit" || step.op === "withdraw") {
      assertExactKeys(step, ["amount", "op"], index);
      return {
        op: step.op,
        amount: parseCanonicalInteger(step.amount, `step ${index} amount`, {
          minimum: 1n,
          maximum: U64_MAX,
        }),
      };
    }
    if (step.op === "set_clock") {
      assertExactKeys(step, ["op", "unixTimestamp"], index);
      return {
        op: "set_clock",
        unixTimestamp: parseCanonicalInteger(
          step.unixTimestamp,
          `step ${index} unixTimestamp`,
          { minimum: I64_MIN, maximum: I64_MAX, signed: true },
        ),
      };
    }

    throw new Error(`unknown op ${step.op}`);
  });
}

function parseCanonicalInteger(value, label, { minimum, maximum, signed = false }) {
  if (typeof value !== "string") throw new Error(`${label} must be a decimal string`);
  const pattern = signed ? /^(?:0|-?[1-9][0-9]*)$/ : /^(?:0|[1-9][0-9]*)$/;
  if (!pattern.test(value) || value.length > 20) {
    throw new Error(`${label} must be a canonical decimal string`);
  }
  return assertIntegerRange(BigInt(value), label, minimum, maximum);
}

function parseRuntimeInteger(value, label, { minimum, maximum }) {
  if (typeof value !== "bigint" && typeof value !== "string") {
    throw new Error(`${label} must be a bigint or decimal string`);
  }
  let parsed;
  try {
    parsed = BigInt(value);
  } catch {
    throw new Error(`${label} must be an integer`);
  }
  return assertIntegerRange(parsed, label, minimum, maximum);
}

function assertIntegerRange(value, label, minimum, maximum) {
  if (value < minimum || value > maximum) throw new Error(`${label} is out of range`);
  return value;
}

function assertExactKeys(value, expected, index) {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, keyIndex) => key !== wanted[keyIndex])) {
    throw new Error(`step ${index} contains unexpected fields`);
  }
}

function assertU64Addition(left, right, label) {
  if (left < 0n || right < 0n || left > U64_MAX - right) {
    throw new Error(`${label} overflow`);
  }
}

function assertTeamId(teamId) {
  if (typeof teamId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(teamId)) {
    throw new Error("invalid teamId");
  }
}
