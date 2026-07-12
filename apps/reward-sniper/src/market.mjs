import crypto from "node:crypto";

export const DEFAULT_STARTING_LIQUIDITY = 3_000;
export const MAX_ACTION_LIQUIDITY = 1_000;
export const DEFAULT_ROUND_TICKS = 12;
export const TICKETS_PER_ROUND = 3;
export const MIN_QUALIFYING_SCORED_ROUNDS = 2;

const INITIAL_TICK = 12;
const EVENT_LOG_LIMIT = 1_000;

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
  const roundTicks = options.roundTicks ?? DEFAULT_ROUND_TICKS;
  const practiceRounds = options.practiceRounds ?? 0;
  const scoredRounds = options.scoredRounds ?? 0;
  assertPositiveSafeInteger(startingLiquidity, "starting liquidity");
  assertPositiveSafeInteger(maxActionLiquidity, "maximum action liquidity");
  assertPositiveSafeInteger(roundTicks, "round ticks");
  if (roundTicks < 4) throw new Error("round ticks must be at least 4");
  if (!Number.isSafeInteger(practiceRounds) || practiceRounds < 0) throw new Error("practice rounds must be a non-negative integer");
  if (!Number.isSafeInteger(scoredRounds) || scoredRounds < 0) throw new Error("scored rounds must be a non-negative integer");

  const voucherSecret = options.voucherSecret ?? crypto.randomBytes(32);
  if (!isUsableSecret(voucherSecret)) {
    throw new Error("voucher secret must contain at least 32 bytes");
  }

  const market = {
    eventId: options.eventId ?? crypto.randomUUID(),
    seed,
    tick: INITIAL_TICK,
    phase: "commit",
    activeBin: 0,
    rewardRate: 97,
    round: 1,
    roundTicks,
    roundStartedAtTick: INITIAL_TICK,
    roundEndsAtTick: INITIAL_TICK + roundTicks,
    startingLiquidity,
    maxActionLiquidity,
    bins: createBins(seed, 1, INITIAL_TICK),
    teams: {},
    usedVouchers: {},
    lastBatch: null,
    lastPulse: null,
    eventLog: [],
    event: scoredRounds > 0 ? {
      stage: practiceRounds > 0 ? "practice" : "live",
      practiceRounds,
      scoredRounds,
      completedScoredRounds: 0,
    } : null,
  };
  voucherAuthorities.set(market, voucherSecret);
  return market;
}

export function registerTeam(market, teamId) {
  if (typeof teamId !== "string" || !/^[a-zA-Z0-9_-]{3,40}$/.test(teamId)) {
    throw new Error("invalid team id");
  }
  if (market.teams[teamId]) throw new Error("team already registered");
  market.teams[teamId] = {
    id: teamId,
    escrow: 0,
    roundEscrow: 0,
    liquidityBalance: market.startingLiquidity,
    tickets: TICKETS_PER_ROUND,
    commits: {},
    reveals: {},
    resolvedTicks: {},
    actions: [],
    lastResolution: null,
    roundScores: [],
  };
  return market.teams[teamId];
}

export function inspectMarket(market, teamId) {
  const team = market.teams[teamId];
  if (!team) throw new Error("unknown team");

  return {
    eventId: market.eventId,
    tick: market.tick,
    round: market.round,
    roundEndsAtTick: market.roundEndsAtTick,
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
      roundEscrow: team.roundEscrow,
      liquidityBalance: team.liquidityBalance,
      tickets: team.tickets,
      hasCommitted: Boolean(team.commits[market.tick]),
      hasRevealed: Boolean(team.reveals[market.tick]),
      lastResolution: team.lastResolution ? clone(team.lastResolution) : null,
      telemetry: telemetryCard(market),
    },
    recentActivity: publicActivity(market),
    event: market.event ? clone({
      ...market.event,
      scoredRound: market.event.stage === "live" ? market.round - market.event.practiceRounds : 0,
    }) : null,
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
  appendEvent(market, { tick: market.tick, teamId, type: "commit", commitment });
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
  appendEvent(market, { tick: market.tick, teamId, type: "reveal-accepted" });
  return { accepted: true, tick: market.tick };
}

export function beginRevealPhase(market) {
  assertPhase(market, "commit");
  market.phase = "reveal";
  appendEvent(market, { tick: market.tick, type: "phase", phase: "reveal" });
  return { tick: market.tick, phase: market.phase };
}

