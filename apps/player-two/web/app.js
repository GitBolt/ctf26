const $ = (selector) => document.querySelector(selector);
const state = { cabinet: null, leftPass: null, rightPass: null, scanned: null, celebrated: false, alertTimer: null };
const headers = { "content-type": "application/json", "x-player-two-ui": "cabinet" };
const SESSION_ATTEMPTS = 12;

async function api(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { ...headers, ...(options.headers || {}) } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(body.error || body.message || "Cabinet request failed"), {
    body,
    status: response.status,
    retryAfterSeconds: Number(response.headers.get("retry-after")) || 2,
  });
  return body;
}

async function establishSession(ticket) {
  for (let attempt = 1; attempt <= SESSION_ATTEMPTS; attempt += 1) {
    try {
      return await api("/api/session", { method: "POST", body: JSON.stringify(ticket ? { ticket } : { participantId: "local-player" }) });
    } catch (error) {
      if (error.status !== 429) throw error;
      if (attempt === SESSION_ATTEMPTS) throw new Error("The cabinet desk is still busy. No launch was created. Return to the portal and try again.");
      const delaySeconds = Math.min(5, Math.max(1, error.retryAfterSeconds));
      $("#cabinet-status").textContent = "WAIT";
      $("#event-message").textContent = `The cabinet desk is busy. Retrying in ${delaySeconds} seconds.`;
      await new Promise((resolve) => setTimeout(resolve, delaySeconds * 1_000));
    }
  }
}

async function event(name, detail = "") { try { await api("/api/ui-event", { method: "POST", body: JSON.stringify({ event: name, detail }) }); } catch {} }
const short = (value) => value ? `${value.slice(0, 5)}…${value.slice(-5)}` : "••••••••";

async function boot() {
  const ticket = new URL(location.href).searchParams.get("ticket");
  try {
    await establishSession(ticket);
    if (ticket) history.replaceState({}, "", "/");
  } catch (error) {
    if (error.status !== 401 || ticket) return failBoot(error.message);
  }
  try {
    state.cabinet = await api("/api/cabinet");
    state.leftPass = state.cabinet.currentPass;
    state.rightPass = state.cabinet.currentPass;
    renderCabinet();
    await event("cabinet-ready");
    if (navigator.webdriver) await event("automation-present");
  } catch (error) { failBoot(error.message); }
}

function failBoot(message) {
  $("#cabinet-status").textContent = "OFFLINE";
  $("#event-message").textContent = message;
  $("#arcade").dataset.phase = "error";
}

function renderCabinet() {
  const current = state.cabinet.currentPass;
  $("#left-card-id").textContent = short(current);
  $("#right-card-id").textContent = short(state.rightPass);
  $("#right-generation").textContent = state.scanned ? `GEN 0${state.scanned.generation}` : "GEN 02";
  $("#receipt-signature").textContent = state.cabinet.receiptSignature;
  $("#cabinet-status").textContent = state.cabinet.opened ? "JACKPOT WON" : "READY";
  $("#arcade").dataset.phase = state.cabinet.opened ? "complete" : "ready";
  $("#right-card").classList.toggle("ghost", !state.scanned);
  $("#empty-mark").hidden = Boolean(state.scanned);
  $("#right-state").classList.toggle("ready", Boolean(state.scanned));
  $("#right-state").textContent = state.scanned ? "READY" : "WAITING";
  $("#second-signal").classList.toggle("on", Boolean(state.scanned));
  $("#player-count").textContent = state.scanned ? "2" : "1";
  if (state.cabinet.opened) {
    $("#mission-copy").textContent = "Both players verified. Jackpot awarded.";
    $("#event-message").textContent = `Completion ${state.cabinet.completionReceipt}`;
  }
}

$("#receipt-button").addEventListener("click", async () => {
  $("#receipt-dialog").showModal();
  $("#receipt-button").classList.add("pulled");
  $("#event-message").textContent = "A confirmed migration receipt slides free.";
  await event("receipt-pulled");
});

$("#copy-transaction").addEventListener("click", async () => {
  const signature = state.cabinet?.receiptSignature || "";
  try {
    await navigator.clipboard.writeText(signature);
    $("#copy-transaction").textContent = "COPIED";
    $("#event-message").textContent = "Transaction signature copied. Inspect the migration to find the pass account.";
  } catch {
    const range = document.createRange();
    range.selectNodeContents($("#receipt-signature"));
    const selection = getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    $("#copy-transaction").textContent = "SIGNATURE SELECTED";
  }
  setTimeout(() => { $("#copy-transaction").textContent = "COPY SIGNATURE"; }, 1600);
  await event("transaction-copied");
});

