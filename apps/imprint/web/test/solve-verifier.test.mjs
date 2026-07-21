import assert from "node:assert/strict";
import test from "node:test";
import {
  Keypair,
  PublicKey,
  SYSVAR_INSTRUCTIONS_PUBKEY,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";

import {
  PASSKEY_ACCOUNT_DISCRIMINATOR,
  WITHDRAW_INSTRUCTION_DISCRIMINATOR,
  claimedPasskeyOwner,
  qualifyingImprintDrain,
} from "../lib/solve-verifier.mjs";

const programId = new PublicKey("5EgXikx8uaGDDRdLdxzoLsDafSruHZnNnstE7bd8wH6B");
const owner = Keypair.generate().publicKey;
const passkey = Keypair.generate().publicKey;
const target = Keypair.generate().publicKey;
const destination = Keypair.generate().publicKey;

function responseFor({
  instructionProgram = programId,
  instructionOwner = owner,
  instructionPasskey = passkey,
  instructionTarget = target,
  data = WITHDRAW_INSTRUCTION_DISCRIMINATOR,
  before = 500_000_000,
  after = 100_000_000,
} = {}) {
  const transaction = new Transaction({
    feePayer: owner,
    recentBlockhash: "11111111111111111111111111111111",
  }).add(
    new TransactionInstruction({
      programId: instructionProgram,
      keys: [
        { pubkey: instructionTarget, isSigner: false, isWritable: true },
        { pubkey: instructionOwner, isSigner: true, isWritable: false },
        { pubkey: instructionPasskey, isSigner: false, isWritable: false },
        { pubkey: destination, isSigner: false, isWritable: true },
        {
          pubkey: SYSVAR_INSTRUCTIONS_PUBKEY,
          isSigner: false,
          isWritable: false,
        },
      ],
      data: Buffer.concat([Buffer.from(data), Buffer.alloc(16)]),
    })
  );
  const message = transaction.compileMessage();
  const preBalances = Array(message.accountKeys.length).fill(1_000_000);
  const postBalances = [...preBalances];
  const targetIndex = message.accountKeys.findIndex((key) =>
    key.equals(instructionTarget)
  );
  preBalances[targetIndex] = before;
  postBalances[targetIndex] = after;
  return {
    transaction: { message, signatures: ["signature"] },
    meta: { err: null, preBalances, postBalances, loadedAddresses: null },
  };
}

test("attributes a qualifying drain to the exact participant passkey withdrawal", () => {
  const drain = qualifyingImprintDrain({
    transaction: responseFor(),
    programId,
    targetVault: target,
    passkey,
    owner,
    minimumDrainLamports: 350_000_000n,
  });
  assert.equal(drain, 400_000_000n);
});

test("rejects address padding, another target or passkey, and an insufficient drain", () => {
  const input = {
    programId,
    targetVault: target,
    passkey,
    owner,
    minimumDrainLamports: 350_000_000n,
  };
  assert.throws(
    () =>
      qualifyingImprintDrain({
        ...input,
        transaction: responseFor({
          instructionTarget: Keypair.generate().publicKey,
        }),
      }),
    /did not withdraw from this participant's assigned target/
  );
  assert.throws(
    () =>
      qualifyingImprintDrain({
        ...input,
        transaction: responseFor({ data: Buffer.alloc(8, 7) }),
      }),
    /did not withdraw from this participant's assigned target/
  );
  assert.throws(
    () =>
      qualifyingImprintDrain({
        ...input,
        transaction: responseFor({
          instructionPasskey: Keypair.generate().publicKey,
        }),
      }),
    /did not withdraw from this participant's assigned target/
  );
  assert.throws(
    () =>
      qualifyingImprintDrain({
        ...input,
        transaction: responseFor({ before: 500_000_000, after: 200_000_000 }),
      }),
    /did not drain the assigned target far enough/
  );
});

test("parses only an active Passkey account with the assigned P-256 key", () => {
  const p256Key = Buffer.concat([Buffer.from([2]), Buffer.alloc(32, 9)]);
  const data = Buffer.alloc(107);
  PASSKEY_ACCOUNT_DISCRIMINATOR.copy(data, 0);
  owner.toBuffer().copy(data, 8);
  p256Key.copy(data, 40);
  data[105] = 1;
  const account = { owner: programId, data };

  assert.equal(
    claimedPasskeyOwner(account, programId, p256Key).toString(),
    owner.toString()
  );
  data[105] = 0;
  assert.throws(
    () => claimedPasskeyOwner(account, programId, p256Key),
    /inactive/
  );
  data[105] = 1;
  data[0] ^= 0xff;
  assert.throws(
    () => claimedPasskeyOwner(account, programId, p256Key),
    /malformed/
  );
});