export function resolveTick(market) {
  assertPhase(market, "reveal");
  const resolvingTick = market.tick;
  const results = [];
  const teams = Object.values(market.teams)
    .filter((team) => team.commits[resolvingTick])
    .sort((first, second) => actionOrderKey(market, resolvingTick, first.id)
      .localeCompare(actionOrderKey(market, resolvingTick, second.id)));

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
    appendEvent(market, { ...resolution, type: "resolution" });
  }

  const batch = { tick: resolvingTick, results: clone(results) };
  market.lastBatch = batch;
  advanceTick(market, 1);
  market.phase = "commit";
  appendEvent(market, { tick: market.tick, type: "phase", phase: "commit" });
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
  const extracted = Math.min(
    Math.max(0, rewardVaultEstimate(market)),
    Math.floor((rewardWindow * addedLiquidity) / Math.max(1, bin.liquidity)),
  );
  bin.lastTouchedTick = market.tick;
  bin.rewardPerLiquidity += rewardWindow / Math.max(1, bin.liquidity);
  bin.heat = Math.min(100, Math.round(extracted / 12));
  team.escrow += extracted;
  team.roundEscrow += extracted;
  team.actions.push({ tick: market.tick, binId, addedLiquidity, extracted });
  if (team.actions.length > 1_000) team.actions.splice(0, team.actions.length - 1_000);
  appendEvent(market, {
    tick: market.tick,
    teamId,
    type: "sniper",
    binId,
    oldLiquidity,
    addedLiquidity,
    extracted,
  });
  return { extracted, ticketsRemaining: team.tickets };
}

export function swap(market, teamId, toBin) {
  const team = market.teams[teamId];
  if (!team) throw new Error("unknown team");
  const bin = getBin(market, toBin);
  const previous = getBin(market, market.activeBin);
  assertCanResolve(market, team);
  markResolved(market, team, "swap");
  // Leaving a bin settles its public market-maker flow. The destination becomes active without
  // erasing its existing backlog, which is what makes a well-timed pressure move strategically useful.
  previous.lastTouchedTick = market.tick;
  previous.heat = Math.max(previous.heat, 12);
  market.activeBin = toBin;
  bin.heat = Math.max(bin.heat, 8);
  appendEvent(market, { tick: market.tick, teamId, type: "swap", fromBin: previous.id, toBin });
  return { activeBin: market.activeBin };
}

