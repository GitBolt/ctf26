const state = {
  identity: null,
  target: null,
  archive: [],
  selectedArchivePath: null,
  toastTimer: null,
};

const elements = Object.fromEntries([
  "archive-files",
  "archive-heading",
  "archive-panel",
  "archive-search",
  "close-archive",
  "close-solve-dialog",
  "connection-status",
  "copy-flag",
  "document-viewer",
  "escrow-account-short",
  "escrow-balance",
  "flag-output",
  "global-message",
  "manifest-list",
  "objective-state",
  "open-archive",
  "preview-note",
  "refresh-target",
  "reserve-account-short",
  "reserve-balance",
  "signature-error",
  "solve-dialog",
  "solve-summary",
  "submission-form",
  "submit-transaction",
  "team-label",
  "threshold-value",
  "toast",
  "transaction-signature",
].map((id) => [id, document.getElementById(id)]));

boot();

async function boot() {
  bindInteractions();
  const ticket = new URL(location.href).searchParams.get("ticket");
  if (ticket) {
    setConnection("connecting", "Opening assignment");
    try {
      await api("/api/session", { method: "POST", body: { ticket } });
      const clean = new URL(location.href);
      clean.searchParams.delete("ticket");
      history.replaceState({}, "", clean.pathname + clean.search + clean.hash);
    } catch (error) {
      showFatal(error.message);
      return;
    }
  }
  await loadTarget();
}

function bindInteractions() {
  elements["refresh-target"].addEventListener("click", loadTarget);
  elements["open-archive"].addEventListener("click", openArchive);
  elements["close-archive"].addEventListener("click", closeArchive);
  elements["archive-search"].addEventListener("input", renderArchiveFiles);
  elements["submission-form"].addEventListener("submit", submitTransaction);
  elements["transaction-signature"].addEventListener("input", clearFieldError);
  elements["copy-flag"].addEventListener("click", () => copyText(elements["flag-output"].value, "Flag copied"));
  elements["close-solve-dialog"].addEventListener("click", () => elements["solve-dialog"].close());
  elements["solve-dialog"].addEventListener("click", (event) => {
    if (event.target === elements["solve-dialog"]) elements["solve-dialog"].close();
  });
}

async function loadTarget() {
  elements["refresh-target"].classList.add("is-spinning");
  elements["refresh-target"].disabled = true;
  setConnection("connecting", "Refreshing");
  try {
    const data = await api("/api/target");
    state.identity = data.identity;
    state.target = data.target;
    renderTarget();
    elements["global-message"].hidden = true;
    setConnection(data.target.state.status === "ready" ? "ready" : "error", data.target.state.status === "ready" ? "Target online" : "State unavailable");
  } catch (error) {
    setConnection("error", "Connection failed");
    showFatal(error.message);
  } finally {
    elements["refresh-target"].classList.remove("is-spinning");
    elements["refresh-target"].disabled = false;
  }
}

function renderTarget() {
  const target = state.target;
  const { tokenSymbol, decimals } = target;
  elements["team-label"].textContent = `Team ${state.identity.teamId}`;
  elements["threshold-value"].textContent = `${formatToken(target.thresholdRaw, decimals)} ${tokenSymbol}`;
  elements["objective-state"].textContent = target.state.status === "ready" ? "Finalized state is available" : "Live balance read unavailable";
  elements["reserve-balance"].textContent = target.state.reserveRaw === null ? "Unavailable" : `${formatToken(target.state.reserveRaw, decimals)} ${tokenSymbol}`;
  elements["escrow-balance"].textContent = target.state.escrowRaw === null ? "Unavailable" : `${formatToken(target.state.escrowRaw, decimals)} ${tokenSymbol}`;
  elements["reserve-account-short"].textContent = shortAddress(target.reserveAccount);
  elements["escrow-account-short"].textContent = shortAddress(target.escrowAccount);
  elements["preview-note"].hidden = !target.preview;

  const rows = [
    ["Program ID", target.programId, true],
    ["Build fingerprint", target.buildFingerprint, false],
    ["Vault account", target.vaultAccount, true],
    ["Vault authority", target.vaultAuthority, true],
    ["Reserve account", target.reserveAccount, true],
    ["Team escrow", target.escrowAccount, true],
    ["Challenge mint", target.mint, true],
  ];
  elements["manifest-list"].replaceChildren(...rows.map(([label, value, explorer]) => manifestRow(label, value, explorer)));
  elements["manifest-list"].setAttribute("aria-busy", "false");
}

