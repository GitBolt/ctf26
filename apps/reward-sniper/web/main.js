const PENDING_KEY = "reward-sniper-pending-v2";
const POLL_MS = 2_000;

let session;
let marketView;
let scores = [];
let selectedBinId;
let actionType = "ticket";
let pending;
let lastTick;
let lastPhase;
let refreshPromise;
let pollTimer;
let strandedCommit = false;

const elements = {
  bins: document.querySelector("#bins"),
  telemetry: document.querySelector("#telemetry"),
  activity: document.querySelector("#activity"),
  scoreboard: document.querySelector("#scoreboard"),
  identity: document.querySelector("#identity"),
  connection: document.querySelector("#connection"),
  connectionText: document.querySelector("#connectionText"),
  testModeBadge: document.querySelector("#testModeBadge"),
  roundValue: document.querySelector("#roundValue"),
  roundProgress: document.querySelector("#roundProgress"),
  phaseValue: document.querySelector("#phaseValue"),
  phaseTimer: document.querySelector("#phaseTimer"),
  vaultValue: document.querySelector("#vaultValue"),
  footerTick: document.querySelector("#footerTick"),
  selectedBin: document.querySelector("#selectedBin"),
  selectedWindow: document.querySelector("#selectedWindow"),
  selectedLiquidity: document.querySelector("#selectedLiquidity"),
  liquidity: document.querySelector("#liquidity"),
  liquidityField: document.querySelector("#liquidityField"),
  ticketMode: document.querySelector("#ticketMode"),
  swapMode: document.querySelector("#swapMode"),
  primaryAction: document.querySelector("#primaryAction"),
  status: document.querySelector("#status"),
  steps: document.querySelector("#steps"),
  ticketsValue: document.querySelector("#ticketsValue"),
  balanceValue: document.querySelector("#balanceValue"),
  roundEscrowValue: document.querySelector("#roundEscrowValue"),
  escrowValue: document.querySelector("#escrowValue"),
  eventNotice: document.querySelector("#eventNotice"),
};

async function api(path, options = {}) {
  const headers = { ...(options.body ? { "content-type": "application/json" } : {}) };
  const response = await fetch(path, {
    ...options,
    credentials: "same-origin",
    headers: { ...headers, ...options.headers },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error || `Request failed (${response.status})`);
    error.status = response.status;
    throw error;
  }
  return payload;
}

function recordUiEvent(event) {
  return fetch("/api/ui-event", {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ event }),
  }).catch(() => {});
}

function launchTicketFromUrl() {
  return new URL(window.location.href).searchParams.get("ticket");
}

function directTestTeamFromUrl() {
  return new URL(window.location.href).searchParams.get("test_team");
}

function directTestKeyFromUrl() {
  return new URL(window.location.href).searchParams.get("test_key");
}

function clearLaunchTicket() {
  const url = new URL(window.location.href);
  url.searchParams.delete("ticket");
  url.searchParams.delete("test_team");
  url.searchParams.delete("test_key");
  history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
}

async function establishSession() {
  const launchTicket = launchTicketFromUrl();
  const directTestTeam = directTestTeamFromUrl();
  const directTestKey = directTestKeyFromUrl();
  if (launchTicket) {
    session = await api("/api/session", {
      method: "POST",
      body: JSON.stringify({ ticket: launchTicket }),
    });
    clearLaunchTicket();
    return;
  }
  if (directTestTeam) {
    session = await api("/api/session", {
      method: "POST",
      body: JSON.stringify({ directTest: true, teamId: directTestTeam, testKey: directTestKey }),
    });
    clearLaunchTicket();
    if (session.launchMode === "direct-test") elements.testModeBadge?.removeAttribute("hidden");
    return;
  }

  try {
    session = await api("/api/session");
    return;
  } catch (error) {
    if (error.status !== 401) throw error;
  }

  session = await api("/api/session", { method: "POST", body: "{}" });
}

