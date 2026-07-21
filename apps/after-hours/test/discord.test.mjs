import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { afterHoursIntegrityActivity, COMMAND_DEFINITION, handleInteraction, verifyDiscordRequest } from "../src/discord.mjs";
import { createMemoryStore } from "../src/store.mjs";

test("Discord Ed25519 request signatures are verified with replay-age limit", () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const raw = Buffer.from('{"type":1}');
  const now = 1_700_000_000_000;
  const timestamp = String(now / 1000);
  const signature = crypto.sign(null, Buffer.concat([Buffer.from(timestamp), raw]), privateKey).toString("hex");
  const publicHex = publicKey.export({ format: "der", type: "spki" }).subarray(-32).toString("hex");
  assert.equal(verifyDiscordRequest(raw, timestamp, signature, publicHex, now), true);
  assert.equal(verifyDiscordRequest(Buffer.from('{"type":2}'), timestamp, signature, publicHex, now), false);
  assert.equal(verifyDiscordRequest(raw, timestamp, signature, publicHex, now + 6 * 60_000), false);
});

test("portal passage links Discord before orders can be created", async () => {
  const store = createMemoryStore();
  const passage = await store.issuePassage({ participantId: "p1", email: "p@example.com" });
  const integrityEvents = [];
  const deps = {
    store, now: () => 1_700_000_000,
    eventGeneration: "discord-test-event",
    integrityEvent: async (identity, activity) => integrityEvents.push({ identity, activity }),
    config: { publicOrigin: "https://after-hours.example", orderTtlSeconds: 600, storeOwner: "11111111111111111111111111111111", nightMint: "So11111111111111111111111111111111111111112" },
    nightDistributor: { issue: async (wallet) => ({ wallet, tokenAccount: "TokenAccount11111111111111111111111111111", signature: "signature", amountBaseUnits: "7000000" }) },
    flagSecret: "x".repeat(32), rpc: {},
  };
  const interaction = (name, values = {}) => ({
    type: 2, context: 0, guild_id: "777", member: { user: { id: "123456789" } },
    data: { name: "afterhours", options: [{ type: 1, name, options: Object.entries(values).map(([key, value]) => ({ name: key, value })) }] },
  });
  const before = await handleInteraction(interaction("menu"), deps);
  assert.match(responseText(before), /Launch AFTER HOURS/);
  const linked = await handleInteraction(interaction("start", { passage }), deps);
  assert.match(responseText(linked), /Passage accepted/i);
  const menu = await handleInteraction(interaction("menu"), deps);
  assert.match(responseText(menu), /Guest allocation/);
  assert.match(responseText(menu), /7\.000000 NIGHT/);
  const blocked = await handleInteraction(interaction("buy"), deps);
  assert.match(responseText(blocked), /Claim the current official NIGHT/);
  const wallet = "11111111111111111111111111111111";
  const claim = await handleInteraction(interaction("allotment", { wallet }), deps);
  assert.equal(typeof claim.deferred, "function");
  assert.match(JSON.stringify(await claim.deferred()), /Guest allocation issued/);
  const order = await handleInteraction(interaction("buy"), deps);
  assert.match(responseText(order), /Midnight Pass invoice/);
  assert.match(responseText(order), /Official mint/);
  assert.match(responseText(order), /Destination/);
  assert.match(responseText(order), /Solana Pay reference/i);
  assert.doesNotMatch(responseText(order), /wallet request|qr\.png|solana:/i);
  assert.doesNotMatch(responseText(order), /solana:/);
  const hint = await handleInteraction(interaction("hint"), deps);
  assert.match(responseText(hint), /One hint/);
  assert.match(responseText(hint), /Before you pay, inspect what the counter gave you/);
  assert.match(responseText(hint), /There are no additional hints/);
  assert.deepEqual(integrityEvents.map(({ activity }) => activity.action), [
    "discord:participant-linked",
    "discord:checkout-requested",
    "discord:allotment-requested",
    "discord:allotment-issued",
    "discord:checkout-requested",
    "discord:checkout-opened",
  ]);
  assert.deepEqual(integrityEvents[0].identity, { participantId: "p1", eventId: "discord-test-event" });
  const forwarded = JSON.stringify(integrityEvents);
  assert.doesNotMatch(forwarded, new RegExp(passage));
  assert.doesNotMatch(forwarded, /123456789/);
  assert.doesNotMatch(forwarded, /11111111111111111111111111111111/);
});

