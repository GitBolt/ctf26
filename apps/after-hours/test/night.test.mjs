import assert from "node:assert/strict";
import test from "node:test";
import { none } from "@solana/kit";

import { createNightDistributor, NIGHT_ALLOTMENT_BASE_UNITS } from "../src/night.mjs";

const SECRET = Buffer.alloc(64, 7).toString("base64");

test("official NIGHT distributor tops a participant up to exactly seven tokens", async () => {
  let transfer = null;
  const distributor = await createNightDistributor({
    rpcUrl: "https://rpc.invalid",
    mint: "mint",
    treasurySecret: SECRET,
  }, {
    rpc: {},
    address: (value) => value,
    createSigner: async () => ({ address: "treasury" }),
    deriveAta: async (_mint, owner) => `${owner}-ata`,
    fetchMint: async () => ({ data: { decimals: 6, mintAuthority: none(), freezeAuthority: none() } }),
    fetchToken: async () => ({ data: { amount: 100_000_000n } }),
    fetchMaybeToken: async () => ({ exists: true, data: { amount: 2_000_000n } }),
    sendAllotment: async (input) => { transfer = input; return "devnet-signature"; },
  });
  const evidence = await distributor.issue("recipient");
  assert.equal(evidence.amountBaseUnits, NIGHT_ALLOTMENT_BASE_UNITS.toString());
  assert.equal(evidence.signature, "devnet-signature");
  assert.equal(evidence.tokenAccount, "recipient-ata");
  assert.equal(transfer.amount, 5_000_000n);
  assert.equal(transfer.destinationOwner, "recipient");
});

test("official NIGHT distributor does not transfer a second allotment", async () => {
  let transfers = 0;
  const distributor = await createNightDistributor({ rpcUrl: "unused", mint: "mint", treasurySecret: SECRET }, {
    rpc: {}, address: (value) => value, createSigner: async () => ({ address: "treasury" }),
    deriveAta: async (_mint, owner) => `${owner}-ata`,
    fetchMint: async () => ({ data: { decimals: 6, mintAuthority: none(), freezeAuthority: none() } }),
    fetchToken: async () => ({ data: { amount: 100_000_000n } }),
    fetchMaybeToken: async () => ({ exists: true, data: { amount: NIGHT_ALLOTMENT_BASE_UNITS } }),
    sendAllotment: async () => { transfers += 1; return "unexpected"; },
  });
  const evidence = await distributor.issue("recipient");
  assert.equal(evidence.signature, "");
  assert.equal(transfers, 0);
});

test("official NIGHT distributor rejects non-wallet input", async () => {
  const distributor = await createNightDistributor({ rpcUrl: "unused", mint: "mint", treasurySecret: SECRET }, {
    rpc: {},
    address: (value) => { if (value === "not-a-wallet") throw new Error("bad address"); return value; },
    createSigner: async () => ({ address: "treasury" }),
  });
  await assert.rejects(() => distributor.issue("not-a-wallet"), { code: "invalid_wallet" });
});

test("official NIGHT inventory reads the token treasury and fee payer without exposing addresses", async () => {
  const distributor = await createNightDistributor({ rpcUrl: "unused", mint: "mint", treasurySecret: SECRET }, {
    rpc: {},
    address: (value) => value,
    createSigner: async () => ({ address: "treasury" }),
    deriveAta: async (_mint, owner) => `${owner}-ata`,
    fetchToken: async (_rpc, tokenAccount) => {
      assert.equal(tokenAccount, "treasury-ata");
      return { data: { amount: 350_000_000n } };
    },
    getBalance: async (_rpc, owner) => {
      assert.equal(owner, "treasury");
      return 200_000_000;
    },
  });
  assert.deepEqual(await distributor.inventory(), {
    nightBaseUnits: 350_000_000n,
    payerLamports: 200_000_000n,
  });
});
