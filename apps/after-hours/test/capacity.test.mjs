import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";

import { evaluateAfterHoursCapacity, start } from "../src/server.mjs";

const MINT = "Fkwatju4DW2cgknrwQc4byBGAdKL44zcAkG4JVNuEjFb";

test("capacity derives the funded field from current NIGHT inventory and the configured fee reserve", () => {
  const ready = evaluateAfterHoursCapacity({
    issuedAllotments: 10,
    nightBaseUnits: 280_000_000n,
    payerLamports: 200_000_000n,
    minimumTreasuryLamports: 200_000_000,
  });
  assert.equal(ready.ok, true);
  assert.equal(ready.availableAllotments, 40);
  assert.equal(ready.maxParticipants, 50);
  assert.equal(evaluateAfterHoursCapacity({
    issuedAllotments: 10,
    nightBaseUnits: 280_000_000n,
    payerLamports: 199_999_999n,
    minimumTreasuryLamports: 200_000_000,
  }).feePayerSufficient, false);
});

test("health reports aggregate NIGHT capacity without treasury addresses or balances", async (t) => {
  const service = await start(baseEnv(), {
    nightDistributor: {
      mint: MINT,
      inventory: async () => ({ nightBaseUnits: 14_000_000n, payerLamports: 100_000_000n }),
    },
  });
  t.after(async () => {
    await new Promise((resolve) => service.server.close(resolve));
    await service.store.close();
  });
  const first = await service.store.beginAllotment("participant-1", "wallet-1", MINT, 100);
  await service.store.completeAllotment("participant-1", "wallet-1", MINT, first.allotment.leaseId, { signature: "one" }, 101);
  const response = await fetch(`http://127.0.0.1:${service.server.address().port}/health`);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body.capacity, {
    reachable: true,
    issuedAllotments: 1,
    availableAllotments: 2,
    maxParticipants: 3,
    feePayerSufficient: true,
  });
  assert.equal(JSON.stringify(body).includes("treasury"), false);
  assert.equal(JSON.stringify(body).includes("100000000"), false);
});

test("health reports the exact funded field when NIGHT inventory has a partial remainder", async (t) => {
  const service = await start(baseEnv(), {
    nightDistributor: {
      mint: MINT,
      inventory: async () => ({ nightBaseUnits: 20_999_999n, payerLamports: 100_000_000n }),
    },
  });
  t.after(async () => {
    await new Promise((resolve) => service.server.close(resolve));
    await service.store.close();
  });
  const response = await fetch(`http://127.0.0.1:${service.server.address().port}/health`);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).capacity.maxParticipants, 2);
});

test("production requires an explicit treasury reserve", async () => {
  const production = {
    ...baseEnv(),
    NODE_ENV: "production",
    CTF_EVENT_GENERATION: "capacity-event",
    AFTER_HOURS_PUBLIC_ORIGIN: "https://after-hours.example",
  };
  delete production.AFTER_HOURS_MIN_TREASURY_LAMPORTS;
  await assert.rejects(() => start(production), /AFTER_HOURS_MIN_TREASURY_LAMPORTS is required in production/);
});

function baseEnv() {
  return {
    PORT: "0",
    AFTER_HOURS_PUBLIC_ORIGIN: "http://127.0.0.1:3006",
    AFTER_HOURS_RPC_URL: "https://rpc.invalid",
    AFTER_HOURS_STORE_OWNER: "11111111111111111111111111111111",
    AFTER_HOURS_NIGHT_MINT: MINT,
    AFTER_HOURS_NIGHT_TREASURY_KEYPAIR: encodedEd25519Keypair(),
    AFTER_HOURS_MIN_TREASURY_LAMPORTS: "100000000",
    DISCORD_APPLICATION_ID: "1526903167424528485",
    DISCORD_APPLICATION_PUBLIC_KEY: "a".repeat(64),
    AFTER_HOURS_FLAG_SECRET: "after-hours-capacity-flag-secret-at-least-32-bytes",
    CHALLENGE_TICKET_SECRET: "after-hours-capacity-ticket-secret-at-least-32-bytes",
  };
}

function encodedEd25519Keypair() {
  const { privateKey } = crypto.generateKeyPairSync("ed25519");
  const jwk = privateKey.export({ format: "jwk" });
  return Buffer.concat([Buffer.from(jwk.d, "base64url"), Buffer.from(jwk.x, "base64url")]).toString("base64");
}
