const SESSION_ATTEMPTS = 12;
const POLL_INTERVAL_MS = 5_000;

const $ = (selector) => document.querySelector(selector);
const pills = {
  first: $('[data-pill="first"]'),
  second: $('[data-pill="second"]'),
  third: $('[data-pill="third"]'),
};

async function call(path, init = {}) {
  const response = await fetch(path, {
    ...init,
    headers: {
      accept: "application/json",
      "x-the-chamber-ui": "chamber",
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...(init.headers || {}),
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(body.error || `request failed with ${response.status}`);
    error.status = response.status;
    error.retryAfterSeconds = Number(response.headers.get("retry-after")) || 1;
    throw error;
  }
  return body;
}

async function establishSession(ticket) {
  for (let attempt = 1; attempt <= SESSION_ATTEMPTS; attempt += 1) {
    try {
      return await call("/api/session", {
        method: "POST",
        body: JSON.stringify(ticket ? { ticket } : {}),
      });
    } catch (error) {
      if (error.status !== 429) throw error;
      if (attempt === SESSION_ATTEMPTS) {
        throw new Error("The chamber is still busy. No launch was created. Return to the portal and try again.");
      }
      const delaySeconds = Math.min(5, Math.max(1, error.retryAfterSeconds));
      await new Promise((resolve) => setTimeout(resolve, delaySeconds * 1_000));
    }
  }
  throw new Error("The chamber is unavailable.");
}

function note(id, message, isError = false) {
  const element = $(id);
  element.textContent = message;
  element.classList.toggle("err", isError);
}

function render(state) {
  $("#program-note").textContent = `Program ${state.programId} on ${state.network}.`;
  if (!state.registered) {
    $("#locks").hidden = true;
    $("#done").hidden = true;
    return;
  }
  $("#setup").querySelector("input").disabled = true;
  $("#register").disabled = true;
  $("#locks").hidden = false;
  note("#setup-note", `Account ${state.pda} is open for ${state.wallet}.`);

  const locks = state.locks || {};
  for (const [name, unlocked] of [
    ["first", locks.firstUnlock],
    ["second", locks.secondUnlock],
    ["third", locks.thirdUnlock],
  ]) {
    pills[name].textContent = unlocked ? "open" : "locked";
    pills[name].classList.toggle("open", Boolean(unlocked));
  }

  if (locks.chamberOpen) {
    $("#done").hidden = false;
    note("#lock-note", "All three locks are open.");
  } else {
    note("#lock-note", "Locks are read live from the chain; this page refreshes on its own.");
  }
}

async function refresh() {
  try {
    render(await call("/api/state"));
  } catch (error) {
    note("#lock-note", error.message, true);
  }
}

async function register() {
  const wallet = $("#wallet").value.trim();
  if (!wallet) return note("#setup-note", "Enter the wallet address you will sign with.", true);
  $("#register").disabled = true;
  try {
    render(await call("/api/register", { method: "POST", body: JSON.stringify({ wallet }) }));
    await refresh();
  } catch (error) {
    $("#register").disabled = false;
    note("#setup-note", error.message, true);
  }
}

async function boot() {
  const ticket = new URLSearchParams(location.search).get("ticket");
  try {
    await establishSession(ticket);
  } catch (error) {
    return note("#program-note", error.message, true);
  }
  history.replaceState({}, "", location.pathname);
  await call("/api/ui-event", { method: "POST", body: JSON.stringify({ event: "app-boot" }) }).catch(() => {});
  if (navigator.webdriver) {
    await call("/api/ui-event", { method: "POST", body: JSON.stringify({ event: "automation-present" }) }).catch(() => {});
  }
  $("#register").addEventListener("click", register);
  await refresh();
  setInterval(refresh, POLL_INTERVAL_MS);
}

boot();