function celebrate() {
  if (state.celebrated) return;
  state.celebrated = true;
  $("#arcade").dataset.phase = "won";
  const sound = $("#jackpot-sound");
  sound.currentTime = 0;
  sound.play().catch(() => {});
  const field = $("#confetti-field");
  const colors = ["#1774c9", "#ff711c", "#ffd94c", "#ef5348", "#69c9b8"];
  const pieces = Array.from({ length: 72 }, (_, index) => {
    const piece = document.createElement("i");
    const angle = (index / 72) * Math.PI * 2;
    const distance = 180 + Math.random() * 520;
    piece.style.setProperty("--x", `${Math.cos(angle) * distance}px`);
    piece.style.setProperty("--y", `${Math.sin(angle) * distance - 90}px`);
    piece.style.setProperty("--r", `${Math.random() * 900 - 450}deg`);
    piece.style.setProperty("--delay", `${Math.random() * 180}ms`);
    piece.style.setProperty("--color", colors[index % colors.length]);
    return piece;
  });
  field.replaceChildren(...pieces);
  field.classList.add("active");
  setTimeout(() => {
    field.replaceChildren();
    $("#arcade").dataset.phase = "complete";
  }, 3000);
}

function primeJackpotSound() {
  const sound = $("#jackpot-sound");
  if (sound.dataset.primed === "true") return;
  sound.muted = true;
  sound.play().then(() => {
    sound.pause();
    sound.currentTime = 0;
    sound.muted = false;
    sound.dataset.primed = "true";
  }).catch(() => { sound.muted = false; });
}

function showGameAlert(title, copy) {
  clearTimeout(state.alertTimer);
  const alert = $("#game-alert");
  $("#game-alert-title").textContent = title;
  $("#game-alert-copy").textContent = copy;
  alert.hidden = false;
  alert.classList.remove("showing");
  void alert.offsetWidth;
  alert.classList.add("showing");
  state.alertTimer = setTimeout(() => {
    alert.hidden = true;
    alert.classList.remove("showing");
  }, 2400);
}

$("#scanner-button").addEventListener("click", async () => { $("#scanner-dialog").showModal(); await event("scanner-opened"); });
$("#scan-submit").addEventListener("click", scan);
$("#scan-address").addEventListener("keydown", (eventObject) => { if (eventObject.key === "Enter") scan(); });

async function scan() {
  const address = $("#scan-address").value.trim();
  if (!address) return;
  try {
    const result = await api("/api/scan", { method: "POST", body: JSON.stringify({ address }) });
    if (!result.found) {
      $("#scan-result").innerHTML = `<strong>NO PASS FOUND</strong><p>The membership program does not own this account.</p>`;
      return;
    }
    const matchLabel = result.authorityMatch ? "MEMBER MATCH" : "OTHER MEMBER";
    $("#scan-result").innerHTML = `<strong class="active-result">ACTIVE PASS</strong><span class="authority-state ${result.authorityMatch ? "match" : "other"}">${matchLabel}</span><dl><div><dt>GENERATION</dt><dd>0${Number(result.generation) || 0}</dd></div><div><dt>MEMBER AUTHORITY</dt><dd><code>${escapeHtml(result.holder)}</code></dd></div></dl><button id="seat-pass" type="button">SEAT IN READER 02</button>`;
    $("#seat-pass").addEventListener("click", async () => {
      state.scanned = result;
      state.rightPass = result.address;
      $("#scanner-dialog").close();
      renderCabinet();
      $("#event-message").textContent = `Generation 0${result.generation} pass seated in Reader 02.`;
      await event("reader-changed", `generation:${result.generation}`);
    });
  } catch (error) { $("#scan-result").innerHTML = `<strong>SCAN FAILED</strong><p>${escapeHtml(error.message)}</p>`; }
}

function escapeHtml(value) {
  return String(value || "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
}

$("#lever").addEventListener("click", async () => {
  if (!state.cabinet) return showGameAlert("CABINET OFFLINE", "Wait for the game to finish connecting.");
  if (state.cabinet.opened) return showGameAlert("JACKPOT CLAIMED", "This participant has already completed the cabinet.");
  if (!state.scanned) {
    const message = "Reader 02 needs an active member pass before the jackpot can start.";
    $("#arcade").dataset.phase = "rejected";
    $("#mission-copy").textContent = message;
    $("#event-message").textContent = message;
    showGameAlert("PLAYER 2 NOT READY", message);
    setTimeout(() => { if (!state.cabinet.opened) $("#arcade").dataset.phase = "ready"; }, 1100);
    return;
  }
  primeJackpotSound();
  $("#lever").classList.add("pulled");
  $("#arcade").dataset.phase = "checking";
  await event("lever-pulled");
  try {
    const result = await api("/api/jackpot", { method: "POST", body: JSON.stringify({ leftPass: state.leftPass, rightPass: state.rightPass, leftHolder: state.cabinet.holder, rightHolder: state.cabinet.holder }) });
    state.cabinet = { ...result.cabinet, completionReceipt: result.completionReceipt };
    $("#event-message").textContent = result.message;
    renderCabinet();
    celebrate();
  } catch (error) {
    if (error.body?.cabinet) state.cabinet = error.body.cabinet;
    $("#arcade").dataset.phase = "rejected";
    const message = error.body?.message || error.message;
    $("#mission-copy").textContent = message;
    $("#event-message").textContent = `Verification rejected: ${message}`;
    showGameAlert("NO JACKPOT", message);
    setTimeout(() => { if (!state.cabinet.opened) $("#arcade").dataset.phase = "ready"; }, 1100);
  } finally { setTimeout(() => $("#lever").classList.remove("pulled"), 550); }
});

boot();
