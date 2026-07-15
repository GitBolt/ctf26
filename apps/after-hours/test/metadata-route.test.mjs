import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";

import { start } from "../src/server.mjs";

test("official NIGHT metadata and icon are served without a checkout page", async (context) => {
  const treasury = encodedEd25519Keypair();
  const { server, store } = await start({
    PORT: "0",
    AFTER_HOURS_PUBLIC_ORIGIN: "http://127.0.0.1:3006",
    AFTER_HOURS_RPC_URL: "https://rpc.invalid",
    AFTER_HOURS_STORE_OWNER: "11111111111111111111111111111111",
    AFTER_HOURS_NIGHT_MINT: "Fkwatju4DW2cgknrwQc4byBGAdKL44zcAkG4JVNuEjFb",
    AFTER_HOURS_NIGHT_TREASURY_KEYPAIR: treasury,
    DISCORD_APPLICATION_ID: "1526903167424528485",
    DISCORD_APPLICATION_PUBLIC_KEY: "a".repeat(64),
    AFTER_HOURS_FLAG_SECRET: "metadata-route-test-secret-that-is-at-least-32-bytes",
  });
  context.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await store.close();
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const metadataResponse = await fetch(`${origin}/night.json`);
  assert.equal(metadataResponse.status, 200);
  assert.match(metadataResponse.headers.get("cache-control"), /immutable/);
  assert.deepEqual(await metadataResponse.json(), {
    name: "After Hours NIGHT",
    symbol: "NIGHT",
    description: "The fixed-supply guest currency of the AFTER HOURS night counter.",
    image: "https://after-hours-production-159b.up.railway.app/night.svg",
    external_url: "https://after-hours-production-159b.up.railway.app/",
    properties: {
      category: "fungible",
      network: "solana-devnet",
      metadata_uri: "https://after-hours-production-159b.up.railway.app/night.json",
    },
  });
  const icon = await fetch(`${origin}/night.svg`);
  assert.equal(icon.headers.get("content-type"), "image/svg+xml; charset=utf-8");
  assert.match(await icon.text(), /<svg/);
  assert.equal((await fetch(`${origin}/wallet-request/AH-A1B2C3`)).status, 404);
});

function encodedEd25519Keypair() {
  const { privateKey } = crypto.generateKeyPairSync("ed25519");
  const jwk = privateKey.export({ format: "jwk" });
  return Buffer.concat([Buffer.from(jwk.d, "base64url"), Buffer.from(jwk.x, "base64url")]).toString("base64");
}
