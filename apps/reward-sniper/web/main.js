const SESSION_KEY = "reward-sniper-session-v1";
const PENDING_KEY = "reward-sniper-pending-v1";

let session;
let marketView;
let selectedBinId;
let pending;
let lastTick;
let lastPhase;

const elements = {
  bins: document.querySelector("#bins"),
  telemetry: document.querySelector("#telemetry"),
  scoreboard: document.querySelector("#scoreboard"),
  identity: document.querySelector("#identity"),
  liquidity: document.querySelector("#liquidity"),
  selection: document.querySelector("#selection"),
  status: document.querySelector("#status"),
  prepare: document.querySelector("#prepare"),
  commit: document.querySelector("#commit"),
  reveal: document.querySelector("#reveal"),
};

async function api(path, options = {}) {
  const headers = { ...(options.body ? { "content-type": "application/json" } : {}) };
  if (session?.accessToken) headers.authorization = `Bearer ${session.accessToken}`;
  const response = await fetch(path, { ...options, headers: { ...headers, ...options.headers } });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error || `request failed (${response.status})`);
    error.status = response.status;
    throw error;
  }
  return payload;
}

async function establishSession() {
  try {
    session = JSON.parse(localStorage.getItem(SESSION_KEY));
  } catch {
    session = undefined;
  }

  if (session?.accessToken) {
    try {
      await api("/api/market");
      return;
    } catch (error) {
      if (error.status !== 401) throw error;
      localStorage.removeItem(SESSION_KEY);
      session = undefined;
    }
  }

  const teamId = `team-${crypto.randomUUID().slice(0, 8)}`;
  session = await api("/api/session", {
    method: "POST",
    body: JSON.stringify({ teamId }),
  });
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

async function refresh() {
  const [nextView, scores] = await Promise.all([api("/api/market"), api("/api/scoreboard")]);
  let transitionMessage;
  if (pending && pending.tick !== nextView.tick) {
    transitionMessage = describeResolution(nextView.team.lastResolution, pending.tick);
    clearPending();
  } else if (lastTick !== undefined && nextView.tick !== lastTick) {
    clearPending();
  } else if (lastPhase === "commit" && nextView.phase === "reveal") {
    if (pending?.stage === "prepared") {
      clearPending();
      transitionMessage = "commit window closed before the action was committed";
    } else if (pending?.stage === "committed") {
      transitionMessage = "reveal phase is open — reveal the committed action now";
    }
  }
  if (pending && pending.tick === nextView.tick) {
    if (nextView.team.hasRevealed) pending.stage = "revealed";
    else if (nextView.team.hasCommitted) pending.stage = "committed";
    else if (nextView.phase === "reveal") {
      clearPending();
      transitionMessage = "commit window closed before the action was committed";
    }
    if (pending) savePending();
  }
  lastTick = nextView.tick;
  lastPhase = nextView.phase;
  marketView = nextView;
  if (selectedBinId === undefined) selectedBinId = marketView.activeBin;
  renderMarket();
  syncControls();
  elements.scoreboard.textContent = JSON.stringify(scores, null, 2);
  if (transitionMessage) setStatus(transitionMessage);
}

function renderMarket() {
  const secondsRemaining = marketView.phaseEndsAt
    ? Math.max(0, Math.ceil((marketView.phaseEndsAt - Date.now()) / 1_000))
    : null;
  elements.identity.textContent = `${session.teamId} / tick ${marketView.tick} / ${marketView.phase} phase${secondsRemaining === null ? "" : ` / ${secondsRemaining}s`}`;
  elements.telemetry.textContent = JSON.stringify(marketView.team.telemetry, null, 2);
  elements.selection.textContent = [
    `selected bin: ${selectedBinId}`,
    `funded liquidity: ${marketView.team.liquidityBalance}`,
    `tickets remaining: ${marketView.team.tickets}`,
    `escrow: ${marketView.team.escrow}`,
  ].join("\n");
  elements.bins.innerHTML = marketView.bins
    .map(
      (bin) => `
        <button
          class="bin ${heatClass(bin.heat)} ${bin.isActive ? "active" : ""} ${bin.id === selectedBinId ? "selected" : ""}"
          data-bin-id="${bin.id}"
          type="button"
        >
          <strong>${bin.id}</strong>
          <span>liq ${bin.liquidity}</span>
          <span>stale ${bin.staleTicks}</span>
          <span>${bin.isActive ? "active" : ""}</span>
        </button>
      `,
    )
    .join("");

  for (const button of elements.bins.querySelectorAll("[data-bin-id]")) {
    button.addEventListener("click", () => {
      if (pending) return setStatus("finish or expire the current commit before changing bins", true);
      selectedBinId = Number.parseInt(button.dataset.binId, 10);
      renderMarket();
    });
  }
}

function heatClass(heat) {
  if (heat >= 75) return "heat-high";
  if (heat >= 35) return "heat-medium";
  if (heat > 0) return "heat-low";
  return "heat-none";
}

function syncControls() {
  const phase = marketView?.phase;
  elements.prepare.disabled = phase !== "commit" || Boolean(pending);
  elements.commit.disabled = phase !== "commit" || pending?.stage !== "prepared";
  elements.reveal.disabled = phase !== "reveal" || pending?.stage !== "committed";
  elements.liquidity.disabled = phase !== "commit" || Boolean(pending);
}

function setStatus(message, isError = false) {
  elements.status.textContent = message;
  elements.status.classList.toggle("error", isError);
}

function clearPending() {
  pending = undefined;
  sessionStorage.removeItem(PENDING_KEY);
}

function savePending() {
  sessionStorage.setItem(PENDING_KEY, JSON.stringify(pending));
}

function describeResolution(resolution, expectedTick) {
  if (!resolution || resolution.tick !== expectedTick) return "tick closed without a recorded resolution";
  if (resolution.status === "missed-reveal") return "commit expired because no reveal was accepted";
  if (resolution.status === "failed") return `batch rejected the action: ${resolution.error}`;
  if (resolution.actionType === "ticket") {
    return `batch resolved: extracted ${resolution.result.extracted}; ${resolution.result.ticketsRemaining} tickets remain`;
  }
  return `batch resolved ${resolution.actionType}`;
}

elements.prepare.addEventListener("click", async () => {
  try {
    const liquidity = Number(elements.liquidity.value);
    if (!Number.isSafeInteger(liquidity) || liquidity <= 0) {
      throw new Error("liquidity must be a positive whole number");
    }
    const { voucher } = await api("/api/voucher", {
      method: "POST",
      body: JSON.stringify({ binId: selectedBinId }),
    });
    pending = {
      teamId: session.teamId,
      action: { type: "ticket", binId: selectedBinId, liquidity, voucher },
      nonce: crypto.randomUUID(),
      tick: marketView.tick,
      stage: "prepared",
    };
    savePending();
    syncControls();
    setStatus(`voucher prepared for bin ${selectedBinId}; commit before tick ${marketView.tick} ends`);
  } catch (error) {
    setStatus(error.message, true);
  }
});

elements.commit.addEventListener("click", async () => {
  try {
    const result = await api("/api/commit", {
      method: "POST",
      body: JSON.stringify({ action: pending.action, nonce: pending.nonce }),
    });
    pending.commitment = result.commitment;
    pending.stage = "committed";
    savePending();
    syncControls();
    setStatus(`committed ${result.commitment.slice(0, 16)}…; wait for the reveal phase`);
  } catch (error) {
    setStatus(error.message, true);
    await refresh().catch(() => {});
  }
});

elements.reveal.addEventListener("click", async () => {
  try {
    await api("/api/reveal", {
      method: "POST",
      body: JSON.stringify({ action: pending.action, nonce: pending.nonce }),
    });
    pending.stage = "revealed";
    savePending();
    syncControls();
    setStatus("reveal accepted; action is queued for batch settlement");
    await refresh();
  } catch (error) {
    setStatus(error.message, true);
    await refresh().catch(() => {});
  }
});

async function start() {
  syncControls();
  setStatus("connecting to shared market…");
  try {
    await establishSession();
    try {
      const restored = JSON.parse(sessionStorage.getItem(PENDING_KEY));
      if (restored?.teamId === session.teamId) pending = restored;
      else clearPending();
    } catch {
      clearPending();
    }
    await refresh();
    if (pending?.stage === "revealed") {
      setStatus("reveal accepted; action is queued for batch settlement");
    } else if (pending?.stage === "committed") {
      setStatus(marketView.phase === "reveal" ? "reveal phase is open — reveal the committed action now" : "commit locked; wait for the reveal phase");
    } else if (pending?.stage === "prepared") {
      setStatus("ticket prepared; commit before the commit phase closes");
    } else {
      setStatus(marketView.phase === "commit" ? "select a bin and prepare a ticket" : "reveal phase; wait for the next tick");
    }
    setInterval(() => refresh().catch((error) => setStatus(error.message, true)), 2_000);
  } catch (error) {
    setStatus(error.message, true);
  }
}

start();
