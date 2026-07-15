import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { COMMAND_DEFINITION, handleInteraction, verifyDiscordRequest } from "../src/discord.mjs";
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
  const passage = await store.issuePassage({ participantId: "p1", teamId: "t1", email: "p@example.com" });
  const deps = {
    store, now: () => 1_700_000_000,
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
  assert.match(responseText(order), /Reference/);
  assert.doesNotMatch(responseText(order), /wallet request|qr\.png|solana:/i);
  assert.doesNotMatch(responseText(order), /solana:/);
  const hint = await handleInteraction(interaction("hint"), deps);
  assert.match(responseText(hint), /One hint/);
  assert.match(responseText(hint), /There are no additional hints/);
});

test("command is globally registered only for Discord server installation", () => {
  assert.deepEqual(COMMAND_DEFINITION.integration_types, [0]);
  assert.deepEqual(COMMAND_DEFINITION.contexts, [0]);
  assert.equal(COMMAND_DEFINITION.options.some((option) => option.name === "inspect"), false);
  assert.equal(COMMAND_DEFINITION.options.some((option) => option.name === "policy"), false);
  assert.equal(COMMAND_DEFINITION.options.some((option) => option.name === "allotment"), true);
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

function responseText(outcome) {
  return JSON.stringify(outcome.response.data);
}
