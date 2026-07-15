const state = { config: null, provider: null, pubkey: "", signature: "", authorization: null, receipts: [] };
const $ = (id) => document.getElementById(id);

async function request(path, init = {}) {
  const response = await fetch(path, { cache: "no-store", ...init, headers: { ...(init.headers || {}) } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) { const error = new Error(body.error || `request failed (${response.status})`); error.status = response.status; error.body = body; throw error; }
  return body;
}

function setStatus(message, kind = "") { $("status").textContent = message; $("status").className = `status ${kind}`; }
function bytesToBase64(bytes) { let binary = ""; for (const byte of bytes) binary += String.fromCharCode(byte); return btoa(binary); }
function utf8(value) { return new TextEncoder().encode(value); }
function hex(bytes) { return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join(""); }

async function load() {
  try {
    state.config = await request("/api/config");
    $("message").textContent = state.config.message;
    if (state.config.completed) setStatus("This team instance is already complete.", "success");
  } catch (error) { setStatus(error.message, "error"); }
}

async function connect() {
  const provider = window.phantom?.solana || window.solana;
  if (!provider?.connect || !provider?.signMessage) return setStatus("A Solana wallet extension with message signing is required.", "error");
  try {
    const result = await provider.connect();
    state.provider = provider;
    state.pubkey = (result.publicKey || provider.publicKey).toString();
    $("connect").textContent = `${state.pubkey.slice(0, 5)}…${state.pubkey.slice(-4)}`;
    $("sign").disabled = false;
    setStatus("Wallet connected. Review and sign the instance message.");
  } catch (error) { setStatus(error.message || "Wallet connection was rejected.", "error"); }
}

async function signAuthorization() {
  try {
    const signed = await state.provider.signMessage(utf8(state.config.message), "utf8");
    state.signature = bytesToBase64(signed.signature);
    state.authorization = { pubkey: state.pubkey, message: state.config.message, signature: state.signature };
    $("claim-json").value = JSON.stringify(state.authorization, null, 2);
    $("authorization").classList.remove("hidden");
    $("claim").disabled = false;
    setStatus("Signed claim loaded into the workbench. You may edit it before submitting.");
  } catch (error) { setStatus(error.message || "Message signing was rejected.", "error"); }
}

async function sha256(value) { return new Uint8Array(await crypto.subtle.digest("SHA-256", typeof value === "string" ? utf8(value) : value)); }
function zeroBits(bytes) { let count = 0; for (const byte of bytes) { if (byte === 0) { count += 8; continue; } count += Math.clz32(byte) - 24; break; } return count; }

async function solvePow(body) {
  const pow = await request("/api/pow");
  const canonical = JSON.stringify({ pubkey: body.pubkey, message: body.message, signature: body.signature });
  const bodyHash = hex(await sha256(canonical));
  for (let start = 0; ; start += 128) {
    const candidates = Array.from({ length: 128 }, (_, offset) => start + offset);
    const hashes = await Promise.all(candidates.map((nonce) => sha256(`${pow.challenge}:${nonce}:${bodyHash}`)));
    const index = hashes.findIndex((digest) => zeroBits(digest) >= pow.bits);
    if (index >= 0) return `${pow.challenge}:${candidates[index]}`;
    if (start % 4096 === 0) setStatus(`Computing one-time claim proof… ${start.toLocaleString()} attempts`);
  }
}

async function submitClaim() {
  $("claim").disabled = true;
  try {
    const edited = JSON.parse($("claim-json").value);
    const body = {
      pubkey: String(edited.pubkey || ""),
      message: String(edited.message || ""),
      signature: String(edited.signature || ""),
    };
    const proof = await solvePow(body);
    const result = await request("/api/claim", { method: "POST", headers: { "content-type": "application/json", "x-pow": proof }, body: JSON.stringify(body) });
    state.receipts.push(result.id);
    renderReceipts();
    $("receipt").value = result.id;
    decodeCurrentReceipt();
    setStatus("Claim accepted. A protocol receipt was issued.", "success");
  } catch (error) { setStatus(error.message, "error"); }
  finally { $("claim").disabled = false; }
}

const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function decodeBase58(value) {
  let number = 0n;
  for (const character of value.trim()) { const digit = ALPHABET.indexOf(character); if (digit < 0) throw new Error("Receipt is not valid Base58."); number = number * 58n + BigInt(digit); }
  const bytes = [];
  while (number > 0n) { bytes.push(Number(number & 255n)); number >>= 8n; }
  bytes.reverse();
  for (const character of value.trim()) { if (character !== "1") break; bytes.unshift(0); }
  return new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array(bytes));
}
function decodeCurrentReceipt() {
  const output = $("decoded");
  output.replaceChildren();
  try {
    const record = decodeBase58($("receipt").value);
    output.textContent = record;
  } catch (error) { output.textContent = error.message; }
}
function renderReceipts() {
  const list = $("receipts");
  list.replaceChildren(...state.receipts.map((receipt) => { const item = document.createElement("li"); item.textContent = receipt; return item; }));
}

$("connect").addEventListener("click", connect);
$("sign").addEventListener("click", signAuthorization);
$("claim").addEventListener("click", submitClaim);
$("decode").addEventListener("click", decodeCurrentReceipt);
$("copy-auth").addEventListener("click", async () => { await navigator.clipboard.writeText($("claim-json").value); $("copy-auth").textContent = "Copied"; });
load();
