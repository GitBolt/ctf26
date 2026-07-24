import * as anchor from "@anchor-lang/core";
import { AnchorError, Program } from "@anchor-lang/core";
import { StChamberOfSecrets } from "../target/types/st_chamber_of_secrets";
import { ChamberCaller } from "../target/types/chamber_caller";
import { assert } from "chai";
import * as fs from "fs";
import * as path from "path";

const loadKeypair = (name: string): anchor.web3.Keypair =>
  anchor.web3.Keypair.fromSecretKey(
    new Uint8Array(
      JSON.parse(
        fs.readFileSync(path.join(__dirname, "..", ".keys", name), "utf-8")
      )
    )
  );

describe("the-chamber", () => {
  anchor.setProvider(anchor.AnchorProvider.env());
  const provider = anchor.getProvider() as anchor.AnchorProvider;

  const program = anchor.workspace.stChamberOfSecrets as Program<StChamberOfSecrets>;
  // Stands in for the arbitrary program a participant deploys to reach unlock_third.
  const caller = anchor.workspace.chamberCaller as Program<ChamberCaller>;

  const admin = loadKeypair("the-chamber-operator.json");
  const hidden = loadKeypair("the-chamber-hidden.json");
  const user = anchor.web3.Keypair.generate(); // happy-path participant
  const user2 = anchor.web3.Keypair.generate(); // never first-unlocks
  const user3 = anchor.web3.Keypair.generate(); // stops after the first unlock
  const mallory = anchor.web3.Keypair.generate(); // attacker

  const pdaFor = (wallet: anchor.web3.PublicKey): anchor.web3.PublicKey =>
    anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("user"), wallet.toBuffer()],
      program.programId
    )[0];

  const expectAnchorError = async (promise: Promise<unknown>, code: string) => {
    try {
      await promise;
      assert.fail(`expected AnchorError ${code}, but the call succeeded`);
    } catch (e) {
      assert.instanceOf(e, AnchorError, `expected AnchorError, got: ${e}`);
      assert.strictEqual((e as AnchorError).error.errorCode.code, code);
    }
  };

  before(async () => {
    for (const kp of [admin, hidden, user, user2, user3, mallory]) {
      const sig = await provider.connection.requestAirdrop(
        kp.publicKey,
        10 * anchor.web3.LAMPORTS_PER_SOL
      );
      const blockhash = await provider.connection.getLatestBlockhash();
      await provider.connection.confirmTransaction({ signature: sig, ...blockhash });
    }
  });

  describe("create_user", () => {
    it("fails when a non-admin signs", async () => {
      await expectAnchorError(
        program.methods
          .createUser()
          .accountsPartial({
            admin: mallory.publicKey,
            user: user.publicKey,
            userAccount: pdaFor(user.publicKey),
          })
          .signers([mallory])
          .rpc(),
        "UnauthorizedAdmin"
      );

      const account = await program.account.user.fetchNullable(pdaFor(user.publicKey));
      assert.isNull(account, "PDA must not exist after a rejected create");
    });

    it("succeeds when the admin signs, with all flags false", async () => {
      for (const wallet of [user, user2]) {
        await program.methods
          .createUser()
          .accountsPartial({
            admin: admin.publicKey,
            user: wallet.publicKey,
            userAccount: pdaFor(wallet.publicKey),
          })
          .signers([admin])
          .rpc();

        const account = await program.account.user.fetch(pdaFor(wallet.publicKey));
        assert.isTrue(account.user.equals(wallet.publicKey));
        assert.isFalse(account.firstUnlock);
        assert.isFalse(account.secondUnlock);
        assert.isFalse(account.thirdUnlock);
        assert.isFalse(account.chamberOpen);
      }
    });

    it("fails when the same user PDA is created twice", async () => {
      try {
        await program.methods
          .createUser()
          .accountsPartial({
            admin: admin.publicKey,
            user: user.publicKey,
            userAccount: pdaFor(user.publicKey),
          })
          .signers([admin])
          .rpc();
        assert.fail("second create_user for the same user should fail");
      } catch (e) {
        const details = [
          (e as Error).message ?? "",
          ...((e as { logs?: string[] }).logs ?? []),
        ].join("\n");
        assert.include(details, "already in use");
      }
    });
  });

  describe("unlock_first", () => {
    it("fails when another wallet targets someone else's PDA", async () => {
      await expectAnchorError(
        program.methods
          .unlockFirst()
          .accountsPartial({ user: mallory.publicKey, userAccount: pdaFor(user.publicKey) })
          .signers([mallory])
          .rpc(),
        "ConstraintSeeds"
      );

      const account = await program.account.user.fetch(pdaFor(user.publicKey));
      assert.isFalse(account.firstUnlock, "first_unlock must stay false");
    });

    it("succeeds for the PDA owner", async () => {
      await program.methods
        .unlockFirst()
        .accountsPartial({ user: user.publicKey, userAccount: pdaFor(user.publicKey) })
        .signers([user])
        .rpc();

      const account = await program.account.user.fetch(pdaFor(user.publicKey));
      assert.isTrue(account.firstUnlock);
      assert.isFalse(account.secondUnlock);
    });

    it("is a no-op when called again on an unlocked PDA", async () => {
      await program.methods
        .unlockFirst()
        .accountsPartial({ user: user.publicKey, userAccount: pdaFor(user.publicKey) })
        .signers([user])
        .rpc();

      const account = await program.account.user.fetch(pdaFor(user.publicKey));
      assert.isTrue(account.firstUnlock);
      assert.isFalse(account.secondUnlock);
    });
  });

  describe("unlock_second", () => {
    it("fails before first_unlock", async () => {
      await expectAnchorError(
        program.methods
          .unlockSecond()
          .accountsPartial({
            user: user2.publicKey,
            hidden: hidden.publicKey,
            userAccount: pdaFor(user2.publicKey),
          })
          .signers([user2, hidden])
          .rpc(),
        "FirstLockNotUnlocked"
      );

      const account = await program.account.user.fetch(pdaFor(user2.publicKey));
      assert.isFalse(account.secondUnlock);
    });

    it("fails when the hidden signer is not the hidden key", async () => {
      await expectAnchorError(
        program.methods
          .unlockSecond()
          .accountsPartial({
            user: user.publicKey,
            hidden: mallory.publicKey,
            userAccount: pdaFor(user.publicKey),
          })
          .signers([user, mallory])
          .rpc(),
        "UnauthorizedHiddenKey"
      );
    });

    it("fails when a non-owner co-signs with the hidden key", async () => {
      await expectAnchorError(
        program.methods
          .unlockSecond()
          .accountsPartial({
            user: mallory.publicKey,
            hidden: hidden.publicKey,
            userAccount: pdaFor(user.publicKey),
          })
          .signers([mallory, hidden])
          .rpc(),
        "ConstraintSeeds"
      );

      const account = await program.account.user.fetch(pdaFor(user.publicKey));
      assert.isFalse(account.secondUnlock, "second_unlock must stay false");
    });

    it("succeeds with the hidden key + owner after first_unlock", async () => {
      await program.methods
        .unlockSecond()
        .accountsPartial({
          user: user.publicKey,
          hidden: hidden.publicKey,
          userAccount: pdaFor(user.publicKey),
        })
        .signers([user, hidden])
        .rpc();

      const account = await program.account.user.fetch(pdaFor(user.publicKey));
      assert.isTrue(account.secondUnlock);
    });
  });

  describe("unlock_third", () => {
    // Invoke unlock_third through the caller program's CPI.
    const openThirdVia = (signer: anchor.web3.Keypair, pdaOwner: anchor.web3.PublicKey) =>
      caller.methods
        .openThird()
        .accountsPartial({
          user: signer.publicKey,
          userAccount: pdaFor(pdaOwner),
          chamberProgram: program.programId,
        })
        .signers([signer])
        .rpc();

    it("fails on a direct top-level call — must be a CPI", async () => {
      // `user` is already past locks 1 and 2, so the sequencing checks pass and
      // the stack-height gate is what rejects the direct (non-CPI) call.
      await expectAnchorError(
        program.methods
          .unlockThird()
          .accountsPartial({ user: user.publicKey, userAccount: pdaFor(user.publicKey) })
          .signers([user])
          .rpc(),
        "ThirdLockResists"
      );

      const account = await program.account.user.fetch(pdaFor(user.publicKey));
      assert.isFalse(account.thirdUnlock);
      assert.isFalse(account.chamberOpen);
    });

    it("fails via CPI before the earlier locks are open", async () => {
      await expectAnchorError(openThirdVia(user2, user2.publicKey), "FirstLockNotUnlocked");

      const account = await program.account.user.fetch(pdaFor(user2.publicKey));
      assert.isFalse(account.thirdUnlock);
    });

    it("fails via CPI when only the first lock is open", async () => {
      await program.methods
        .createUser()
        .accountsPartial({
          admin: admin.publicKey,
          user: user3.publicKey,
          userAccount: pdaFor(user3.publicKey),
        })
        .signers([admin])
        .rpc();
      await program.methods
        .unlockFirst()
        .accountsPartial({ user: user3.publicKey, userAccount: pdaFor(user3.publicKey) })
        .signers([user3])
        .rpc();

      await expectAnchorError(openThirdVia(user3, user3.publicKey), "SecondLockNotUnlocked");

      const account = await program.account.user.fetch(pdaFor(user3.publicKey));
      assert.isTrue(account.firstUnlock);
      assert.isFalse(account.secondUnlock);
      assert.isFalse(account.thirdUnlock);
    });

    it("fails via CPI when a non-owner signs", async () => {
      await expectAnchorError(openThirdVia(mallory, user.publicKey), "ConstraintSeeds");

      const account = await program.account.user.fetch(pdaFor(user.publicKey));
      assert.isFalse(account.thirdUnlock);
    });

    it("succeeds when an unprivileged program CPIs in after locks 1+2", async () => {
      // The caller program is not authorized in any way; unlock_third only
      // checks that *a* program invoked it, never *which* one. That is the bug.
      await openThirdVia(user, user.publicKey);

      const account = await program.account.user.fetch(pdaFor(user.publicKey));
      assert.isTrue(account.thirdUnlock);
      // The deployed program never writes chamber_open; the service derives the
      // open chamber from the three locks, so this must stay false.
      assert.isFalse(account.chamberOpen);
    });

    it("leaves every other participant untouched", async () => {
      const untouched = await program.account.user.fetch(pdaFor(user2.publicKey));
      assert.isFalse(untouched.firstUnlock);
      assert.isFalse(untouched.secondUnlock);
      assert.isFalse(untouched.thirdUnlock);
      assert.isFalse(untouched.chamberOpen);
    });
  });
});
