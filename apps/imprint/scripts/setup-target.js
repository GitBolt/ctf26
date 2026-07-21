const anchor = require("@coral-xyz/anchor");
const { sha256 } = require("@noble/hashes/sha256");

const { PublicKey, SystemProgram, Transaction } = anchor.web3;

const VICTIM_PASSKEY = Buffer.from([
  2, 98, 54, 222, 160, 85, 143, 166, 44, 15, 155, 56, 178, 7, 216, 12, 251, 16,
  35, 101, 217, 240, 229, 122, 70, 175, 184, 77, 57, 69, 88, 70, 3,
]);

function vaultIdBytes(value) {
  const bytes = Buffer.from(value || "target-vault-001");
  if (bytes.length !== 16) throw new Error("VAULT_ID must be exactly 16 bytes");
  return bytes;
}

function solToLamports(value, name) {
  const text = String(value).trim();
  if (!/^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,9})?$/.test(text)) {
    throw new Error(
      `${name} must be a positive SOL amount with at most 9 decimals`
    );
  }
  const [whole, fraction = ""] = text.split(".");
  const lamports =
    BigInt(whole) * 1_000_000_000n + BigInt(fraction.padEnd(9, "0") || "0");
  if (lamports <= 0n) throw new Error(`${name} must be greater than zero`);
  return lamports;
}

function positiveInteger(value, name) {
  const text = String(value).trim();
  if (!/^[1-9][0-9]*$/.test(text))
    throw new Error(`${name} must be a positive integer`);
  const parsed = Number(text);
  if (!Number.isSafeInteger(parsed)) throw new Error(`${name} is too large`);
  return parsed;
}

function optionalParticipantId(value) {
  const participantId = String(value || "").trim();
  if (!participantId) return null;
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(participantId)) {
    throw new Error("PARTICIPANT_ID must be a valid event participant ID");
  }
  return participantId;
}

function printTargetConfiguration(
  participantId,
  vault,
  initialLamports,
  minimumDrainLamports
) {
  if (participantId) {
    console.log("IMPRINT_TARGET_MODE=per-participant");
    console.log("merge this entry into IMPRINT_PARTICIPANT_TARGETS_JSON:");
    console.log(
      JSON.stringify(
        {
          [participantId]: {
            vault: vault.toString(),
            initialLamports: String(initialLamports),
            minimumDrainLamports: String(minimumDrainLamports),
          },
        },
        null,
        2
      )
    );
    return;
  }
  console.log("non-production single-target rehearsal variables:");
  console.log("IMPRINT_TARGET_MODE=single-target-rehearsal");
  console.log(`IMPRINT_TARGET_VAULT=${vault.toString()}`);
  console.log(`IMPRINT_INITIAL_TARGET_LAMPORTS=${initialLamports}`);
  console.log(`IMPRINT_MINIMUM_DRAIN_LAMPORTS=${minimumDrainLamports}`);
}

async function main() {
  anchor.setProvider(anchor.AnchorProvider.env());
  const provider = anchor.getProvider();
  const program = anchor.workspace.imprint;
  const participantId = optionalParticipantId(process.env.PARTICIPANT_ID);
  const vaultId = vaultIdBytes(process.env.VAULT_ID);
  const perSolveLamports = solToLamports(
    process.env.MINIMUM_DRAIN_SOL || "0.5",
    "MINIMUM_DRAIN_SOL"
  );
  const solveCapacity = positiveInteger(
    process.env.SOLVE_CAPACITY || "1",
    "SOLVE_CAPACITY"
  );
  const initialDepositLamports = process.env.INITIAL_SOL
    ? solToLamports(process.env.INITIAL_SOL, "INITIAL_SOL")
    : perSolveLamports * BigInt(solveCapacity);
  if (initialDepositLamports < perSolveLamports) {
    throw new Error(
      "initial target deposit cannot be smaller than one required drain"
    );
  }

  const [vault] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), provider.wallet.publicKey.toBuffer(), vaultId],
    program.programId
  );

  let existing = await provider.connection.getAccountInfo(vault, "confirmed");
  if (existing) {
    if (!existing.owner.equals(program.programId)) {
      throw new Error(
        "derived target exists but is not owned by the IMPRINT program"
      );
    }
    const rentFloor = BigInt(
      await provider.connection.getMinimumBalanceForRentExemption(
        existing.data.length,
        "confirmed"
      )
    );
    const desiredBalance = rentFloor + initialDepositLamports;
    if (
      process.env.TOP_UP_EXISTING === "true" &&
      BigInt(existing.lamports) < desiredBalance
    ) {
      const delta = desiredBalance - BigInt(existing.lamports);
      if (delta > BigInt(Number.MAX_SAFE_INTEGER)) {
        throw new Error(
          "required target top-up exceeds JavaScript's safe transaction range"
        );
      }
      const transaction = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: provider.wallet.publicKey,
          toPubkey: vault,
          lamports: Number(delta),
        })
      );
      const signature = await provider.sendAndConfirm(transaction, []);
      console.log(`topped up existing target: ${signature}`);
      existing = await provider.connection.getAccountInfo(vault, "confirmed");
    }
    const currentLamports = existing.lamports;
    const withdrawable =
      BigInt(currentLamports) > rentFloor
        ? BigInt(currentLamports) - rentFloor
        : 0n;
    const currentCapacity = withdrawable / perSolveLamports;
    console.log("target vault already exists");
    printTargetConfiguration(participantId, vault, currentLamports, perSolveLamports);
    console.log(`CURRENT_SOLVE_CAPACITY=${currentCapacity.toString()}`);
    if (currentCapacity < BigInt(solveCapacity)) {
      throw new Error(
        "target capacity is below SOLVE_CAPACITY; rerun with TOP_UP_EXISTING=true after funding the operator"
      );
    }
    return;
  }

  const tx = await program.methods
    .initializeVault(
      Array.from(vaultId),
      Array.from(VICTIM_PASSKEY),
      new anchor.BN(initialDepositLamports.toString())
    )
    .accounts({
      authority: provider.wallet.publicKey,
      vault,
    })
    .rpc();
  const targetLamports = await provider.connection.getBalance(
    vault,
    "confirmed"
  );

  console.log(`initialized target vault: ${tx}`);
  console.log(`authority: ${provider.wallet.publicKey.toString()}`);
  console.log(`vault: ${vault.toString()}`);
  console.log(`victim passkey: ${VICTIM_PASSKEY.toString("hex")}`);
  console.log("");
  printTargetConfiguration(participantId, vault, targetLamports, perSolveLamports);
  console.log(`CURRENT_SOLVE_CAPACITY=${solveCapacity}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
