import { sha256 } from "@noble/hashes/sha256";
import { PublicKey } from "@solana/web3.js";

const PASSKEY_ACCOUNT_SIZE = 8 + 32 + 33 + 32 + 1 + 1;
const PASSKEY_ACCOUNT_DISCRIMINATOR = Buffer.from(
  sha256(Buffer.from("account:Passkey"))
).subarray(0, 8);
const WITHDRAW_INSTRUCTION_DISCRIMINATOR = Buffer.from(
  sha256(Buffer.from("global:withdraw_with_passkey"))
).subarray(0, 8);

function keyText(value) {
  return new PublicKey(value).toString();
}

function allAccountKeys(message, meta) {
  const staticKeys = message.staticAccountKeys || message.accountKeys || [];
  const loaded = meta?.loadedAddresses || {};
  return [
    ...staticKeys,
    ...(loaded.writable || []),
    ...(loaded.readonly || []),
  ];
}

function compiledInstructions(message) {
  return message.compiledInstructions || message.instructions || [];
}

function instructionAccountIndexes(instruction) {
  return instruction.accountKeyIndexes || instruction.accounts || [];
}

function safeLamports(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} is outside the safe lamport range`);
  }
  return BigInt(value);
}

export function claimedPasskeyOwner(
  accountInfo,
  expectedProgramId,
  expectedPasskeyPubkey
) {
  if (
    !accountInfo ||
    keyText(accountInfo.owner) !== keyText(expectedProgramId)
  ) {
    throw new Error(
      "the claimed event security key is not an IMPRINT passkey account"
    );
  }
  const data = Buffer.from(accountInfo.data || []);
  const expectedKey = Buffer.from(expectedPasskeyPubkey || []);
  if (
    data.length < PASSKEY_ACCOUNT_SIZE ||
    expectedKey.length !== 33 ||
    !data.subarray(0, 8).equals(PASSKEY_ACCOUNT_DISCRIMINATOR)
  ) {
    throw new Error("event security-key account data is malformed");
  }
  if (!data.subarray(40, 73).equals(expectedKey)) {
    throw new Error(
      "event security-key account does not match the assigned hardware key"
    );
  }
  if (data[105] !== 1) {
    throw new Error("the claimed event security key is inactive");
  }
  return new PublicKey(data.subarray(8, 40));
}

export function qualifyingImprintDrain({
  transaction,
  programId,
  targetVault,
  passkey,
  owner,
  minimumDrainLamports,
}) {
  if (
    !transaction?.transaction?.message ||
    !transaction.meta ||
    transaction.meta.err
  ) {
    throw new Error("submitted transaction was not confirmed successfully");
  }

  const message = transaction.transaction.message;
  const keys = allAccountKeys(message, transaction.meta);
  const programText = keyText(programId);
  const targetText = keyText(targetVault);
  const passkeyText = keyText(passkey);
  const ownerText = keyText(owner);

  const signerCount = message.header?.numRequiredSignatures;
  const staticKeys = message.staticAccountKeys || message.accountKeys || [];
  if (
    !Number.isInteger(signerCount) ||
    signerCount < 1 ||
    signerCount > staticKeys.length
  ) {
    throw new Error("submitted transaction has an invalid signer set");
  }
  if (
    !staticKeys.slice(0, signerCount).some((key) => keyText(key) === ownerText)
  ) {
    throw new Error(
      "submitted transaction was not signed by this team's claimed key owner"
    );
  }

  const matchingWithdrawal = compiledInstructions(message).some(
    (instruction) => {
      const programKey = keys[instruction.programIdIndex];
      const accountIndexes = instructionAccountIndexes(instruction);
      const data = Buffer.from(instruction.data || []);
      if (
        !programKey ||
        keyText(programKey) !== programText ||
        data.length < WITHDRAW_INSTRUCTION_DISCRIMINATOR.length ||
        !data.subarray(0, 8).equals(WITHDRAW_INSTRUCTION_DISCRIMINATOR) ||
        accountIndexes.length < 3
      ) {
        return false;
      }
      const instructionTarget = keys[accountIndexes[0]];
      const instructionOwner = keys[accountIndexes[1]];
      const instructionPasskey = keys[accountIndexes[2]];
      if (!instructionTarget || !instructionOwner || !instructionPasskey) {
        return false;
      }
      return (
        keyText(instructionTarget) === targetText &&
        keyText(instructionOwner) === ownerText &&
        keyText(instructionPasskey) === passkeyText
      );
    }
  );
  if (!matchingWithdrawal) {
    throw new Error(
      "submitted transaction did not withdraw from the canonical target with this team's event key"
    );
  }

  const targetIndex = keys.findIndex((key) => keyText(key) === targetText);
  if (
    targetIndex < 0 ||
    targetIndex >= transaction.meta.preBalances.length ||
    targetIndex >= transaction.meta.postBalances.length
  ) {
    throw new Error(
      "canonical target balance data is missing from the transaction"
    );
  }
  const before = safeLamports(
    transaction.meta.preBalances[targetIndex],
    "target pre-balance"
  );
  const after = safeLamports(
    transaction.meta.postBalances[targetIndex],
    "target post-balance"
  );
  const drain = before > after ? before - after : 0n;
  if (drain < BigInt(minimumDrainLamports)) {
    throw new Error(
      "the submitted transaction did not drain the canonical target far enough"
    );
  }
  return drain;
}

export { PASSKEY_ACCOUNT_DISCRIMINATOR, WITHDRAW_INSTRUCTION_DISCRIMINATOR };
