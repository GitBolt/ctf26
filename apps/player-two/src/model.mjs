import crypto from "node:crypto";

const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function base58(buffer) {
  let number = BigInt(`0x${buffer.toString("hex")}`);
  let output = "";
  while (number > 0n) {
    output = ALPHABET[Number(number % 58n)] + output;
    number /= 58n;
  }
  for (const byte of buffer) {
    if (byte !== 0) break;
    output = `1${output}`;
  }
  return output || "1";
}

function address(seed, teamId, eventNonce) {
  return base58(crypto.createHash("sha256").update(`player-two:v1:${seed}:${teamId}:${eventNonce}`).digest());
}

export function createInstance(teamId, eventNonce = crypto.randomBytes(12).toString("hex"), chain = {}) {
  const holder = chain.holder || address("holder", teamId, eventNonce);
  const previousPass = chain.previousPass || address("pass:1", teamId, eventNonce);
  const currentPass = chain.currentPass || address("pass:2", teamId, eventNonce);
  return {
    version: chain.migrationSignature ? 2 : 1,
    teamId,
    eventNonce,
    holder,
    previousPass,
    currentPass,
    jackpot: chain.jackpot || address("jackpot", teamId, eventNonce),
    setupSignature: chain.setupSignature || null,
    receiptSignature: chain.migrationSignature || address("migration", teamId, eventNonce),
    network: chain.migrationSignature ? "devnet" : "local-test",
    programId: chain.programId || null,
    passes: {
      [previousPass]: { address: previousPass, holder, generation: 1, active: true },
      [currentPass]: { address: currentPass, holder, generation: 2, active: true },
    },
    opened: false,
    openedAt: null,
    attempts: 0,
    completionReceipt: null,
    jackpotSignature: null,
  };
}

export function publicCabinet(instance) {
  return {
    version: instance.version,
    currentPass: instance.currentPass,
    holder: instance.holder,
    jackpot: instance.jackpot,
    receiptSignature: instance.receiptSignature,
    network: instance.network,
    programId: instance.programId,
    migration: { fromGeneration: 1, toGeneration: 2, status: "confirmed" },
    opened: instance.opened,
    attempts: instance.attempts,
    completionReceipt: instance.completionReceipt,
  };
}

export function migrationTrace(instance) {
  return {
    signature: instance.receiptSignature,
    instruction: "migrate membership",
    status: "confirmed",
    accounts: [
      { address: instance.holder, role: "member authority", changed: false },
      { address: instance.previousPass, role: "credential input", changed: false },
      { address: instance.currentPass, role: "credential output", changed: true },
      { address: instance.jackpot, role: "arcade registry", changed: false },
    ],
    flow: [instance.previousPass, instance.currentPass],
  };
}

export function inspectAccount(instance, candidate) {
  const value = String(candidate || "").trim();
  const pass = instance.passes[value];
  if (!pass) return { found: false, address: value };
  return {
    found: true,
    address: pass.address,
    owner: instance.programId || "local-test-program",
    holder: pass.holder,
    generation: pass.generation,
    active: pass.active,
  };
}

export function openJackpot(instance, { leftPass, rightPass, leftHolder, rightHolder }) {
  instance.attempts += 1;
  const first = instance.passes[leftPass];
  const second = instance.passes[rightPass];
  if (!first || !second) return { ok: false, code: "unknown_pass", message: "Reader cannot resolve one of those passes." };
  if (leftPass === rightPass) return { ok: false, code: "duplicate_pass", message: "Two distinct pass accounts are required." };
  if (!first.active || !second.active) return { ok: false, code: "inactive_pass", message: "One pass is not active." };
  if (first.holder !== leftHolder || second.holder !== rightHolder) return { ok: false, code: "holder_mismatch", message: "Pass authority does not match the reader." };
  if (leftHolder !== instance.holder || rightHolder !== instance.holder) return { ok: false, code: "missing_signature", message: "Holder authorization failed." };
  if (instance.opened) return { ok: false, code: "already_open", message: "This jackpot is already open." };
  instance.opened = true;
  instance.openedAt = Date.now();
  return { ok: true, code: "jackpot_open", message: "Two passes accepted. Jackpot unlocked." };
}

export function completionFor(instance, secret) {
  if (!instance.opened) return null;
  if (!instance.completionReceipt) {
    instance.completionReceipt = `pt_${crypto.createHmac("sha256", secret)
      .update(`${instance.teamId}:${instance.eventNonce}:${instance.jackpot}:${instance.openedAt}`)
      .digest("base64url").slice(0, 30)}`;
  }
  return instance.completionReceipt;
}
