import crypto from "node:crypto";

export const DEFAULT_STARTING_LIQUIDITY = 3_000;
export const MAX_ACTION_LIQUIDITY = 1_000;

// Voucher authority is deliberately kept outside the serializable market object. The browser and
// snapshots may observe market state, but they must never receive the key that authorizes actions.
const voucherAuthorities = new WeakMap();

function hash(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function hmac(secret, value) {
  return crypto.createHmac("sha256", secret).update(value).digest("hex");
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function createMarket(seed = "round-001", options = {}) {
  const startingLiquidity = options.startingLiquidity ?? DEFAULT_STARTING_LIQUIDITY;
  const maxActionLiquidity = options.maxActionLiquidity ?? MAX_ACTION_LIQUIDITY;
  assertPositiveSafeInteger(startingLiquidity, "starting liquidity");
  assertPositiveSafeInteger(maxActionLiquidity, "maximum action liquidity");

  const voucherSecret = options.voucherSecret ?? crypto.randomBytes(32);
  if (!isUsableSecret(voucherSecret)) {
    throw new Error("voucher secret must contain at least 32 bytes");
  }

  const bins = [];
  for (let id = -4; id <= 4; id += 1) {
    const liquidity = 120 + Math.abs(id) * 17 + (Math.abs(hash(`${seed}:${id}`).charCodeAt(0)) % 41);
    bins.push({
      id,
      liquidity,
      lastTouchedTick: Math.abs(id) % 3,
      rewardPerLiquidity: 0,
      heat: 0,
    });
  }

  const market = {
    seed,
    tick: 12,
    phase: "commit",
    activeBin: 0,
    rewardRate: 97,
    startingLiquidity,
    maxActionLiquidity,
    bins,
    teams: {},
    usedVouchers: {},
    lastBatch: null,
    eventLog: [],
  };
  voucherAuthorities.set(market, voucherSecret);
  return market;
}

export function registerTeam(market, teamId, telemetryKind = "delayed-bin-touch") {
  if (typeof teamId !== "string" || !/^[a-zA-Z0-9_-]{3,40}$/.test(teamId)) {
    throw new Error("invalid team id");
  }
  if (market.teams[teamId]) throw new Error("team already registered");
  market.teams[teamId] = {
    id: teamId,
    escrow: 0,
    liquidityBalance: market.startingLiquidity,
    tickets: 3,
    commits: {},
    reveals: {},
    resolvedTicks: {},
    telemetryKind,
    actions: [],
    lastResolution: null,
  };
  return market.teams[teamId];
}

export function inspectMarket(market, teamId) {
  const team = market.teams[teamId];
  if (!team) throw new Error("unknown team");

  return {
    tick: market.tick,
    phase: market.phase,
    activeBin: market.activeBin,
    rewardVault: rewardVaultEstimate(market),
    bins: market.bins.map((bin) => ({
      id: bin.id,
      liquidity: bin.liquidity,
      staleTicks: Math.max(0, market.tick - bin.lastTouchedTick),
      heat: bin.heat,
      isActive: bin.id === market.activeBin,
    })),
    team: {
      escrow: team.escrow,
      liquidityBalance: team.liquidityBalance,
      tickets: team.tickets,
      hasCommitted: Boolean(team.commits[market.tick]),
      hasRevealed: Boolean(team.reveals[market.tick]),
      lastResolution: team.lastResolution ? clone(team.lastResolution) : null,
      telemetry: telemetryCard(market, team),
    },
  };
}

export function commitAction(market, teamId, action, nonce) {
  const team = market.teams[teamId];
  if (!team) throw new Error("unknown team");
  assertPhase(market, "commit");
  assertCommitNonce(nonce);
  assertCanResolve(market, team);
  if (team.commits[market.tick]) throw new Error("already committed this tick");
  const commitment = hash(`${stableStringify(action)}:${nonce}`);
  team.commits[market.tick] = commitment;
  market.eventLog.push({ tick: market.tick, teamId, type: "commit", commitment });
  return commitment;
}

export function revealAction(market, teamId, action, nonce) {
  const team = market.teams[teamId];
  if (!team) throw new Error("unknown team");
  assertPhase(market, "reveal");
  assertCommitNonce(nonce);
  assertCanResolve(market, team);
  if (team.reveals[market.tick]) throw new Error("already revealed this tick");
  const expected = team.commits[market.tick];
  if (!expected) throw new Error("no commit for current tick");
  const actual = hash(`${stableStringify(action)}:${nonce}`);
  if (actual !== expected) throw new Error("commitment mismatch");

  if (action.type !== "swap" && action.type !== "ticket") throw new Error("unsupported reveal action");

  team.reveals[market.tick] = clone(action);
  market.eventLog.push({ tick: market.tick, teamId, type: "reveal-accepted" });
  return { accepted: true, tick: market.tick };
}

export function beginRevealPhase(market) {
  assertPhase(market, "commit");
  market.phase = "reveal";
  market.eventLog.push({ tick: market.tick, type: "phase", phase: "reveal" });
  return { tick: market.tick, phase: market.phase };
}

export function resolveTick(market) {
  assertPhase(market, "reveal");
  const resolvingTick = market.tick;
  const results = [];
  const teams = Object.values(market.teams)
    .filter((team) => team.commits[resolvingTick])
    .sort((first, second) => first.id.localeCompare(second.id));

  // Reveals never mutate market state. Once the reveal boundary closes, settle the immutable queue in
  // a stable order so network timing during the reveal phase cannot change execution order.
  for (const team of teams) {
    const action = team.reveals[resolvingTick];
    let resolution;
    if (!action) {
      resolution = { tick: resolvingTick, teamId: team.id, status: "missed-reveal" };
    } else {
      try {
        const result = applyResolvedAction(market, team.id, action);
        resolution = {
          tick: resolvingTick,
          teamId: team.id,
          status: "resolved",
          actionType: action.type,
          result,
        };
      } catch (error) {
        resolution = {
          tick: resolvingTick,
          teamId: team.id,
          status: "failed",
          actionType: action.type,
          error: error.message,
        };
      }
    }
    team.lastResolution = clone(resolution);
    results.push(resolution);
    market.eventLog.push({ ...resolution, type: "resolution" });
  }

  const batch = { tick: resolvingTick, results: clone(results) };
  market.lastBatch = batch;
  advanceTick(market, 1);
  market.phase = "commit";
  market.eventLog.push({ tick: market.tick, type: "phase", phase: "commit" });
  return clone(batch);
}

export function issueVoucher(market, teamId, { binId, nonce }) {
  if (!market.teams[teamId]) throw new Error("unknown team");
  assertPhase(market, "commit");
  getBin(market, binId);
  assertVoucherNonce(nonce);
  const payload = { teamId, tick: market.tick, binId, nonce };
  return {
    ...payload,
    signature: hmac(getVoucherAuthority(market), stableStringify(payload)),
  };
}

export function verifyVoucher(market, teamId, binId, voucher) {
  if (!voucher || voucher.teamId !== teamId || voucher.tick !== market.tick || voucher.binId !== binId) {
    throw new Error("voucher binding mismatch");
  }
  const payload = {
    teamId: voucher.teamId,
    tick: voucher.tick,
    binId: voucher.binId,
    nonce: voucher.nonce,
  };
  assertVoucherNonce(voucher.nonce);
  const expected = hmac(getVoucherAuthority(market), stableStringify(payload));
  if (!safeEqualHex(voucher.signature, expected)) throw new Error("bad voucher signature");
  if (market.usedVouchers[voucher.signature]) throw new Error("voucher already used");
  return voucher.signature;
}

export function claimWithSniperTicket(market, teamId, binId, addedLiquidity, voucher) {
  const team = market.teams[teamId];
  if (!team) throw new Error("unknown team");
  const bin = getBin(market, binId);
  const voucherId = verifyVoucher(market, teamId, binId, voucher);
  assertCanResolve(market, team);
  if (team.tickets <= 0) throw new Error("no sniper tickets remaining");
  assertPositiveSafeInteger(addedLiquidity, "added liquidity");
  if (addedLiquidity > market.maxActionLiquidity) {
    throw new Error(`added liquidity exceeds per-action limit of ${market.maxActionLiquidity}`);
  }
  if (addedLiquidity > team.liquidityBalance) throw new Error("insufficient funded liquidity");

  const elapsed = Math.max(0, market.tick - bin.lastTouchedTick);
  const oldLiquidity = bin.liquidity;

  // All checks above are side-effect free. Consume the one-shot authorities only once the action is
  // known to be valid, so malformed attempts cannot burn a team's scarce ticket or funding.
  market.usedVouchers[voucherId] = { teamId, tick: market.tick };
  markResolved(market, team, "ticket");
  team.tickets -= 1;
  team.liquidityBalance -= addedLiquidity;

  // Challenge bug: the fresh liquidity enters the denominator/position before the stale reward window
  // is settled, so it captures rewards for time where it was not actually active.
  bin.liquidity += addedLiquidity;
  const rewardWindow = elapsed * market.rewardRate * activeMultiplier(market, bin);
  const extracted = Math.floor((rewardWindow * addedLiquidity) / Math.max(1, bin.liquidity));
  const fairReward = 0;

  bin.lastTouchedTick = market.tick;
  bin.rewardPerLiquidity += rewardWindow / Math.max(1, bin.liquidity);
  bin.heat = Math.min(100, Math.round(extracted / 12));
  team.escrow += extracted;
  team.actions.push({ tick: market.tick, binId, addedLiquidity, extracted, fairReward });
  market.eventLog.push({
    tick: market.tick,
    teamId,
    type: "sniper",
    binId,
    oldLiquidity,
    addedLiquidity,
    extracted,
  });
  return { extracted, fairReward, ticketsRemaining: team.tickets };
}

export function swap(market, teamId, toBin) {
  const team = market.teams[teamId];
  if (!team) throw new Error("unknown team");
  const bin = getBin(market, toBin);
  assertCanResolve(market, team);
  markResolved(market, team, "swap");
  market.activeBin = toBin;
  bin.heat = Math.max(bin.heat, 8);
  market.eventLog.push({ tick: market.tick, teamId, type: "swap", toBin });
  return { activeBin: market.activeBin };
}

export function advanceTick(market, ticks = 1) {
  assertPositiveSafeInteger(ticks, "tick advance");
  market.tick += ticks;
  for (const bin of market.bins) {
    bin.heat = Math.max(0, bin.heat - ticks * 3);
  }
  for (const team of Object.values(market.teams)) {
    for (const committedTick of Object.keys(team.commits)) {
      if (Number(committedTick) < market.tick) delete team.commits[committedTick];
    }
    for (const revealedTick of Object.keys(team.reveals)) {
      if (Number(revealedTick) < market.tick) delete team.reveals[revealedTick];
    }
    for (const resolvedTick of Object.keys(team.resolvedTicks)) {
      if (Number(resolvedTick) < market.tick) delete team.resolvedTicks[resolvedTick];
    }
  }
}

function applyResolvedAction(market, teamId, action) {
  if (action.type === "swap") return swap(market, teamId, action.toBin);
  if (action.type === "ticket") {
    return claimWithSniperTicket(market, teamId, action.binId, action.liquidity, action.voucher);
  }
  throw new Error("unsupported reveal action");
}

export function scoreboard(market) {
  const rows = Object.values(market.teams)
    .map((team) => ({ teamId: team.id, escrow: team.escrow, tickets: team.tickets }))
    .sort((a, b) => b.escrow - a.escrow);
  const total = rows.reduce((sum, row) => sum + row.escrow, 0);
  return rows.map((row) => ({
    ...row,
    share: total === 0 ? 0 : Number((row.escrow / total).toFixed(4)),
  }));
}

export function simulateBestTicket(market, teamId, liquidity = 900) {
  const view = inspectMarket(market, teamId);
  const scored = view.bins.map((bin) => {
    const rewardWindow = bin.staleTicks * market.rewardRate * activeMultiplier(market, bin);
    return {
      binId: bin.id,
      expected: Math.floor((rewardWindow * liquidity) / (bin.liquidity + liquidity)),
      staleTicks: bin.staleTicks,
    };
  });
  return scored.sort((a, b) => b.expected - a.expected)[0];
}

function telemetryCard(market, team) {
  if (team.telemetryKind === "noisy-reward-rate") {
    return {
      kind: "noisy-reward-rate",
      values: [market.rewardRate - 9, market.rewardRate + 4, market.rewardRate - 2],
      note: "noisy three-sample reward stream; useful for sizing stale windows, not exact accounting",
    };
  }
  if (team.telemetryKind === "partial-swap-pressure") {
    return {
      kind: "partial-swap-pressure",
      bins: market.bins.filter((bin) => Math.abs(bin.id - market.activeBin) <= 2).map((bin) => bin.id),
      note: "local pressure near the active bin only; untouched far bins may still matter",
    };
  }
  return {
    kind: "delayed-bin-touch",
    touches: market.bins
      .filter((bin) => (bin.id + market.tick) % 2 === 0)
      .map((bin) => ({ binId: bin.id, lastTouchedTick: Math.max(0, bin.lastTouchedTick - 1) })),
    note: "delayed and partial touch log; infer stale windows, do not trust as perfect state",
  };
}

function activeMultiplier(market, bin) {
  return bin.id === market.activeBin ? 3 : 1;
}

function getBin(market, binId) {
  if (!Number.isSafeInteger(binId)) throw new Error("bin id must be an integer");
  const bin = market.bins.find((candidate) => candidate.id === binId);
  if (!bin) throw new Error("unknown bin");
  return bin;
}

function rewardVaultEstimate(market) {
  return 500_000 - Object.values(market.teams).reduce((sum, team) => sum + team.escrow, 0);
}

function assertPositiveSafeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
}

function assertCommitNonce(nonce) {
  if (typeof nonce !== "string" || nonce.length < 8 || nonce.length > 256) {
    throw new Error("commit nonce must be a string between 8 and 256 characters");
  }
}

function assertVoucherNonce(nonce) {
  if (typeof nonce !== "string" || nonce.length < 8 || nonce.length > 128) {
    throw new Error("voucher nonce must be a string between 8 and 128 characters");
  }
}

function assertCanResolve(market, team) {
  if (team.resolvedTicks[market.tick]) throw new Error("action already resolved this tick");
}

function assertPhase(market, expected) {
  if (market.phase !== expected) throw new Error(`${expected} phase is not open`);
}

function markResolved(market, team, actionType) {
  team.resolvedTicks[market.tick] = actionType;
}

function getVoucherAuthority(market) {
  const secret = voucherAuthorities.get(market);
  if (!secret) throw new Error("market has no voucher authority");
  return secret;
}

function isUsableSecret(secret) {
  if (typeof secret === "string") return Buffer.byteLength(secret) >= 32;
  return ArrayBuffer.isView(secret) && secret.byteLength >= 32;
}

function safeEqualHex(actual, expected) {
  if (typeof actual !== "string" || !/^[0-9a-f]{64}$/i.test(actual)) return false;
  const actualBytes = Buffer.from(actual, "hex");
  const expectedBytes = Buffer.from(expected, "hex");
  return actualBytes.length === expectedBytes.length && crypto.timingSafeEqual(actualBytes, expectedBytes);
}

function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
    .join(",")}}`;
}

export function snapshot(market) {
  return clone(market);
}