async function refresh() {
  if (refreshPromise) return refreshPromise;
  refreshPromise = (async () => {
    const [nextView, nextScores] = await Promise.all([api("/api/market"), api("/api/scoreboard")]);
    let transitionMessage;

    if (marketView?.eventId && marketView.eventId !== nextView.eventId) {
      clearPending();
      lastTick = undefined;
      lastPhase = undefined;
      selectedBinId = undefined;
      strandedCommit = false;
      transitionMessage = "A new market event is active. Previous pending state was cleared.";
    } else if (pending && pending.eventId !== nextView.eventId) {
      clearPending();
      transitionMessage = "Previous pending state belonged to another market event and was cleared.";
    }

    if (!transitionMessage && pending && pending.tick !== nextView.tick) {
      transitionMessage = describeResolution(nextView.team.lastResolution, pending.tick);
      clearPending();
    } else if (lastTick !== undefined && nextView.tick !== lastTick && pending) {
      clearPending();
    } else if (lastPhase === "commit" && nextView.phase === "reveal" && pending?.stage === "committed") {
      transitionMessage = "Reveal is open. Submit the locked order before this phase closes.";
    }

    if (pending && pending.tick === nextView.tick) {
      if (nextView.team.hasRevealed) pending.stage = "revealed";
      else if (nextView.team.hasCommitted) pending.stage = "committed";
      else if (nextView.phase === "reveal") {
        clearPending();
        transitionMessage = "The commit window closed before your order was locked.";
      }
      if (pending) savePending();
    }
    strandedCommit = !pending && nextView.team.hasCommitted;

    lastTick = nextView.tick;
    lastPhase = nextView.phase;
    marketView = nextView;
    scores = nextScores;
    if (selectedBinId === undefined || !marketView.bins.some((bin) => bin.id === selectedBinId)) {
      selectedBinId = marketView.activeBin;
    }
    render();
    setConnection("live", "Market live");
    if (transitionMessage) setStatus(transitionMessage);
  })().finally(() => {
    refreshPromise = undefined;
  });
  return refreshPromise;
}

function render() {
  renderOverview();
  renderBins();
  renderSelection();
  renderTelemetry();
  renderActivity();
  renderScoreboard();
  syncControls();
  updateClock();
}

function renderOverview() {
  elements.identity.textContent = session.teamId;
  elements.roundValue.textContent = String(marketView.round).padStart(2, "0");
  const ticksLeft = Math.max(0, marketView.roundEndsAtTick - marketView.tick);
  elements.roundProgress.textContent = `${ticksLeft} tick${ticksLeft === 1 ? "" : "s"} until rotation`;
  elements.phaseValue.textContent = marketView.phase === "commit" ? "Commit" : "Reveal";
  elements.phaseValue.dataset.phase = marketView.phase;
  elements.vaultValue.textContent = formatNumber(marketView.rewardVault);
  elements.footerTick.textContent = `Round ${marketView.round} · tick ${marketView.tick} · ${marketView.phase} phase`;
  elements.ticketsValue.textContent = String(marketView.team.tickets);
  elements.balanceValue.textContent = formatNumber(marketView.team.liquidityBalance);
  elements.roundEscrowValue.textContent = formatNumber(marketView.team.roundEscrow);
  elements.escrowValue.textContent = formatNumber(marketView.team.escrow);
  renderEventState();
}

function renderEventState() {
  if (!marketView.event) {
    elements.eventNotice.hidden = true;
    return;
  }
  const event = marketView.event;
  elements.eventNotice.hidden = false;
  if (!marketView.eventStartedAt) {
    const start = marketView.eventStartsAt ? new Date(marketView.eventStartsAt).toLocaleTimeString() : "organizer kickoff";
    elements.eventNotice.textContent = `Waiting room. The market opens at ${start}; orders are disabled until then.`;
  } else if (event.stage === "practice") {
    elements.eventNotice.textContent = `Practice round ${marketView.round} of ${event.practiceRounds}. Extraction is visible but does not count toward the event score.`;
  } else if (event.stage === "live") {
    elements.eventNotice.textContent = `Scored round ${event.scoredRound} of ${event.scoredRounds}. This round contributes normalized extraction share to the final score.`;
  } else {
    elements.eventNotice.textContent = `Event complete. ${event.completedScoredRounds} scored rounds are locked.`;
  }
}