function manifestRow(label, value, explorer) {
  const row = document.createElement("div");
  row.className = "manifest-row";
  const term = document.createElement("dt");
  term.textContent = label;
  const definition = document.createElement("dd");
  const text = explorer ? document.createElement("a") : document.createElement("span");
  text.className = "manifest-value";
  text.textContent = value;
  text.title = value;
  if (explorer) {
    text.classList.add("manifest-link");
    text.href = explorerUrl(value);
    text.target = "_blank";
    text.rel = "noreferrer";
  }
  const copy = document.createElement("button");
  copy.type = "button";
  copy.className = "copy-button";
  copy.textContent = "Copy";
  copy.setAttribute("aria-label", `Copy ${label}`);
  copy.addEventListener("click", () => copyText(value, `${label} copied`));
  definition.append(text, copy);
  row.append(term, definition);
  return row;
}

function explorerUrl(address) {
  const target = state.target;
  const url = new URL(`https://explorer.solana.com/address/${address}`);
  if (target.explorerCluster && target.explorerCluster !== "mainnet-beta") url.searchParams.set("cluster", target.explorerCluster);
  if (target.explorerCluster === "custom" && target.publicRpcUrl) url.searchParams.set("customUrl", target.publicRpcUrl);
  return url.toString();
}

async function openArchive() {
  elements["archive-panel"].hidden = false;
  elements["archive-panel"].scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth", block: "start" });
  if (state.archive.length) return;
  elements["archive-files"].setAttribute("aria-busy", "true");
  try {
    const data = await api("/api/archive");
    state.archive = data.files;
    renderArchiveFiles();
    const readme = state.archive.find((file) => file.path === "README.md") || state.archive[0];
    if (readme) await loadArchiveFile(readme.path);
  } catch (error) {
    showToast(error.message);
  } finally {
    elements["archive-files"].setAttribute("aria-busy", "false");
  }
}

function closeArchive() {
  elements["archive-panel"].hidden = true;
  elements["open-archive"].focus();
}

function renderArchiveFiles() {
  const query = elements["archive-search"].value.trim().toLowerCase();
  const visible = state.archive.filter((file) => `${file.title} ${file.path} ${file.category}`.toLowerCase().includes(query));
  const categories = [...new Set(visible.map((file) => file.category))];
  elements["archive-files"].replaceChildren(...categories.map((category) => {
    const group = document.createElement("div");
    group.className = "archive-group";
    const title = document.createElement("span");
    title.className = "archive-group-title";
    title.textContent = category;
    group.append(title);
    for (const file of visible.filter((entry) => entry.category === category)) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "archive-file";
      if (file.path === state.selectedArchivePath) button.setAttribute("aria-current", "page");
      const name = document.createElement("strong");
      name.textContent = file.title;
      const pathText = document.createElement("small");
      pathText.textContent = file.path;
      button.append(name, pathText);
      button.addEventListener("click", () => loadArchiveFile(file.path));
      group.append(button);
    }
    return group;
  }));
}

async function loadArchiveFile(path) {
  state.selectedArchivePath = path;
  renderArchiveFiles();
  elements["document-viewer"].setAttribute("aria-busy", "true");
  try {
    const data = await api(`/api/archive?path=${encodeURIComponent(path)}`);
    renderDocument(data.file);
    elements["document-viewer"].focus({ preventScroll: true });
  } catch (error) {
    showToast(error.message);
  } finally {
    elements["document-viewer"].setAttribute("aria-busy", "false");
  }
}

function renderDocument(file) {
  const header = document.createElement("header");
  header.className = "document-header";
  const pathText = document.createElement("span");
  pathText.textContent = file.path;
  const title = document.createElement("h3");
  title.textContent = file.title;
  header.append(pathText, title);
  const body = document.createElement("div");
  body.className = "document-body";
  if (/\.(rs|diff|toml)$/.test(file.path)) {
    const pre = document.createElement("pre");
    const code = document.createElement("code");
    code.textContent = file.content;
    pre.append(code);
    body.append(pre);
  } else if (file.path.endsWith(".json")) {
    const pre = document.createElement("pre");
    const code = document.createElement("code");
    try { code.textContent = JSON.stringify(JSON.parse(file.content), null, 2); }
    catch { code.textContent = file.content; }
    pre.append(code);
    body.append(pre);
  } else {
    renderMarkdown(file.content, body);
  }
  elements["document-viewer"].replaceChildren(header, body);
  elements["document-viewer"].scrollTop = 0;
}

