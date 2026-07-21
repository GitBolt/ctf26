import { createBankDesk } from "/bank-scene.js";

const $ = (selector) => document.querySelector(selector);
const headers = { "content-type": "application/json", "x-evidence-room-ui": "console" };
const canvas = $("#bank-scene");
let sceneReady = false;
let dataReady = false;
function revealDesk() {
  if (!sceneReady || !dataReady) return;
  requestAnimationFrame(() => document.body.classList.remove("scene-loading"));
}
canvas.addEventListener("bank-scene-ready", () => { sceneReady = true; revealDesk(); }, { once: true });
const bankDesk = createBankDesk(canvas);
let state = null;
let operatorKey = null;
let lightOn = true;
const SESSION_ATTEMPTS = 12;

setTimeout(() => { sceneReady = true; revealDesk(); }, 4_000);

async function api(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { ...headers, ...(options.headers || {}) } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(body.error || "request failed");
    error.status = response.status;
    error.retryAfterSeconds = Number(response.headers.get("retry-after")) || 2;
    throw error;
  }
  return body;
}

async function establishSession(ticket) {
  for (let attempt = 1; attempt <= SESSION_ATTEMPTS; attempt += 1) {
    try {
      return await api("/api/session", { method: "POST", body: JSON.stringify(ticket ? { ticket } : {}) });
    } catch (error) {
      if (error.status !== 429) throw error;
      if (attempt === SESSION_ATTEMPTS) throw new Error("The event desk is still busy. No launch was created. Return to the portal and try again.");
      const delaySeconds = Math.min(5, Math.max(1, error.retryAfterSeconds));
      $("#error").textContent = `The event desk is busy. Retrying in ${delaySeconds} seconds.`;
      await new Promise((resolve) => setTimeout(resolve, delaySeconds * 1_000));
    }
  }
}

function short(value) { return value ? `${value.slice(0, 6)}…${value.slice(-5)}` : ""; }
function statusText(batch) {
  return batch.status === "allocating" ? "Preparing records"
    : batch.status === "allocated" ? "Review open"
    : batch.status === "factory-failed" ? "Processing blocked"
      : batch.status === "captured" ? "Resolved"
        : batch.status === "live" ? "Processed"
          : batch.status === "invalid" ? "Closed unresolved"
            : batch.status === "interfered" ? "Outside interference"
            : "Waiting";
}
function updateProgress(batch) {
  if (batch?.status === "factory-failed") {
    document.documentElement.style.setProperty("--batch-progress", "100%");
    bankDesk.setProgress(1);
    $("#countdown-value").textContent = "Stopped";
    $("#countdown-label").textContent = "Automatic processing was blocked";
    return;
  }
  if (!batch || batch.status !== "allocated") {
    document.documentElement.style.setProperty("--batch-progress", "0%");
    bankDesk.setProgress(0);
    $("#countdown-value").textContent = "Desk idle";
    $("#countdown-label").textContent = "No case under review";
    return;
  }
  const start = new Date(batch.allocatedAt).getTime();
  const duration = Math.max(1, Number(batch.initializeAt) - start);
  const progress = Math.min(1, Math.max(0, (Date.now() - start) / duration));
  document.documentElement.style.setProperty("--clock-turn", `${progress * 350}deg`);
  const remaining = Math.ceil((Number(batch.initializeAt) - Date.now()) / 1000);
  $("#countdown-value").textContent = remaining > 0 ? `${remaining}s` : "Reviewing";
  $("#countdown-label").textContent = remaining > 0 ? "Until automatic processing" : "Processing in progress";
  bankDesk.setProgress(progress);
}

function blankBoxes() {
  return Array.from({ length: 4 }, (_, index) => {
    const item = document.createElement("div");
    item.className = "empty-box";
    item.innerHTML = `<span>${101 + index}</span><i></i><b>Unassigned</b>`;
    return item;
  });
}