function renderBins() {
  const focusedBinId = document.activeElement?.dataset?.binId;
  elements.bins.replaceChildren();
  elements.bins.removeAttribute("aria-busy");
  for (const bin of marketView.bins) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `bin heat-${heatBand(bin.heat)}`;
    button.dataset.binId = String(bin.id);
    button.classList.toggle("active", bin.isActive);
    button.classList.toggle("selected", bin.id === selectedBinId);
    button.setAttribute("aria-pressed", String(bin.id === selectedBinId));
    button.setAttribute(
      "aria-label",
      `Bin ${signed(bin.id)}, ${formatNumber(bin.liquidity)} liquidity, ${bin.isActive ? "active" : "inactive"}, ${heatBand(bin.heat)} activity`,
    );

    const top = document.createElement("span");
    top.className = "bin-top";
    const id = document.createElement("strong");
    id.textContent = signed(bin.id);
    const state = document.createElement("span");
    state.className = "bin-state";
    state.textContent = bin.isActive ? "Active" : "Inactive";
    top.append(id, state);

    const liquidity = document.createElement("span");
    liquidity.className = "bin-liquidity";
    const liquidityLabel = document.createElement("small");
    liquidityLabel.textContent = "Liquidity";
    const liquidityValue = document.createElement("b");
    liquidityValue.textContent = formatNumber(bin.liquidity);
    liquidity.append(liquidityLabel, liquidityValue);
    const pressure = document.createElement("span");
    pressure.className = "pressure-track";
    pressure.setAttribute("aria-hidden", "true");
    pressure.append(document.createElement("i"));
    button.append(top, liquidity, pressure);
    button.addEventListener("click", () => selectBin(bin.id));
    elements.bins.append(button);
  }
  if (focusedBinId !== undefined) {
    elements.bins.querySelector(`[data-bin-id="${CSS.escape(focusedBinId)}"]`)?.focus({ preventScroll: true });
  }
}

function renderSelection() {
  const selected = marketView.bins.find((bin) => bin.id === selectedBinId);
  elements.selectedBin.textContent = selected ? signed(selected.id) : "—";
  elements.selectedWindow.textContent = selected ? titleCase(heatBand(selected.heat)) : "—";
  elements.selectedLiquidity.textContent = selected ? formatNumber(selected.liquidity) : "—";
}

function renderTelemetry() {
  const telemetry = marketView.team.telemetry;
  elements.telemetry.replaceChildren();
  elements.telemetry.removeAttribute("aria-busy");
  const title = document.createElement("strong");
  title.textContent = "Partial market observations";
  const values = document.createElement("div");
  values.className = "telemetry-values";
  for (const [index, value] of telemetry.rewardSamples.entries()) {
    values.append(metric(`Reward sample ${index + 1}`, formatNumber(value)));
  }
  values.append(metric("Flow", titleCase(telemetry.flow.direction)));
  values.append(metric("Flow confidence", `${Math.round(telemetry.flow.confidence * 100)}%`));
  for (const touch of telemetry.touches.slice(-3)) {
    values.append(metric(`Observed ${signed(touch.binId)}`, `tick ${touch.lastTouchedTick}`));
  }

  const note = document.createElement("p");
  note.textContent = telemetry.note;
  elements.telemetry.append(title, values, note);
}

function renderActivity() {
  elements.activity.replaceChildren();
  const activity = marketView.recentActivity
    .filter((event) => event.type === "resolution" || event.type === "market-pulse" || event.type === "round-reset")
    .slice(-5)
    .reverse();
  if (activity.length === 0) {
    const empty = document.createElement("li");
    empty.className = "empty";
    empty.textContent = "No settled activity yet.";
    elements.activity.append(empty);
    return;
  }
  for (const event of activity) {
    const item = document.createElement("li");
    const marker = document.createElement("span");
    marker.className = `activity-marker ${event.status === "failed" ? "failed" : ""}`;
    const copy = document.createElement("div");
    const heading = document.createElement("strong");
    const detail = document.createElement("small");
    if (event.type === "round-reset") {
      heading.textContent = `Round ${event.round} opened`;
      detail.textContent = `Active bin ${signed(event.activeBin)}`;
    } else if (event.type === "market-pulse") {
      heading.textContent = event.fromBin === event.toBin ? "Market held position" : `Active bin moved to ${signed(event.toBin)}`;
      detail.textContent = `Tick ${event.tick} public flow`;
    } else {
      heading.textContent = `${event.teamId} · ${event.status}`;
      detail.textContent = event.actionType
        ? `Tick ${event.tick} ${event.actionType} order${event.result?.extracted !== undefined ? ` · ${formatNumber(event.result.extracted)} extracted` : ""}`
        : `Tick ${event.tick} commitment`;
    }
    copy.append(heading, detail);
    item.append(marker, copy);
    elements.activity.append(item);
  }
}