function renderMarkdown(markdown, root) {
  const lines = markdown.split("\n");
  let index = 0;
  let paragraph = [];
  const flushParagraph = () => {
    if (!paragraph.length) return;
    const p = document.createElement("p");
    appendInlineText(p, paragraph.join(" "));
    root.append(p);
    paragraph = [];
  };
  while (index < lines.length) {
    const line = lines[index];
    if (line.startsWith("```")) {
      flushParagraph();
      const codeLines = [];
      index += 1;
      while (index < lines.length && !lines[index].startsWith("```")) codeLines.push(lines[index++]);
      const pre = document.createElement("pre");
      const code = document.createElement("code");
      code.textContent = codeLines.join("\n");
      pre.append(code);
      root.append(pre);
    } else if (/^#{1,4}\s/.test(line)) {
      flushParagraph();
      const level = Math.min(4, line.match(/^#+/)[0].length + 1);
      const heading = document.createElement(`h${level}`);
      heading.textContent = line.replace(/^#{1,4}\s+/, "");
      root.append(heading);
    } else if (line.startsWith("> ")) {
      flushParagraph();
      const quote = document.createElement("blockquote");
      appendInlineText(quote, line.slice(2));
      root.append(quote);
    } else if (/^-\s+/.test(line)) {
      flushParagraph();
      const list = document.createElement("ul");
      while (index < lines.length && /^-\s+/.test(lines[index])) {
        const item = document.createElement("li");
        appendInlineText(item, lines[index].replace(/^-\s+/, ""));
        list.append(item);
        index += 1;
      }
      root.append(list);
      index -= 1;
    } else if (line.trim() === "") {
      flushParagraph();
    } else {
      paragraph.push(line.trim());
    }
    index += 1;
  }
  flushParagraph();
}

function appendInlineText(parent, text) {
  const pieces = text.split(/(`[^`]+`)/g);
  for (const piece of pieces) {
    if (piece.startsWith("`") && piece.endsWith("`")) {
      const code = document.createElement("code");
      code.textContent = piece.slice(1, -1);
      parent.append(code);
    } else {
      parent.append(document.createTextNode(piece));
    }
  }
}

async function submitTransaction(event) {
  event.preventDefault();
  clearFieldError();
  const signature = elements["transaction-signature"].value.trim();
  if (!signature) {
    showFieldError("Enter the transaction signature to verify.");
    return;
  }
  const button = elements["submit-transaction"];
  button.disabled = true;
  button.querySelector("span").textContent = "Verifying…";
  try {
    const data = await api("/api/submit", { method: "POST", body: { signature } });
    const result = data.result;
    elements["flag-output"].value = result.flag;
    elements["solve-summary"].textContent = `${formatToken(result.reserveDeltaRaw, state.target.decimals)} ${state.target.tokenSymbol} moved into the registered team escrow.`;
    if (typeof elements["solve-dialog"].showModal === "function") elements["solve-dialog"].showModal();
    else elements["solve-dialog"].setAttribute("open", "");
    await loadTarget();
  } catch (error) {
    showFieldError(error.message);
  } finally {
    button.disabled = false;
    button.querySelector("span").textContent = "Verify recovery";
  }
}

function showFieldError(message) {
  elements["signature-error"].textContent = message;
  elements["signature-error"].hidden = false;
  elements["transaction-signature"].setAttribute("aria-invalid", "true");
  elements["transaction-signature"].focus();
}

function clearFieldError() {
  elements["signature-error"].hidden = true;
  elements["transaction-signature"].removeAttribute("aria-invalid");
}

function showFatal(message) {
  elements["global-message"].textContent = message;
  elements["global-message"].hidden = false;
}

function setConnection(stateName, label) {
  elements["connection-status"].dataset.state = stateName;
  elements["connection-status"].lastChild.textContent = label;
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
    throw new Error("The challenge service is unreachable.");
  }
  let data;
  try { data = await response.json(); }
  catch { throw new Error("The challenge service returned an unreadable response."); }
  if (!response.ok) throw new Error(data.error?.message || "The request could not be completed.");
  return data;
}

function formatToken(raw, decimals) {
  if (raw === null || raw === undefined) return "—";
  const negative = String(raw).startsWith("-");
  const digits = String(raw).replace("-", "").padStart(decimals + 1, "0");
  const whole = decimals ? digits.slice(0, -decimals) : digits;
  const fraction = decimals ? digits.slice(-decimals).replace(/0+$/, "") : "";
  const formattedWhole = new Intl.NumberFormat("en-US").format(BigInt(whole));
  return `${negative ? "−" : ""}${formattedWhole}${fraction ? `.${fraction}` : ""}`;
}

function shortAddress(value) {
  return value ? `${value.slice(0, 7)}…${value.slice(-6)}` : "—";
}

async function copyText(value, message) {
  try {
    await navigator.clipboard.writeText(value);
    showToast(message);
  } catch {
    showToast("Copy is unavailable in this browser.");
  }
}

function showToast(message) {
  clearTimeout(state.toastTimer);
  elements.toast.textContent = message;
  elements.toast.hidden = false;
  state.toastTimer = setTimeout(() => { elements.toast.hidden = true; }, 2_400);
}

function reducedMotion() {
  return matchMedia("(prefers-reduced-motion: reduce)").matches;
}
