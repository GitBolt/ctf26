const $ = (selector) => document.querySelector(selector);
let state;
const SESSION_ATTEMPTS = 12;

const explorer = (kind, value) => `https://explorer.solana.com/${kind}/${value}?cluster=devnet`;

async function call(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { "content-type": "application/json", "x-second-key-ui": "desk", ...(options.headers || {}) } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(body.error || `Request failed with ${response.status}`);
    error.status = response.status;
    error.retryAfterSeconds = Number(response.headers.get("retry-after")) || 2;
    throw error;
  }
  return body;
}

async function establishSession(ticket) {
  for (let attempt = 1; attempt <= SESSION_ATTEMPTS; attempt += 1) {
    try {
      return await call("/api/session", { method: "POST", body: JSON.stringify(ticket ? { ticket } : {}) });
    } catch (error) {
      if (error.status !== 429) throw error;
      if (attempt === SESSION_ATTEMPTS) throw new Error("The event desk is still busy. No launch was created. Return to the portal and try again.");
      const delaySeconds = Math.min(5, Math.max(1, error.retryAfterSeconds));
      $("#notice").textContent = `The event desk is busy. Retrying in ${delaySeconds} seconds.`;
      await new Promise((resolve) => setTimeout(resolve, delaySeconds * 1_000));
    }
  }
}

async function boot() {
  const ticket = new URLSearchParams(location.search).get("ticket");
  await establishSession(ticket);
  history.replaceState({}, "", location.pathname);
  await call("/api/ui-event", { method: "POST", body: JSON.stringify({ event: "app-boot" }) }).catch(() => {});
  if (navigator.webdriver) await call("/api/ui-event", { method: "POST", body: JSON.stringify({ event: "automation-present" }) }).catch(() => {});
  await refresh();
}

async function refresh() {
  state = await call("/api/state");
  render();
}

function render() {
  const custody = state.completedAt ? "recovered" : state.vaultBalance === 1 ? "vault" : "owner";
  document.body.dataset.custody = custody;
  $("#wallet").textContent = state.wallet;
  $("#mint").textContent = state.mint;
  $("#source").textContent = state.source;
  $("#vaultAuthority").textContent = state.vaultAuthority;
  $("#vault").textContent = state.vault;
  $("#loan").textContent = state.loan;
  $("#programId").textContent = state.programId;
  $("#sourceBalance").textContent = `${state.sourceBalance} receipt held`;
  $("#vaultBalance").textContent = `${state.vaultBalance} receipt held`;
  $("#loanState").textContent = state.outstanding ? "Advance outstanding" : "Not drawn";
  $("#caseState").textContent = state.completedAt ? "Custody failure confirmed" : state.outstanding ? "Loan active" : "Ready for pledge";
  $("#pledgeButton").disabled = Boolean(state.pledgeSignature);
  $("#pledgeButton span").textContent = state.pledgeSignature ? "Receipt pledged" : "Pledge receipt";
  if (state.pledgeSignature) {
    $("#transactionRow").classList.remove("is-hidden");
    $("#transaction").textContent = state.pledgeSignature;
    $("#transactionLink").href = explorer("tx", state.pledgeSignature);
  }
  if (state.completedAt) {
    $("#notice").textContent = "Verified on Devnet. The receipt is back and the advance remains open.";
  } else if (state.outstanding) {
    $("#notice").textContent = "Advance released. The receipt is now inside the lender vault.";
  } else {
    $("#notice").textContent = "Your Lot 22 receipt is ready.";
  }
}

$("#pledgeButton").addEventListener("click", async () => {
  const button = $("#pledgeButton");
  button.disabled = true;
  $("#notice").textContent = "Recording the pledge on Devnet.";
  try { await call("/api/pledge", { method: "POST", body: "{}" }); await refresh(); }
  catch (error) { $("#notice").textContent = error.message; button.disabled = false; }
});

$("#noteButton").addEventListener("click", () => $("#noteDialog").showModal());
$("#chainButton").addEventListener("click", () => $("#chainDialog").showModal());

$("#keyButton").addEventListener("click", async () => {
  try {
    const result = await call("/api/wallet-keypair");
    $("#walletKeypair").value = JSON.stringify(result.secretKey);
    $("#keyDialog").showModal();
  } catch (error) { $("#notice").textContent = error.message; }
});

$("#copyKey").addEventListener("click", async () => { await navigator.clipboard.writeText($("#walletKeypair").value); $("#copyKey span").textContent = "Copied"; });
document.addEventListener("click", async (event) => {
  const button = event.target.closest(".copy-address");
  if (!button) return;
  const value = button.dataset.value || state?.[button.dataset.copy];
  if (!value) return;
  await navigator.clipboard.writeText(value);
  if (button.dataset.copy) { const before = button.textContent; button.textContent = "copied"; setTimeout(() => { button.textContent = before; }, 900); }
});

boot().catch((error) => { $("#notice").textContent = error.message; document.body.dataset.custody = "owner"; });
setInterval(() => { if (state?.pledgeSignature && !state.completedAt) refresh().catch(() => {}); }, 4500);