function renderScoreboard() {
  elements.scoreboard.replaceChildren();
  if (scores.length === 0) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 7;
    cell.className = "empty-cell";
    cell.textContent = "Waiting for the first team…";
    row.append(cell);
    elements.scoreboard.append(row);
    return;
  }
  for (const score of scores) {
    const row = document.createElement("tr");
    row.classList.toggle("is-team", score.teamId === session.teamId);
    for (const value of [
      String(score.rank).padStart(2, "0"),
      score.teamId,
      formatNumber(score.escrow),
      String(score.tickets),
      `${(score.share * 100).toFixed(1)}%`,
      Number(score.score ?? 0).toFixed(4),
      `${score.successfulScoredRounds}/${score.requiredSuccessfulRounds}${score.qualified ? " ✓" : ""}`,
    ]) {
      const cell = document.createElement("td");
      cell.textContent = value;
      row.append(cell);
    }
    elements.scoreboard.append(row);
  }
}

function syncControls() {
  const phase = marketView?.phase;
  const committed = pending?.stage === "committed";
  const revealed = pending?.stage === "revealed";
  const locked = Boolean(pending) || strandedCommit;
  const ticketUnavailable = actionType === "ticket" && marketView?.team.tickets <= 0;
  const liquidity = Number(elements.liquidity.value);
  const badLiquidity = !Number.isSafeInteger(liquidity) || liquidity < 1 || liquidity > 1_000;
  const waiting = Boolean(marketView?.event && !marketView.eventStartedAt);

  elements.ticketMode.disabled = waiting || locked || phase !== "commit";
  elements.swapMode.disabled = waiting || locked || phase !== "commit";
  elements.liquidity.disabled = waiting || locked || phase !== "commit" || actionType !== "ticket";
  elements.liquidityField.hidden = actionType !== "ticket";
  elements.primaryAction.disabled = true;

  if (waiting) {
    elements.primaryAction.textContent = "Waiting for event start";
  } else if (marketView?.event?.stage === "complete") {
    elements.ticketMode.disabled = true;
    elements.swapMode.disabled = true;
    elements.liquidity.disabled = true;
    elements.primaryAction.textContent = "Event complete";
  } else if (!marketView) {
    elements.primaryAction.textContent = "Connect to market";
  } else if (strandedCommit) {
    elements.primaryAction.textContent = phase === "reveal"
      ? "Reveal secret unavailable in this tab"
      : "Order locked in another tab";
  } else if (!pending && phase === "commit") {
    elements.primaryAction.textContent = actionType === "ticket" ? "Lock ticket order" : "Lock market swap";
    elements.primaryAction.disabled = ticketUnavailable || badLiquidity && actionType === "ticket";
  } else if (!pending && phase === "reveal") {
    elements.primaryAction.textContent = "Commit window closed";
  } else if (committed && phase === "commit") {
    elements.primaryAction.textContent = "Locked · waiting for reveal";
  } else if (committed && phase === "reveal") {
    elements.primaryAction.textContent = "Reveal locked order";
    elements.primaryAction.disabled = false;
  } else if (revealed) {
    elements.primaryAction.textContent = "Revealed · awaiting settlement";
  }

  elements.ticketMode.setAttribute("aria-pressed", String(actionType === "ticket"));
  elements.swapMode.setAttribute("aria-pressed", String(actionType === "swap"));
  syncSteps();
}

