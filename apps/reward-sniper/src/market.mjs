import crypto from "node:crypto";

export const DEFAULT_STARTING_LIQUIDITY = 3_000;
export const MAX_ACTION_LIQUIDITY = 1_000;
export const DEFAULT_ROUND_TICKS = 12;
export const TICKETS_PER_ROUND = 3;
export const MIN_QUALIFYING_SCORED_ROUNDS = 2;
export const SWAP_LIQUIDITY_FEE = 50;

const INITIAL_TICK = 12;
const EVENT_LOG_LIMIT = 1_000;
const SCORE_DECIMAL_PLACES = 12;
const PARTICIPANT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

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

function scorePrecision(value) {
  return Number(value.toFixed(SCORE_DECIMAL_PLACES));
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
    participants: {},
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

export function registerParticipant(market, participantId) {
  if (typeof participantId !== "string" || !PARTICIPANT_ID_PATTERN.test(participantId)) {
    throw new Error("invalid participant id");
  }
  if (market.participants[participantId]) throw new Error("participant already registered");
  market.participants[participantId] = {
    id: participantId,
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
  return market.participants[participantId];
}

export function inspectMarket(market, participantId) {
  const participant = market.participants[participantId];
  if (!participant) throw new Error("unknown participant");

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
      liquidity: bin.liquidity * 1_000,
      price: binPrice(bin.id),
      volume24h: volume24h(market, bin),
      fees24h: fees24h(market, bin),
      staleTicks: Math.max(0, market.tick - bin.lastTouchedTick),
      heat: bin.heat,
      isActive: bin.id === market.activeBin,
    })),
    participant: {
      escrow: participant.escrow,
      roundEscrow: participant.roundEscrow,
      liquidityBalance: participant.liquidityBalance,
      tickets: participant.tickets,
      hasCommitted: Boolean(participant.commits[market.tick]),
      hasRevealed: Boolean(participant.reveals[market.tick]),
      lastResolution: participant.lastResolution ? clone(participant.lastResolution) : null,
      telemetry: telemetryCard(market),
    },
    recentActivity: publicActivity(market),
    event: market.event ? clone({
      ...market.event,
      scoredRound: market.event.stage === "live" ? market.round - market.event.practiceRounds : 0,
    }) : null,
  };
}

export function commitAction(market, participantId, action, nonce) {
  const participant = market.participants[participantId];
  if (!participant) throw new Error("unknown participant");
  assertPhase(market, "commit");
  assertCommitNonce(nonce);
  assertCanResolve(market, participant);
  if (participant.commits[market.tick]) throw new Error("already committed this tick");
  const commitment = hash(`${stableStringify(action)}:${nonce}`);
  participant.commits[market.tick] = commitment;
  appendEvent(market, { tick: market.tick, participantId, type: "commit", commitment });
  return commitment;
}

