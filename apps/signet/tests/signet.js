import anchor from "@coral-xyz/anchor";
import { expect } from "chai";
import {
  TOKEN_PROGRAM_ID,
  createMint,
  getAccount,
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from "@solana/spl-token";

const { PublicKey, SystemProgram, SYSVAR_RENT_PUBKEY } = anchor.web3;

describe("signet on-chain authority path", () => {
  anchor.setProvider(anchor.AnchorProvider.env());

  const provider = anchor.getProvider();
  const payer = provider.wallet.payer;
  const vulnerable = anchor.workspace.QuarryVault;
  const fixed = anchor.workspace.QuarryVaultFixed;
  const attackerStrategy = anchor.workspace.AttackerStrategy;

  async function initializeVault(program, label, pinnedStrategyProgram) {
    const participantSeed = Buffer.alloc(16);
    Buffer.from(label).copy(participantSeed);
    const mint = await createMint(
      provider.connection,
      payer,
      provider.wallet.publicKey,
      null,
      6,
    );

    const [vault] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), provider.wallet.publicKey.toBuffer(), participantSeed],
      program.programId,
    );
    const [vaultAuthority] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault-authority"), vault.toBuffer()],
      program.programId,
    );
    const [reserve] = PublicKey.findProgramAddressSync(
      [Buffer.from("reserve"), vault.toBuffer()],
      program.programId,
    );

    await program.methods
      .initialize(Array.from(participantSeed), pinnedStrategyProgram)
      .accounts({
        authority: provider.wallet.publicKey,
        mint,
        vault,
        vaultAuthority,
        reserve,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .rpc();

    const destination = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      payer,
      mint,
      provider.wallet.publicKey,
    );
    await mintTo(
      provider.connection,
      payer,
      mint,
      reserve,
      provider.wallet.publicKey,
      1_000_000n,
    );

    return { mint, vault, vaultAuthority, reserve, destination: destination.address };
  }

  it("lets an unpinned malicious strategy reuse the forwarded vault signer", async () => {
    const target = await initializeVault(
      vulnerable,
      "vulnerable",
      SystemProgram.programId,
    );
    const amount = 750_000n;

    await vulnerable.methods
      .executeStrategy(new anchor.BN(amount.toString()))
      .accounts({
        vault: target.vault,
        vaultAuthority: target.vaultAuthority,
        reserve: target.reserve,
        destination: target.destination,
        strategyProgram: attackerStrategy.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    const reserve = await getAccount(provider.connection, target.reserve);
    const destination = await getAccount(provider.connection, target.destination);
    expect(reserve.amount).to.equal(250_000n);
    expect(destination.amount).to.equal(amount);
  });

  it("rejects the same malicious strategy after program-id pinning", async () => {
    const target = await initializeVault(fixed, "fixed", SystemProgram.programId);

    try {
      await fixed.methods
        .executeStrategy(new anchor.BN(750_000))
        .accounts({
          vault: target.vault,
          vaultAuthority: target.vaultAuthority,
          reserve: target.reserve,
          destination: target.destination,
          strategyProgram: attackerStrategy.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();
      throw new Error("fixed program unexpectedly accepted the attacker strategy");
    } catch (error) {
      expect(String(error)).to.include("InvalidStrategyProgram");
    }

    const reserve = await getAccount(provider.connection, target.reserve);
    const destination = await getAccount(provider.connection, target.destination);
    expect(reserve.amount).to.equal(1_000_000n);
    expect(destination.amount).to.equal(0n);
  });
});