test("command is globally registered only for Discord server installation", () => {
  assert.deepEqual(COMMAND_DEFINITION.integration_types, [0]);
  assert.deepEqual(COMMAND_DEFINITION.contexts, [0]);
  assert.equal(COMMAND_DEFINITION.options.some((option) => option.name === "inspect"), false);
  assert.equal(COMMAND_DEFINITION.options.some((option) => option.name === "policy"), false);
  assert.equal(COMMAND_DEFINITION.options.some((option) => option.name === "allotment"), true);
});

test("central activity uses a closed vocabulary rather than Discord option content", () => {
  assert.deepEqual(afterHoursIntegrityActivity("submit", "fulfilled"), {
    action: "discord:challenge-completed",
    category: "completion",
    outcome: "completed",
  });
  assert.equal(afterHoursIntegrityActivity("submit signature-from-user", "fulfilled"), null);
  assert.equal(afterHoursIntegrityActivity("submit", "signature-from-user"), null);
});

test("command refuses direct-message invocation", async () => {
  const store = createMemoryStore();
  const response = await handleInteraction({
    type: 2,
    context: 1,
    user: { id: "123456789" },
    data: { name: "afterhours", options: [{ type: 1, name: "menu" }] },
  }, {
    store,
    now: () => 1_700_000_000,
    config: { publicOrigin: "https://after-hours.example", orderTtlSeconds: 600, storeOwner: "11111111111111111111111111111111", nightMint: "So11111111111111111111111111111111111111112" },
    nightDistributor: { issue: async () => { throw new Error("unused"); } },
    flagSecret: "x".repeat(32),
    rpc: {},
  });
  assert.match(responseText(response), /Invite AFTER HOURS to a Discord server/i);
});

test("an official NIGHT payment settles checkout without reporting a CTF solve", async () => {
  const store = createMemoryStore();
  const passage = await store.issuePassage({ participantId: "p1", email: "p@example.com" });
  await store.bindPassage(passage, "123456789");
  const allotment = await store.beginAllotment("p1", "11111111111111111111111111111111", "official-mint", 1);
  await store.completeAllotment("p1", "11111111111111111111111111111111", "official-mint", allotment.allotment.leaseId, { signature: "allotment" }, 2);
  await store.createOrder({ id: "AH-HONEST", participantId: "p1", status: "open", createdAt: 10, expiresAt: 700, nightMint: "official-mint" });
  const reports = [];
  const integrityEvents = [];
  const outcome = await handleInteraction({
    type: 2, context: 0, guild_id: "777", member: { user: { id: "123456789" } },
    data: { name: "afterhours", options: [{ type: 1, name: "submit", options: [{ name: "signature", value: "honest-signature" }] }] },
  }, {
    store,
    now: () => 100,
    eventGeneration: "discord-test-event",
    integrityEvent: async (identity, activity) => integrityEvents.push({ identity, activity }),
    config: { nightMint: "official-mint" },
    rpc: {},
    flagSecret: "x".repeat(32),
    reconcilePayment: async () => ({ mint: "official-mint", expectedMint: "official-mint", counterfeit: false, blockTime: 90 }),
    reportSolve: async (...args) => reports.push(args),
  });
  const message = await outcome.deferred();
  assert.match(JSON.stringify(message), /expected checkout path/i);
  assert.equal(await store.completionForParticipant("p1"), null);
  assert.equal((await store.orderById("AH-HONEST")).status, "expected-payment");
  assert.equal(reports.length, 0);
  assert.deepEqual(integrityEvents.map(({ activity }) => activity.action), [
    "discord:payment-submitted",
    "discord:payment-accepted",
  ]);
  assert.doesNotMatch(JSON.stringify(integrityEvents), /honest-signature/);
});

function responseText(outcome) {
  return JSON.stringify(outcome.response.data);
}
