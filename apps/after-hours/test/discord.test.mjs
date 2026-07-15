import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { handleInteraction, verifyDiscordRequest } from "../src/discord.mjs";
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
    store, guildId: "777", now: () => 1_700_000_000,
    config: { orderTtlSeconds: 600, storeOwner: "11111111111111111111111111111111", nightMint: "So11111111111111111111111111111111111111112" },
    policyText: () => "policy", flagSecret: "x".repeat(32), rpc: {},
  };
  const interaction = (name, values = {}) => ({
    type: 2, guild_id: "777", member: { user: { id: "123456789" } },
    data: { name: "afterhours", options: [{ type: 1, name, options: Object.entries(values).map(([key, value]) => ({ name: key, value })) }] },
  });
  const before = await handleInteraction(interaction("menu"), deps);
  assert.match(before.response.data.content, /Launch AFTER HOURS/);
  const linked = await handleInteraction(interaction("start", { passage }), deps);
  assert.match(linked.response.data.content, /passage accepted/i);
  const order = await handleInteraction(interaction("buy"), deps);
  assert.match(order.response.data.content, /ORDER CREATED/);
  assert.match(order.response.data.content, /solana:/);
});
