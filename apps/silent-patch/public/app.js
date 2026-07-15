const state = { identity: null, target: null };

const elements = Object.fromEntries([
  "connection-status",
  "copy-flag",
  "flag-output",
  "global-message",
  "preview-note",
  "signature-error",
  "solve-summary",
  "submission-form",
  "submit-transaction",
  "success-result",
  "target-manifest",
  "team-label",
  "transaction-signature",
].map((id) => [id, document.getElementById(id)]));

boot();

async function boot() {
  elements["submission-form"].addEventListener("submit", submitTransaction);
  elements["transaction-signature"].addEventListener("input", clearError);
  elements["copy-flag"].addEventListener("click", copyFlag);

  const ticket = new URL(location.href).searchParams.get("ticket");
  if (ticket) {
    try {
      await api("/api/session", { method: "POST", body: { ticket } });
      const clean = new URL(location.href);
      clean.searchParams.delete("ticket");
      history.replaceState({}, "", clean.pathname + clean.search + clean.hash);
    } catch (error) {
      fail(error.message);
      return;
    }
  }

  try {
    const data = await api("/api/target");
    state.identity = data.identity;
    state.target = data.target;
    renderAssignment();
    setStatus(data.target.state.status === "ready" ? "ready" : "error", data.target.state.status === "ready" ? "Ready" : "Unavailable");
  } catch (error) {
    fail(error.message);
  }
}

function renderAssignment() {
  const target = state.target;
  elements["team-label"].textContent = state.identity.teamId;
  elements["preview-note"].hidden = !target.preview;
  const rows = [
    ["Program", target.programId],
    ["Vault", target.vaultAccount],
    ["Authority", target.vaultAuthority],
    ["Reserve", target.reserveAccount],
    ["Escrow", target.escrowAccount],
    ["Mint", target.mint],
    ["Minimum", `${target.thresholdRaw} raw ${target.tokenSymbol}`],
    ["Build", target.buildFingerprint],
  ];
  elements["target-manifest"].replaceChildren(...rows.map(([label, value]) => assignmentRow(label, value)));
  elements["target-manifest"].setAttribute("aria-busy", "false");
}

function assignmentRow(label, value) {
  const row = document.createElement("div");
  const term = document.createElement("dt");
  const definition = document.createElement("dd");
  const code = document.createElement("code");
  const copy = document.createElement("button");
  term.textContent = label;
  code.textContent = value;
  copy.type = "button";
  copy.textContent = "copy";
  copy.setAttribute("aria-label", `Copy ${label}`);
  copy.addEventListener("click", () => copyText(value, copy));
  definition.append(code, copy);
  row.append(term, definition);
  return row;
}

async function submitTransaction(event) {
  event.preventDefault();
  clearError();
  elements["success-result"].hidden = true;
  const signature = elements["transaction-signature"].value.trim();
  if (!signature) {
    showError("Enter a transaction signature.");
    return;
  }

  const button = elements["submit-transaction"];
  button.disabled = true;
  button.querySelector("span").textContent = "Checking…";
  try {
    const { result } = await api("/api/submit", { method: "POST", body: { signature } });
    elements["flag-output"].value = result.flag;
    elements["solve-summary"].textContent = "The submitted transaction satisfies the assigned target.";
    elements["success-result"].hidden = false;
    elements["success-result"].scrollIntoView({ behavior: "smooth", block: "nearest" });
  } catch (error) {
    showError(error.message);
  } finally {
    button.disabled = false;
    button.querySelector("span").textContent = "Verify transaction";
  }
}

function showError(message) {
  elements["signature-error"].textContent = message;
  elements["signature-error"].hidden = false;
  elements["transaction-signature"].setAttribute("aria-invalid", "true");
  elements["transaction-signature"].focus();
}

function clearError() {
  elements["signature-error"].hidden = true;
  elements["transaction-signature"].removeAttribute("aria-invalid");
}

function fail(message) {
  setStatus("error", "Unavailable");
  elements["global-message"].textContent = message;
  elements["global-message"].hidden = false;
}

function setStatus(name, label) {
  elements["connection-status"].dataset.state = name;
  elements["connection-status"].lastChild.textContent = label;
}

async function copyFlag() {
  await copyText(elements["flag-output"].value, elements["copy-flag"]);
}

async function copyText(value, button) {
  const label = button.textContent;
  try {
    await navigator.clipboard.writeText(value);
    button.textContent = "copied";
  } catch {
    button.textContent = "select";
  }
  setTimeout(() => { button.textContent = label; }, 1_300);
}

async function api(url, options = {}) {
  const init = {
    method: options.method || "GET",
    credentials: "same-origin",
    headers: { accept: "application/json" },
  };
  if (options.body) {
    init.headers["content-type"] = "application/json";
    init.body = JSON.stringify(options.body);
  }
  let response;
  try {
    response = await fetch(url, init);
  } catch {
    throw new Error("Challenge service unreachable.");
  }
  let data;
  try { data = await response.json(); }
  catch { throw new Error("Unreadable checker response."); }
  if (!response.ok) throw new Error(data.error?.message || "Verification failed.");
  return data;
}
