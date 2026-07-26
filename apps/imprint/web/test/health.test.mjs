import assert from "node:assert/strict";
import test from "node:test";
import { Keypair } from "@solana/web3.js";

import { imprintHealth } from "../lib/health.mjs";

const operator = Keypair.fromSeed(
  Uint8Array.from({ length: 32 }, (_, index) => index + 1)
);
const production = {
  NODE_ENV: "production",
  CTF_EVENT_GENERATION: "ctf26-final",
  REDIS_URL: "redis://redis.example:6379",
  SOLANA_RPC_URL: "https://rpc.example.test",
  IMPRINT_INSTANCE_SECRET: "i".repeat(32),
  IMPRINT_OPERATOR_KEYPAIR_JSON: JSON.stringify(Array.from(operator.secretKey)),
  IMPRINT_TARGET_INITIAL_LAMPORTS: "10000000",
  IMPRINT_TARGET_MINIMUM_DRAIN_LAMPORTS: "5000000",
};

test("production health reports dynamic first-launch provisioning", () => {
  assert.deepEqual(imprintHealth(production), {
    ok: true,
    eventReady: true,
    targetMode: "on-demand",
    dynamicProvisioning: true,
    eventGeneration: "ctf26-final",
    ticketReplay: "redis",
  });
});

test("production health fails closed without provisioning secrets", () => {
  assert.throws(
    () => imprintHealth({ ...production, IMPRINT_INSTANCE_SECRET: "" }),
    /IMPRINT_INSTANCE_SECRET is missing or weak/
  );
  assert.throws(
    () => imprintHealth({ ...production, IMPRINT_OPERATOR_KEYPAIR_JSON: "" }),
    /IMPRINT_OPERATOR_KEYPAIR_JSON is invalid/
  );
});

test("production health requires generation-scoped durable state", () => {
  assert.throws(
    () => imprintHealth({ ...production, CTF_EVENT_GENERATION: "" }),
    /CTF_EVENT_GENERATION is required/
  );
  assert.throws(
    () => imprintHealth({ ...production, REDIS_URL: "" }),
    /REDIS_URL is required/
  );
});