function syncSteps() {
  for (const step of elements.steps.querySelectorAll("li")) {
    step.className = "";
    step.removeAttribute("aria-current");
  }
  const select = elements.steps.querySelector('[data-step="select"]');
  const commit = elements.steps.querySelector('[data-step="commit"]');
  const reveal = elements.steps.querySelector('[data-step="reveal"]');
  if (!pending && !strandedCommit) {
    select.className = "active";
    select.setAttribute("aria-current", "step");
  } else if (strandedCommit) {
    select.className = "complete";
    commit.className = "complete";
    reveal.className = marketView?.phase === "reveal" ? "active" : "waiting";
    if (marketView?.phase === "reveal") reveal.setAttribute("aria-current", "step");
  }
  else {
    select.className = "complete";
    commit.className = "complete";
    reveal.className = pending.stage === "revealed" ? "complete" : marketView?.phase === "reveal" ? "active" : "waiting";
    if (marketView?.phase === "reveal" && pending.stage !== "revealed") reveal.setAttribute("aria-current", "step");
  }
}

function selectBin(binId) {
  if (pending || strandedCommit) {
    setStatus("This tick already has a locked order. Wait for settlement before changing bins.", true);
    return;
  }
  selectedBinId = binId;
  recordUiEvent("bin-select");
  renderBins();
  renderSelection();
  setStatus(`Bin ${signed(binId)} selected. Lock an order during the commit phase.`);
}

function setActionType(nextType) {
  if (pending || marketView?.phase !== "commit") return;
  actionType = nextType;
  syncControls();
  setStatus(nextType === "ticket"
    ? "Ticket order selected. Size funded liquidity, then lock the exact action."
    : "Market swap selected. A resolved swap moves the active bin but earns no direct reward.");
}

function setStatus(message, isError = false) {
  elements.status.textContent = message;
  elements.status.classList.toggle("error", isError);
}

function setConnection(state, label) {
  elements.connection.dataset.state = state;
  elements.connectionText.textContent = label;
}

function clearPending() {
  pending = undefined;
  sessionStorage.removeItem(PENDING_KEY);
}

function savePending() {
  sessionStorage.setItem(PENDING_KEY, JSON.stringify(pending));
}

function restorePending() {
  try {
    const restored = JSON.parse(sessionStorage.getItem(PENDING_KEY));
    if (restored?.teamId === session.teamId && restored?.action && restored?.nonce) {
      pending = restored;
      actionType = restored.action.type;
      selectedBinId = restored.action.type === "ticket" ? restored.action.binId : restored.action.toBin;
    }
    else clearPending();
  } catch {
    clearPending();
  }
}

function describeResolution(resolution, expectedTick) {
  if (!resolution || resolution.tick !== expectedTick) return "Tick closed without a recorded order resolution.";
  if (resolution.status === "missed-reveal") return "The locked order expired because no reveal was accepted.";
  if (resolution.status === "failed") return `Settlement rejected the order: ${resolution.error}`;
  if (resolution.actionType === "ticket") {
    return `Settlement complete: ${formatNumber(resolution.result.extracted)} reward extracted; ${resolution.result.ticketsRemaining} tickets remain.`;
  }
  return `Settlement complete: active bin moved to ${signed(resolution.result.activeBin)}.`;
}

async function lockOrder() {
  const liquidity = Number(elements.liquidity.value);
  if (actionType === "ticket" && (!Number.isSafeInteger(liquidity) || liquidity < 1 || liquidity > 1_000)) {
    throw new Error("Liquidity must be a whole number from 1 to 1,000.");
  }
  const nonce = crypto.randomUUID();
  const result = await api("/api/order", {
    method: "POST",
    body: JSON.stringify({
      type: actionType,
      binId: selectedBinId,
      ...(actionType === "ticket" ? { liquidity } : {}),
      nonce,
    }),
  });
  pending = {
    teamId: session.teamId,
    action: result.action,
    nonce,
    commitment: result.commitment,
    eventId: marketView.eventId,
    tick: result.tick,
    stage: "committed",
  };
  savePending();
  setStatus(`Order locked for tick ${result.tick}. Keep this tab open and reveal when the phase changes.`);
}