export function revealAction(market, participantId, action, nonce) {
  const participant = market.participants[participantId];
  if (!participant) throw new Error("unknown participant");
  assertPhase(market, "reveal");
  assertCommitNonce(nonce);
  assertCanResolve(market, participant);
  if (participant.reveals[market.tick]) throw new Error("already revealed this tick");
  const expected = participant.commits[market.tick];
  if (!expected) throw new Error("no commit for current tick");
  const actual = hash(`${stableStringify(action)}:${nonce}`);
  if (actual !== expected) throw new Error("commitment mismatch");

  if (action.type !== "swap" && action.type !== "ticket") throw new Error("unsupported reveal action");

  participant.reveals[market.tick] = clone(action);
  appendEvent(market, { tick: market.tick, participantId, type: "reveal-accepted" });
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
  const participants = Object.values(market.participants)
    .filter((participant) => participant.commits[resolvingTick])
    .sort((first, second) => actionOrderKey(market, resolvingTick, first.id)
      .localeCompare(actionOrderKey(market, resolvingTick, second.id)));

  // Reveals never mutate market state. Once the reveal boundary closes, settle the immutable queue in
  // a stable order so network timing during the reveal phase cannot change execution order.
  for (const participant of participants) {
    const action = participant.reveals[resolvingTick];
    let resolution;
    if (!action) {
      resolution = { tick: resolvingTick, participantId: participant.id, status: "missed-reveal" };
    } else {
      try {
        const result = applyResolvedAction(market, participant.id, action);
        resolution = {
          tick: resolvingTick,
          participantId: participant.id,
          status: "resolved",
          actionType: action.type,
          result,
        };
      } catch (error) {
        resolution = {
          tick: resolvingTick,
          participantId: participant.id,
          status: "failed",
          actionType: action.type,
          error: error.message,
        };
      }
    }
    participant.lastResolution = clone(resolution);
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

export function issueVoucher(market, participantId, { binId, nonce }) {
  if (!market.participants[participantId]) throw new Error("unknown participant");
  assertPhase(market, "commit");
  getBin(market, binId);
  assertVoucherNonce(nonce);
  const payload = { participantId, tick: market.tick, binId, nonce };
  return {
    ...payload,
    signature: hmac(getVoucherAuthority(market), stableStringify(payload)),
  };
}

export function verifyVoucher(market, participantId, binId, voucher) {
  if (!voucher || voucher.participantId !== participantId || voucher.tick !== market.tick || voucher.binId !== binId) {
    throw new Error("voucher binding mismatch");
  }
  const payload = {
    participantId: voucher.participantId,
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

export function claimWithSniperTicket(market, participantId, binId, addedLiquidity, voucher) {
  const participant = market.participants[participantId];
  if (!participant) throw new Error("unknown participant");
  const bin = getBin(market, binId);
  const voucherId = verifyVoucher(market, participantId, binId, voucher);
  assertCanResolve(market, participant);
  if (participant.tickets <= 0) throw new Error("no sniper tickets remaining");
  assertPositiveSafeInteger(addedLiquidity, "added liquidity");
  if (addedLiquidity > market.maxActionLiquidity) {
    throw new Error(`added liquidity exceeds per-action limit of ${market.maxActionLiquidity}`);
  }
  if (addedLiquidity > participant.liquidityBalance) throw new Error("insufficient funded liquidity");

  const elapsed = Math.max(0, market.tick - bin.lastTouchedTick);
  const oldLiquidity = bin.liquidity;

  // All checks above are side-effect free. Consume the one-shot authorities only once the action is
  // known to be valid, so malformed attempts cannot burn a participant's scarce ticket or funding.
  market.usedVouchers[voucherId] = { participantId, tick: market.tick };
  markResolved(market, participant, "ticket");
  participant.tickets -= 1;
  participant.liquidityBalance -= addedLiquidity;

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
  participant.escrow += extracted;
  participant.roundEscrow += extracted;
  participant.actions.push({ tick: market.tick, binId, addedLiquidity, extracted });
  if (participant.actions.length > 1_000) participant.actions.splice(0, participant.actions.length - 1_000);
  appendEvent(market, {
    tick: market.tick,
    participantId,
    type: "sniper",
    binId,
    oldLiquidity,
    addedLiquidity,
    extracted,
  });
  return { extracted, ticketsRemaining: participant.tickets };
}

export function swap(market, participantId, toBin) {
  const participant = market.participants[participantId];
  if (!participant) throw new Error("unknown participant");
  const bin = getBin(market, toBin);
  const previous = getBin(market, market.activeBin);
  assertCanResolve(market, participant);
  if (participant.liquidityBalance < SWAP_LIQUIDITY_FEE) {
    throw new Error("insufficient funded liquidity for the swap fee");
  }
  markResolved(market, participant, "swap");
  participant.liquidityBalance -= SWAP_LIQUIDITY_FEE;
  // Leaving a bin settles its public market-maker flow. The destination becomes active without
  // erasing its existing backlog, which is what makes a well-timed pressure move strategically useful.
  previous.lastTouchedTick = market.tick;
  previous.heat = Math.max(previous.heat, 12);
  market.activeBin = toBin;
  bin.heat = Math.max(bin.heat, 8);
  appendEvent(market, { tick: market.tick, participantId, type: "swap", fromBin: previous.id, toBin });
  return { activeBin: market.activeBin, liquidityFee: SWAP_LIQUIDITY_FEE };
}

export function advanceTick(market, ticks = 1) {
  assertPositiveSafeInteger(ticks, "tick advance");
  for (let step = 0; step < ticks; step += 1) {
    market.tick += 1;
    for (const bin of market.bins) bin.heat = Math.max(0, bin.heat - 3);
    for (const participant of Object.values(market.participants)) pruneParticipantTickState(participant, market.tick);
    for (const [voucherId, use] of Object.entries(market.usedVouchers)) {
      if (use.tick < market.tick) delete market.usedVouchers[voucherId];
    }

    if (market.tick >= market.roundEndsAtTick) startNextRound(market);
    else applyMarketPulse(market);
  }
}

function applyResolvedAction(market, participantId, action) {
  if (action.type === "swap") return swap(market, participantId, action.toBin);
  if (action.type === "ticket") {
    return claimWithSniperTicket(market, participantId, action.binId, action.liquidity, action.voucher);
  }
  throw new Error("unsupported reveal action");
}

export function scoreboard(market) {
  const currentTotal = Object.values(market.participants).reduce((sum, participant) => sum + participant.roundEscrow, 0);
  const includeCurrentRound = Boolean(market.event && market.event.stage !== "complete");
  const rows = Object.values(market.participants)
    .map((participant) => {
      const roundShares = clone(participant.roundScores ?? []);
      const successfulScoredRounds = roundShares.filter((round) => round.reward > 0).length;
      const requiredSuccessfulRounds = market.event
        ? Math.min(MIN_QUALIFYING_SCORED_ROUNDS, market.event.scoredRounds)
        : 0;
      const score = scorePrecision(roundShares.reduce((sum, round) => sum + round.share, 0));
      const currentRoundShare = includeCurrentRound && currentTotal > 0
        ? scorePrecision(participant.roundEscrow / currentTotal)
        : 0;
      return {
        participantId: participant.id,
        escrow: participant.escrow,
        roundEscrow: participant.roundEscrow,
        tickets: participant.tickets,
        roundShares,
        successfulScoredRounds,
        requiredSuccessfulRounds,
        qualified: Boolean(market.event?.stage === "complete" && successfulScoredRounds >= requiredSuccessfulRounds),
        score,
        currentRoundShare,
        rankingScore: market.event ? scorePrecision(score + currentRoundShare) : participant.escrow,
      };
    })
    .sort((a, b) => b.rankingScore - a.rankingScore || a.participantId.localeCompare(b.participantId));
  const total = rows.reduce((sum, row) => sum + row.escrow, 0);
  let previousScore;
  let previousRank = 0;
  return rows.map((row, index) => {
    if (row.rankingScore !== previousScore) previousRank = index + 1;
    previousScore = row.rankingScore;
    const { rankingScore, ...publicRow } = row;
    return {
      ...publicRow,
      rank: previousRank,
      share: market.event ? row.currentRoundShare : total === 0 ? 0 : Number((row.escrow / total).toFixed(4)),
      stage: market.event?.stage ?? "continuous",
    };
  });
}

export function simulateBestTicket(market, participantId, liquidity = 900) {
  const view = inspectMarket(market, participantId);
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

function binPrice(id) {
  return Number((148.2 + id * 0.74).toFixed(2));
}

function volume24h(market, bin) {
  const displayedLiquidity = bin.liquidity * 1_000;
  const baseline = displayedLiquidity * 0.16;
  const activity = bin.heat * 4_800 + (bin.id === market.activeBin ? displayedLiquidity * 0.08 : 0);
  return Math.round(baseline + activity);
}

function fees24h(market, bin) {
  return Math.round(volume24h(market, bin) * (bin.id === market.activeBin ? 0.0028 : 0.0017));
}

function startNextRound(market) {
  if (market.event) {
    finalizeEventRound(market);
    const totalRounds = market.event.practiceRounds + market.event.scoredRounds;
    if (market.round >= totalRounds) {
      market.event.stage = "complete";
      market.event.completedAtTick = market.tick;
      market.roundEndsAtTick = Number.MAX_SAFE_INTEGER;
      for (const participant of Object.values(market.participants)) {
        participant.tickets = 0;
        participant.liquidityBalance = 0;
        participant.commits = {};
        participant.reveals = {};
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
  for (const participant of Object.values(market.participants)) {
    participant.roundEscrow = 0;
    participant.liquidityBalance = market.startingLiquidity;
    participant.tickets = TICKETS_PER_ROUND;
    participant.commits = {};
    participant.reveals = {};
    participant.resolvedTicks = {};
  }
  market.usedVouchers = {};
  appendEvent(market, { tick: market.tick, round: market.round, type: "round-reset", activeBin: market.activeBin });
}

function finalizeEventRound(market) {
  const isPractice = market.round <= market.event.practiceRounds;
  const total = Object.values(market.participants).reduce((sum, participant) => sum + participant.roundEscrow, 0);
  for (const participant of Object.values(market.participants)) {
    if (isPractice) {
      participant.escrow = Math.max(0, participant.escrow - participant.roundEscrow);
    } else {
      // Four display decimals can erase a real one-unit extraction in the bounded reward vault. Keep
      // twelve score decimals in persisted state and leave shorter rounding to presentation only.
      const share = total === 0 ? 0 : scorePrecision(participant.roundEscrow / total);
      participant.roundScores.push({ round: market.round - market.event.practiceRounds, reward: participant.roundEscrow, share });
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

function pruneParticipantTickState(participant, tick) {
  for (const committedTick of Object.keys(participant.commits)) {
    if (Number(committedTick) < tick) delete participant.commits[committedTick];
  }
  for (const revealedTick of Object.keys(participant.reveals)) {
    if (Number(revealedTick) < tick) delete participant.reveals[revealedTick];
  }
  for (const resolvedTick of Object.keys(participant.resolvedTicks)) {
    if (Number(resolvedTick) < tick) delete participant.resolvedTicks[resolvedTick];
  }
}

function actionOrderKey(market, tick, participantId) {
  return hash(`${market.seed}:round:${market.round}:tick:${tick}:participant:${participantId}`);
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
  return Math.max(0, 500_000 - Object.values(market.participants).reduce((sum, participant) => sum + participant.escrow, 0));
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

function assertCanResolve(market, participant) {
  if (participant.resolvedTicks[market.tick]) throw new Error("action already resolved this tick");
}

function assertPhase(market, expected) {
  if (market.event?.stage === "complete") throw new Error("event is complete");
  if (market.phase !== expected) throw new Error(`${expected} phase is not open`);
}

function markResolved(market, participant, actionType) {
  participant.resolvedTicks[market.tick] = actionType;
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
  if (typeof restored.seed !== "string" || !Array.isArray(restored.bins) || !restored.participants) {
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
  for (const [participantId, participant] of Object.entries(restored.participants)) {
    if (!PARTICIPANT_ID_PATTERN.test(participantId) || participant?.id !== participantId) {
      throw new Error("saved market contains an invalid participant");
    }
    participant.roundScores ??= [];
  }
  const voucherSecret = options.voucherSecret;
  if (!isUsableSecret(voucherSecret)) throw new Error("voucher secret must contain at least 32 bytes");
  voucherAuthorities.set(restored, voucherSecret);
  return restored;
}
