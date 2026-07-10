const anchor = require("@coral-xyz/anchor");
const { sha256 } = require("@noble/hashes/sha256");

const { PublicKey, LAMPORTS_PER_SOL } = anchor.web3;

const VICTIM_PASSKEY = Buffer.from([
  2, 98, 54, 222, 160, 85, 143, 166, 44, 15, 155, 56, 178, 7, 216, 12, 251, 16, 35, 101, 217, 240,
  229, 122, 70, 175, 184, 77, 57, 69, 88, 70, 3,
]);

function vaultIdBytes(value) {
  const bytes = Buffer.from(value || "target-vault-001");
  if (bytes.length !== 16) throw new Error("VAULT_ID must be exactly 16 bytes");
  return bytes;
}

async function main() {
  anchor.setProvider(anchor.AnchorProvider.env());
  const provider = anchor.getProvider();
  const program = anchor.workspace.imprint;
  const vaultId = vaultIdBytes(process.env.VAULT_ID);
  const initialSol = Number(process.env.INITIAL_SOL || "0.5");
  const initialLamports = new anchor.BN(Math.floor(initialSol * LAMPORTS_PER_SOL));

  const [vault] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), provider.wallet.publicKey.toBuffer(), vaultId],
    program.programId,
  );

  const existing = await provider.connection.getAccountInfo(vault);
  if (existing) {
    const currentLamports = await provider.connection.getBalance(vault, "confirmed");
    console.log("target vault already exists");
    console.log(`NEXT_PUBLIC_TARGET_VAULT=${vault.toString()}`);
    console.log(`IMPRINT_TARGET_VAULT=${vault.toString()}`);
    console.log(`IMPRINT_INITIAL_TARGET_LAMPORTS=${currentLamports}`);
    console.log(`IMPRINT_MINIMUM_DRAIN_LAMPORTS=${initialLamports.toString()}`);
    return;
  }

  const tx = await program.methods
    .initializeVault(Array.from(vaultId), Array.from(VICTIM_PASSKEY), initialLamports)
    .accounts({
      authority: provider.wallet.publicKey,
      vault,
    })
    .rpc();
  const targetLamports = await provider.connection.getBalance(vault, "confirmed");

  console.log(`initialized target vault: ${tx}`);
  console.log(`authority: ${provider.wallet.publicKey.toString()}`);
  console.log(`vault: ${vault.toString()}`);
  console.log(`victim passkey: ${VICTIM_PASSKEY.toString("hex")}`);
  console.log("");
  console.log("put these in web/.env.local for a pre-seeded target:");
  console.log(`NEXT_PUBLIC_TARGET_VAULT=${vault.toString()}`);
  console.log(`IMPRINT_TARGET_VAULT=${vault.toString()}`);
  console.log(`IMPRINT_INITIAL_TARGET_LAMPORTS=${targetLamports}`);
  console.log(`IMPRINT_MINIMUM_DRAIN_LAMPORTS=${initialLamports.toString()}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