async function revealOrder() {
  await api("/api/reveal", {
    method: "POST",
    body: JSON.stringify({ action: pending.action, nonce: pending.nonce }),
  });
  pending.stage = "revealed";
  savePending();
  setStatus("Reveal accepted. The order is queued for deterministic batch settlement.");
}

async function handlePrimaryAction() {
  elements.primaryAction.disabled = true;
  try {
    if (!pending && marketView.phase === "commit") {
      await recordUiEvent("order-click");
      await lockOrder();
    }
    else if (pending?.stage === "committed" && marketView.phase === "reveal") {
      await recordUiEvent("reveal-click");
      await revealOrder();
    }
    await refresh();
  } catch (error) {
    setStatus(error.message, true);
    await refresh().catch(() => {});
  } finally {
    syncControls();
  }
}

function updateClock() {
  if (!marketView) return;
  if (!marketView.phaseEndsAt) {
    if (marketView.eventStartsAt && !marketView.eventStartedAt) {
      const seconds = Math.max(0, Math.ceil((marketView.eventStartsAt - Date.now()) / 1_000));
      elements.phaseTimer.textContent = `Starts in ${seconds}s`;
    } else {
      elements.phaseTimer.textContent = "Waiting for organizer";
    }
    return;
  }
  const milliseconds = Math.max(0, marketView.phaseEndsAt - Date.now());
  const seconds = Math.ceil(milliseconds / 1_000);
  elements.phaseTimer.textContent = `${seconds}s remaining`;
  elements.phaseTimer.classList.toggle("urgent", seconds <= 5);
}

function metric(label, value) {
  const item = document.createElement("div");
  const key = document.createElement("span");
  const data = document.createElement("strong");
  key.textContent = label;
  data.textContent = value;
  item.append(key, data);
  return item;
}

function heatBand(heat) {
  if (heat >= 70) return "high";
  if (heat >= 30) return "medium";
  if (heat > 0) return "low";
  return "none";
}

function signed(value) {
  return value > 0 ? `+${value}` : String(value);
}

function formatNumber(value) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value ?? 0);
}

function titleCase(value) {
  return String(value ?? "").replace(/(^|-)([a-z])/g, (_match, separator, letter) => `${separator === "-" ? " " : ""}${letter.toUpperCase()}`);
}

function schedulePoll() {
  clearTimeout(pollTimer);
  pollTimer = setTimeout(async () => {
    try {
      await refresh();
    } catch (error) {
      setConnection("error", "Connection interrupted");
      setStatus(error.message, true);
    }
    schedulePoll();
  }, POLL_MS);
}

async function start() {
  syncControls();
  setConnection("connecting", "Connecting");
  try {
    await establishSession();
    recordUiEvent("page-ready");
    restorePending();
    await refresh();
    if (pending?.stage === "revealed") {
      setStatus("Reveal accepted. The order is queued for deterministic batch settlement.");
    } else if (pending?.stage === "committed") {
      setStatus(marketView.phase === "reveal"
        ? "Reveal is open. Submit the locked order before this phase closes."
        : "Order locked. Wait for the reveal phase.");
    } else if (strandedCommit) {
      setStatus("This team has a locked order, but this tab does not have its reveal secret. Return to the tab that created the order.", true);
    } else {
      setStatus(marketView.phase === "commit"
        ? "Select a bin and lock one exact order before the commit window closes."
        : "Reveal phase is active. New orders open on the next tick.");
    }
    schedulePoll();
  } catch (error) {
    setConnection("error", "Launch required");
    setStatus(error.status === 401
      ? "This session is not authorized. Relaunch Reward Sniper from the CTF26 event portal."
      : error.message, true);
  }
}

elements.ticketMode.addEventListener("click", () => setActionType("ticket"));
elements.swapMode.addEventListener("click", () => setActionType("swap"));
elements.primaryAction.addEventListener("click", handlePrimaryAction);
elements.liquidity.addEventListener("input", syncControls);
setInterval(updateClock, 250);
start();
