import assert from "node:assert/strict";
import test from "node:test";
import { hasImmutableOfficialNightBrand } from "../src/metadata.mjs";
import { PaymentError, TOKEN_PROGRAM, reconcilePayment } from "../src/verifier.mjs";

const SIGNATURE = "1".repeat(64);
const ORDER = Object.freeze({
  createdAt: 1_700_000_000, expiresAt: 1_700_000_600,
  amountBaseUnits: "10000000", decimals: 6,
  reference: "Reference1111111111111111111111111111111",
  storeOwner: "Store1111111111111111111111111111111111",
  nightMint: "Night11111111111111111111111111111111111",
});

function fixture(overrides = {}) {
  const mint = overrides.mint || "FakeMint1111111111111111111111111111111";
  const destination = "Destination11111111111111111111111111111";
  const transaction = {
    slot: 42, blockTime: overrides.blockTime ?? 1_700_000_100,
    meta: { err: overrides.err ?? null, innerInstructions: overrides.innerInstructions || [] },
    transaction: { message: {
      accountKeys: overrides.accountKeys || [{ pubkey: ORDER.reference }, { pubkey: destination }],
      instructions: overrides.instructions || [{
        programId: overrides.programId || TOKEN_PROGRAM,
        parsed: { type: overrides.type || "transferChecked", info: {
          destination, mint,
          tokenAmount: { amount: overrides.amount || "10000000", decimals: overrides.decimals ?? 6 },
        } },
      }],
    } },
  };
  const rpc = { async call(method) {
    if (method === "getTransaction") return overrides.absent ? null : transaction;
    if (method === "getAccountInfo") return { value: { data: { parsed: { info: { owner: overrides.owner || ORDER.storeOwner, mint: overrides.accountMint || mint } } } } };
    throw new Error(`unexpected ${method}`);
  } };
  const metadataReader = async () => overrides.missingMetadata ? null : ({
    address: "Metadata111111111111111111111111111111111",
    name: overrides.tokenName || "After Hours NIGHT",
    symbol: overrides.tokenSymbol || "NIGHT",
  });
  return { rpc, transaction, mint, metadataReader };
}

test("intended counterfeit mint with copied Metaplex branding is accepted and recorded", async () => {
  const { rpc, mint, metadataReader } = fixture();
  const result = await reconcilePayment({ signature: SIGNATURE, order: ORDER, rpc, metadataReader, now: 1_700_000_200 });
  assert.equal(result.mint, mint);
  assert.equal(result.expectedMint, ORDER.nightMint);
  assert.equal(result.counterfeit, true);
});

test("legitimate NIGHT payment also remains valid", async () => {
  const { rpc, metadataReader } = fixture({ mint: ORDER.nightMint });
  const result = await reconcilePayment({ signature: SIGNATURE, order: ORDER, rpc, metadataReader, now: 1_700_000_200 });
  assert.equal(result.counterfeit, false);
});

test("the production NIGHT brand must be both exact and immutable", () => {
  assert.equal(hasImmutableOfficialNightBrand({ name: "After Hours NIGHT", symbol: "NIGHT", isMutable: false }), true);
  assert.equal(hasImmutableOfficialNightBrand({ name: "After Hours NIGHT", symbol: "NIGHT", isMutable: true }), false);
  assert.equal(hasImmutableOfficialNightBrand({ name: "After Hours NIGHT", symbol: "NITE", isMutable: false }), false);
});

for (const [name, overrides, code] of [
  ["wrong amount", { amount: "9999999" }, "wrong_payment_shape"],
  ["wrong decimals", { decimals: 5 }, "wrong_payment_shape"],
  ["missing Metaplex metadata", { missingMetadata: true }, "missing_metadata"],
  ["wrong token name", { tokenName: "Random Devnet Token" }, "wrong_brand"],
  ["wrong token symbol", { tokenSymbol: "RND" }, "wrong_brand"],
  ["wrong recipient owner", { owner: "Other1111111111111111111111111111111111" }, "wrong_recipient"],
  ["missing reference", { accountKeys: [{ pubkey: "OtherReference11111111111111111111111111" }] }, "missing_reference"],
  ["failed transaction", { err: { InstructionError: [0, "Custom"] } }, "failed_transaction"],
  ["fake token program", { programId: "Fake111111111111111111111111111111111111" }, "missing_transfer"],
  ["logs without transfer", { instructions: [], innerInstructions: [], logs: ["Program log: TransferChecked"] }, "missing_transfer"],
  ["absent transaction", { absent: true }, "not_finalized"],
]) {
  test(`${name} is rejected`, async () => {
    const { rpc, metadataReader } = fixture(overrides);
    await assert.rejects(
      reconcilePayment({ signature: SIGNATURE, order: ORDER, rpc, metadataReader, now: 1_700_000_200 }),
      (error) => error instanceof PaymentError && error.code === code,
    );
  });
}

test("payment-shape feedback takes precedence over a missing Solana Pay reference", async () => {
  const { rpc, metadataReader } = fixture({
    amount: "10",
    decimals: 0,
    accountKeys: [{ pubkey: "OtherReference11111111111111111111111111" }],
  });
  await assert.rejects(
    reconcilePayment({ signature: SIGNATURE, order: ORDER, rpc, metadataReader, now: 1_700_000_200 }),
    (error) => error instanceof PaymentError &&
      error.code === "wrong_payment_shape" &&
      /amount and decimal precision/.test(error.message),
  );
});

test("parsed inner transfer instructions are supported", async () => {
  const base = fixture();
  const transfer = base.transaction.transaction.message.instructions[0];
  base.transaction.transaction.message.instructions = [];
  base.transaction.meta.innerInstructions = [{ index: 0, instructions: [transfer] }];
  const result = await reconcilePayment({ signature: SIGNATURE, order: ORDER, rpc: base.rpc, metadataReader: base.metadataReader, now: 1_700_000_200 });
  assert.equal(result.counterfeit, true);
});
