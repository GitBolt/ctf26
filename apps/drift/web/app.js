const elements = {
  sessionState: document.querySelector("#session-state"),
  sessionLabel: document.querySelector("#session-label"),
  notice: document.querySelector("#notice"),
  noticeTitle: document.querySelector("#notice-title"),
  noticeCopy: document.querySelector("#notice-copy"),
  workspace: document.querySelector("#workspace"),
  trace: document.querySelector("#trace-input"),
  replay: document.querySelector("#replay-button"),
  submit: document.querySelector("#submit-button"),
  resultPanel: document.querySelector("#result-panel"),
  resultLabel: document.querySelector("#result-label"),
  resultStatus: document.querySelector("#result-status"),
  resultOutput: document.querySelector("#result-output"),
};

function setNotice(kind, title, copy) {
  elements.notice.hidden = false;
  elements.notice.classList.toggle("error", kind === "error");
  elements.noticeTitle.textContent = title;
  elements.noticeCopy.textContent = copy;
  elements.sessionState.classList.toggle("ready", kind === "ready");
  elements.sessionState.classList.toggle("error", kind === "error");
  elements.sessionLabel.textContent = kind === "ready" ? "Participant session active" : kind === "error" ? "Launch required" : "Connecting";
}

async function jsonRequest(path, options = {}) {
  const response = await fetch(path, {
    credentials: "same-origin",
    ...options,
    headers: {
      ...(options.body ? { "content-type": "application/json" } : {}),
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { error: text || "The service returned an unreadable response." };
  }
  if (!response.ok) {
    const error = new Error(body.error || `Request failed with status ${response.status}.`);
    error.status = response.status;
    error.body = body;
    throw error;
  }
  return body;
}

async function establishSession() {
  const url = new URL(window.location.href);
  const ticket = url.searchParams.get("ticket");
  if (ticket) {
    url.searchParams.delete("ticket");
    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
    await jsonRequest("/api/session", {
      method: "POST",
      body: JSON.stringify({ ticket }),
    });
  } else {
    await jsonRequest("/api/session", {
      method: "POST",
      body: "{}",
    });
  }
  const target = await jsonRequest("/api/target");
  await jsonRequest("/api/ui-event", { method: "POST", body: JSON.stringify({ event: "page-ready" }) }).catch(() => {});
  if (navigator.webdriver) await jsonRequest("/api/ui-event", { method: "POST", body: JSON.stringify({ event: "automation-present" }) }).catch(() => {});
  return target;
}

function showTarget(target) {
  const fields = {
    "program-id": target.programId,
    "program-sha": target.programSha256,
    reserve: target.reserve,
    threshold: target.threshold,
    "starting-balance": target.attackerStartingBalance,
    "trace-limit": target.maxTraceSteps,
  };
  for (const [id, value] of Object.entries(fields)) {
    document.getElementById(id).textContent = value ?? "—";
  }
  elements.workspace.hidden = false;
  setNotice("ready", "Canonical participant target loaded", "The artifact hash and every replay below are bound to this environment.");
}

function parseTrace() {
  let value;
  try {
    value = JSON.parse(elements.trace.value);
  } catch {
    throw new Error("Submission JSON is not valid. Check commas, quotes, and brackets.");
  }
  if (!value || typeof value !== "object" || Array.isArray(value) || !Array.isArray(value.steps)) {
    throw new Error('Submission must be an object containing a "steps" array.');
  }
  return { steps: value.steps };
}

function showResult(kind, body, error = false) {
  elements.resultPanel.hidden = false;
  elements.resultLabel.textContent = kind === "submit" ? "Scored submission" : "Replay output";
  elements.resultStatus.textContent = error ? "Rejected" : body.flag ? "Solved" : "Complete";
  elements.resultStatus.classList.toggle("error", error);
  elements.resultOutput.textContent = JSON.stringify(body, null, 2);
  elements.resultPanel.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "nearest" });
}

async function run(kind) {
  const button = kind === "submit" ? elements.submit : elements.replay;
  const label = button.querySelector("[data-button-label]");
  elements.replay.disabled = true;
  elements.submit.disabled = true;
  const original = label.textContent;
  label.textContent = kind === "submit" ? "Checking trace…" : "Running replay…";
  try {
    await jsonRequest("/api/ui-event", { method: "POST", body: JSON.stringify({ event: `${kind}-click` }) }).catch(() => {});
    const body = parseTrace();
    const result = await jsonRequest(`/api/${kind}`, {
      method: "POST",
      body: JSON.stringify(body),
    });
    showResult(kind, result);
  } catch (error) {
    showResult(kind, error.body || { ok: false, error: error.message }, true);
  } finally {
    label.textContent = original;
    elements.replay.disabled = false;
    elements.submit.disabled = false;
  }
}

elements.replay.addEventListener("click", () => run("replay"));
elements.submit.addEventListener("click", () => run("submit"));
document.querySelector('a[href="/artifact/drift_vault.so"]')?.addEventListener("click", () => {
  void jsonRequest("/api/ui-event", { method: "POST", body: JSON.stringify({ event: "artifact-click" }) }).catch(() => {});
});
document.querySelector('a[href="/artifact/player-guide.md"]')?.addEventListener("click", () => {
  void jsonRequest("/api/ui-event", { method: "POST", body: JSON.stringify({ event: "guide-click" }) }).catch(() => {});
});

establishSession()
  .then(showTarget)
  .catch((error) => {
    elements.workspace.hidden = true;
    setNotice(
      "error",
      "Launch DRIFT from the challenge board",
      error.status === 409
        ? "This launch ticket was already used. Return to the board and open DRIFT again."
        : "Your participant session is missing or expired. Return to the event board for a fresh launch.",
    );
  });