export function advanceTick(market, ticks = 1) {
  assertPositiveSafeInteger(ticks, "tick advance");
  for (let step = 0; step < ticks; step += 1) {
    market.tick += 1;
    for (const bin of market.bins) bin.heat = Math.max(0, bin.heat - 3);
    for (const team of Object.values(market.teams)) pruneTeamTickState(team, market.tick);
    for (const [voucherId, use] of Object.entries(market.usedVouchers)) {
      if (use.tick < market.tick) delete market.usedVouchers[voucherId];
    }

    if (market.tick >= market.roundEndsAtTick) startNextRound(market);
    else applyMarketPulse(market);
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
  const currentTotal = Object.values(market.teams).reduce((sum, team) => sum + team.roundEscrow, 0);
  const rows = Object.values(market.teams)
    .map((team) => {
      const roundShares = clone(team.roundScores ?? []);
      const successfulScoredRounds = roundShares.filter((round) => round.reward > 0).length;
      const requiredSuccessfulRounds = market.event
        ? Math.min(MIN_QUALIFYING_SCORED_ROUNDS, market.event.scoredRounds)
        : 0;
      return {
        teamId: team.id,
        escrow: team.escrow,
        roundEscrow: team.roundEscrow,
        tickets: team.tickets,
        roundShares,
        successfulScoredRounds,
        requiredSuccessfulRounds,
        qualified: Boolean(market.event?.stage === "complete" && successfulScoredRounds >= requiredSuccessfulRounds),
        score: Number(roundShares.reduce((sum, round) => sum + round.share, 0).toFixed(4)),
        currentRoundShare: currentTotal === 0 ? 0 : Number((team.roundEscrow / currentTotal).toFixed(4)),
      };
    })
    .sort((a, b) => (market.event ? b.score - a.score || b.currentRoundShare - a.currentRoundShare : b.escrow - a.escrow)
      || a.teamId.localeCompare(b.teamId));
  const total = rows.reduce((sum, row) => sum + row.escrow, 0);
  let previousScore;
  let previousRank = 0;
  return rows.map((row, index) => {
    const rankingScore = market.event ? row.score + row.currentRoundShare : row.escrow;
    if (rankingScore !== previousScore) previousRank = index + 1;
    previousScore = rankingScore;
    return {
      ...row,
      rank: previousRank,
      share: market.event ? row.currentRoundShare : total === 0 ? 0 : Number((row.escrow / total).toFixed(4)),
      stage: market.event?.stage ?? "continuous",
    };
  });
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

function telemetryCard(market) {
  const flow = pulseDirection(market, market.tick + 1);
  return {
    rewardSamples: [market.rewardRate - 9, market.rewardRate + 4, market.rewardRate - 2],
    flow: {
      direction: flow === 0 ? "balanced" : flow > 0 ? "up-bin" : "down-bin",
      confidence: 0.64,
      observedBins: market.bins
        .filter((bin) => Math.abs(bin.id - market.activeBin) <= 2)
        .map((bin) => bin.id),
    },
    touches: market.bins
      .filter((bin) => (bin.id + market.tick) % 2 === 0)
      .map((bin) => ({ binId: bin.id, lastTouchedTick: Math.max(0, bin.lastTouchedTick - 1) })),
    note: "Samples, flow, and touch records are delayed or incomplete. Combine them with public market state; none is an outcome oracle.",
  };
}

function activeMultiplier(market, bin) {
  return bin.id === market.activeBin ? 3 : 1;
}

function createBins(seed, round, tick) {
  const bins = [];
  for (let id = -4; id <= 4; id += 1) {
    const entropy = Number.parseInt(hash(`${seed}:round:${round}:bin:${id}`).slice(0, 4), 16);
    bins.push({
      id,
      liquidity: 120 + Math.abs(id) * 17 + (entropy % 61),
      lastTouchedTick: Math.max(0, tick - (3 + (entropy % 9))),
      rewardPerLiquidity: 0,
      heat: 0,
    });
  }
  return bins;
}

function startNextRound(market) {
  if (market.event) {
    finalizeEventRound(market);
    const totalRounds = market.event.practiceRounds + market.event.scoredRounds;
    if (market.round >= totalRounds) {
      market.event.stage = "complete";
      market.event.completedAtTick = market.tick;
      market.roundEndsAtTick = Number.MAX_SAFE_INTEGER;
      for (const team of Object.values(market.teams)) {
        team.tickets = 0;
        team.liquidityBalance = 0;
        team.commits = {};
        team.reveals = {};
      }
      appendEvent(market, { tick: market.tick, round: market.round, type: "event-complete" });
      return;
    }
  }
  market.round += 1;
  if (market.event) market.event.stage = market.round <= market.event.practiceRounds ? "practice" : "live";
  market.roundStartedAtTick = market.tick;
  market.roundEndsAtTick = market.tick + market.roundTicks;
  market.bins = createBins(market.seed, market.round, market.tick);
  const activeIndex = Number.parseInt(hash(`${market.seed}:round:${market.round}:active`).slice(0, 2), 16)
    % market.bins.length;
  market.activeBin = market.bins[activeIndex].id;
  market.rewardRate = 72 + (Number.parseInt(hash(`${market.seed}:round:${market.round}:rate`).slice(0, 2), 16) % 57);
  market.lastPulse = {
    tick: market.tick,
    type: "round-reset",
    activeBin: market.activeBin,
    rewardRate: market.rewardRate,
  };
  for (const team of Object.values(market.teams)) {
    team.roundEscrow = 0;
    team.liquidityBalance = market.startingLiquidity;
    team.tickets = TICKETS_PER_ROUND;
    team.commits = {};
    team.reveals = {};
    team.resolvedTicks = {};
  }
  market.usedVouchers = {};
  appendEvent(market, { tick: market.tick, round: market.round, type: "round-reset", activeBin: market.activeBin });
}

function finalizeEventRound(market) {
  const isPractice = market.round <= market.event.practiceRounds;
  const total = Object.values(market.teams).reduce((sum, team) => sum + team.roundEscrow, 0);
  for (const team of Object.values(market.teams)) {
    if (isPractice) {
      team.escrow = Math.max(0, team.escrow - team.roundEscrow);
    } else {
      const share = total === 0 ? 0 : Number((team.roundEscrow / total).toFixed(4));
      team.roundScores.push({ round: market.round - market.event.practiceRounds, reward: team.roundEscrow, share });
    }
  }
  if (!isPractice) market.event.completedScoredRounds += 1;
}

function applyMarketPulse(market) {
  const rewardEntropy = Number.parseInt(hash(`${market.seed}:round:${market.round}:tick:${market.tick}:rate`).slice(0, 4), 16);
  market.rewardRate = 72 + (rewardEntropy % 57);
  const direction = pulseDirection(market, market.tick);
  let fromBin = market.activeBin;
  let toBin = fromBin;

  // Public flow shifts the active bin every third tick. It settles the bin being left while preserving
  // the destination backlog, matching the same pressure semantics as a player swap.
  if ((market.tick - market.roundStartedAtTick) % 3 === 0 && direction !== 0) {
    const currentIndex = market.bins.findIndex((bin) => bin.id === market.activeBin);
    const nextIndex = Math.max(0, Math.min(market.bins.length - 1, currentIndex + direction));
    if (nextIndex !== currentIndex) {
      const previous = market.bins[currentIndex];
      previous.lastTouchedTick = market.tick;
      previous.heat = Math.max(previous.heat, 10);
      market.activeBin = market.bins[nextIndex].id;
      market.bins[nextIndex].heat = Math.max(market.bins[nextIndex].heat, 6);
      toBin = market.activeBin;
    }
  }

  market.lastPulse = { tick: market.tick, type: "market-pulse", fromBin, toBin, direction, rewardRate: market.rewardRate };
  appendEvent(market, market.lastPulse);
}

function pulseDirection(market, tick) {
  const entropy = Number.parseInt(hash(`${market.seed}:round:${market.round}:tick:${tick}:pressure`).slice(0, 2), 16);
  return [-1, -1, 0, 1, 1][entropy % 5];
}

function pruneTeamTickState(team, tick) {
  for (const committedTick of Object.keys(team.commits)) {
    if (Number(committedTick) < tick) delete team.commits[committedTick];
  }
  for (const revealedTick of Object.keys(team.reveals)) {
    if (Number(revealedTick) < tick) delete team.reveals[revealedTick];
  }
  for (const resolvedTick of Object.keys(team.resolvedTicks)) {
    if (Number(resolvedTick) < tick) delete team.resolvedTicks[resolvedTick];
  }
}

function actionOrderKey(market, tick, teamId) {
  return hash(`${market.seed}:round:${market.round}:tick:${tick}:team:${teamId}`);
}

function publicActivity(market) {
  return market.eventLog
    .filter((event) => ["resolution", "market-pulse", "round-reset", "swap", "sniper"].includes(event.type))
    .slice(-8)
    .map((event) => {
      if (event.type === "market-pulse") {
        return { type: event.type, tick: event.tick, fromBin: event.fromBin, toBin: event.toBin };
      }
      return clone(event);
    });
}

function appendEvent(market, event) {
  market.eventLog.push(event);
  if (market.eventLog.length > EVENT_LOG_LIMIT) {
    market.eventLog.splice(0, market.eventLog.length - EVENT_LOG_LIMIT);
  }
}

function getBin(market, binId) {
  if (!Number.isSafeInteger(binId)) throw new Error("bin id must be an integer");
  const bin = market.bins.find((candidate) => candidate.id === binId);
  if (!bin) throw new Error("unknown bin");
  return bin;
}

function rewardVaultEstimate(market) {
  return Math.max(0, 500_000 - Object.values(market.teams).reduce((sum, team) => sum + team.escrow, 0));
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
  if (market.event?.stage === "complete") throw new Error("event is complete");
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

export function restoreMarket(value, options = {}) {
  const restored = clone(value);
  if (!restored || typeof restored !== "object" || Array.isArray(restored)) {
    throw new Error("saved market must be an object");
  }
  if (typeof restored.seed !== "string" || !Array.isArray(restored.bins) || !restored.teams) {
    throw new Error("saved market is incomplete");
  }
  assertPositiveSafeInteger(restored.tick, "saved market tick");
  assertPositiveSafeInteger(restored.startingLiquidity, "saved starting liquidity");
  assertPositiveSafeInteger(restored.maxActionLiquidity, "saved maximum action liquidity");
  assertPositiveSafeInteger(restored.roundTicks, "saved round ticks");
  if (restored.phase !== "commit" && restored.phase !== "reveal") {
    throw new Error("saved market phase is invalid");
  }
  restored.eventId ??= crypto.randomUUID();
  for (const team of Object.values(restored.teams)) team.roundScores ??= [];
  const voucherSecret = options.voucherSecret;
  if (!isUsableSecret(voucherSecret)) throw new Error("voucher secret must contain at least 32 bytes");
  voucherAuthorities.set(restored, voucherSecret);
  return restored;
}