function render() {
  if (!state) return;
  $("#score").textContent = state.completedAt ? "Resolved" : "Unresolved";
  $("#wallet").textContent = short(state.wallet);

  const active = state.batches.find((batch) => ["allocating", "allocated", "factory-failed"].includes(batch.status));
  const latest = state.batches.at(-1);
  document.body.dataset.phase = active?.status || latest?.status || "idle";
  bankDesk.setBatchActive(Boolean(active));
  updateProgress(active);
  $("#start-case").disabled = Boolean(active) || Boolean(state.completedAt) || state.casesRemaining === 0;

  if (!active) {
    $("#batch-status").textContent = state.completedAt ? "Casework complete" : state.casesRemaining === 0 ? "Operator review required" : "Desk ready";
    $("#batch-copy").textContent = state.completedAt ? "Casework complete." : state.casesRemaining === 0 ? "Ask an event operator to reopen the desk." : "Start a case to receive its records.";
    $("#timeline").replaceChildren(...blankBoxes());
  } else {
    $("#batch-status").textContent = statusText(active);
    $("#batch-copy").textContent = active.status === "allocating" ? "The records are being prepared."
      : active.status === "allocated" ? "Review the four records before processing begins."
        : "Processing stopped. Complete the recovery.";
    $("#timeline").replaceChildren(...(active.accounts.length ? active.accounts.map((address, index) => {
      const item = document.createElement("a");
      item.href = `https://explorer.solana.com/address/${address}?cluster=devnet`;
      item.target = "_blank";
      item.rel = "noreferrer";
      item.className = "deposit-box";
      item.innerHTML = `<span>${101 + index}</span><i></i><b>Inspect record</b><code>${escapeHtml(short(address))}</code>`;
      return item;
    }) : blankBoxes()));
  }

  const batches = state.batches.slice().reverse();
  $("#ledger-count").textContent = `${batches.length} ${batches.length === 1 ? "entry" : "entries"}`;
  $("#history-list").replaceChildren(...(batches.length ? batches.map((batch) => {
    const row = document.createElement("article");
    row.dataset.status = batch.status;
    const recordLink = batch.allocationSignature
      ? `<a target="_blank" rel="noreferrer" href="https://explorer.solana.com/tx/${encodeURIComponent(batch.allocationSignature)}?cluster=devnet">Open record</a>`
      : "";
    row.innerHTML = `<div><strong>Case ${String(Number(batch.sequence) || 0).padStart(2, "0")}</strong><small>${escapeHtml(statusText(batch))}</small></div>${recordLink}`;
    return row;
  }) : [Object.assign(document.createElement("p"), { className: "empty", textContent: "No cases entered tonight." })]));
}

function escapeHtml(value) {
  return String(value || "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
}

async function refresh() {
  try { state = await api("/api/state", { headers: { "x-evidence-room-ui": "console" } }); $("#error").textContent = ""; render(); dataReady = true; revealDesk(); }
  catch (error) { $("#error").textContent = error.message; }
}
async function start() {
  try { await api("/api/batches", { method: "POST", body: "{}" }); await refresh(); }
  catch (error) { $("#error").textContent = error.message; }
}

$("#start-case").addEventListener("click", start);
$("#bulb-toggle").addEventListener("click", () => {
  lightOn = !lightOn;
  bankDesk.setLightOn(lightOn);
  document.body.classList.toggle("light-off", !lightOn);
  $("#bulb-toggle").setAttribute("aria-pressed", String(lightOn));
  $("#bulb-toggle").setAttribute("aria-label", lightOn ? "Turn desk light off" : "Turn desk light on");
});
$("#wallet-reveal").addEventListener("click", async () => {
  try {
    if (document.body.classList.contains("drawer-open")) {
      closeDrawer();
      return;
    }
    if (!operatorKey) {
      const body = await api("/api/event-wallet");
      operatorKey = body.secretKey;
      $("#secret-key").textContent = operatorKey;
    }
    document.body.classList.add("drawer-open");
    $("#wallet-reveal").textContent = "Close desk drawer";
    $("#key-drawer").setAttribute("aria-hidden", "false");
    $("#key-drawer").inert = false;
    bankDesk.setDrawerOpen(true);
    $("#close-key").focus();
  } catch (error) { $("#error").textContent = error.message; }
});
function closeDrawer() {
  if (!document.body.classList.contains("drawer-open")) return;
  document.body.classList.remove("drawer-open");
  $("#key-drawer").setAttribute("aria-hidden", "true");
  $("#key-drawer").inert = true;
  bankDesk.setDrawerOpen(false);
  $("#wallet-reveal").textContent = operatorKey ? "Reopen desk drawer" : "Open desk drawer";
  $("#wallet-reveal").focus();
}
$("#close-key").addEventListener("click", closeDrawer);
addEventListener("keydown", (event) => { if (event.key === "Escape") closeDrawer(); });
$("#copy-key").addEventListener("click", async () => {
  try { await navigator.clipboard.writeText(operatorKey); $("#copy-key").textContent = "Copied"; }
  catch { $("#copy-key").textContent = "Try again"; }
});

async function boot() {
  const ticket = new URLSearchParams(location.search).get("ticket");
  try {
    await establishSession(ticket);
    $("#error").textContent = "";
    history.replaceState({}, "", "/");
    await api("/api/ui-event", { method: "POST", body: JSON.stringify({ event: "app-boot" }) }).catch(() => {});
    if (navigator.webdriver) await api("/api/ui-event", { method: "POST", body: JSON.stringify({ event: "automation-present" }) }).catch(() => {});
    await refresh();
    setInterval(refresh, 2_500);
    const updateCountdown = () => {
      requestAnimationFrame(updateCountdown);
      const active = state?.batches.find((batch) => ["allocating", "allocated", "factory-failed"].includes(batch.status));
      if (active) updateProgress(active);
    };
    requestAnimationFrame(updateCountdown);
  } catch (error) { $("#error").textContent = error.message; dataReady = true; revealDesk(); }
}
boot();
