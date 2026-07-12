const anchor = require("@coral-xyz/anchor");
const { expect } = require("chai");
const { p256 } = require("@noble/curves/p256");
const { sha256 } = require("@noble/hashes/sha256");

const {
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SYSVAR_INSTRUCTIONS_PUBKEY,
  Transaction,
  TransactionInstruction,
} = anchor.web3;

const SECP256R1_PROGRAM_ID = new PublicKey(
  "Secp256r1SigVerify1111111111111111111111111"
);
const SYSTEM_PROGRAM_ID = new PublicKey("11111111111111111111111111111111");
const DATA_START = 16;
const PUBKEY_SIZE = 33;
const SIGNATURE_SIZE = 64;
const U16_MAX = 0xffff;
const TEST_RP_ID = "localhost";
const TEST_RP_ID_HASH = Buffer.from(sha256(Buffer.from(TEST_RP_ID)));
const EVENT_REGISTRAR = Keypair.fromSecretKey(
  Uint8Array.from(require("../.keys/imprint-registrar-v2.json"))
);

function writeU16LE(buf, offset, value) {
  buf.writeUInt16LE(value, offset);
}

function base64Url(bytes) {
  return Buffer.from(bytes)
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

function challengeFor(vault, destination, amount, nonce) {
  const amountBytes = Buffer.alloc(8);
  amountBytes.writeBigUInt64LE(BigInt(amount));
  const nonceBytes = Buffer.alloc(8);
  nonceBytes.writeBigUInt64LE(BigInt(nonce));
  return base64Url(
    sha256(
      Buffer.concat([
        Buffer.from("IMPRINT_WITHDRAW_V1"),
        vault.toBuffer(),
        destination.toBuffer(),
        amountBytes,
        nonceBytes,
      ])
    )
  );
}

function newPasskey() {
  const secretKey = p256.utils.randomSecretKey();
  const publicKey = Buffer.from(p256.getPublicKey(secretKey, true));
  return { secretKey, publicKey };
}

function compactLowSSign(message, secretKey) {
  const signature = p256.sign(message, secretKey, {
    prehash: true,
    lowS: true,
  });
  return Buffer.from(signature.toCompactRawBytes());
}

function secp256r1Instruction({
  publicKey,
  signature,
  message,
  programId = SECP256R1_PROGRAM_ID,
  publicKeyInstructionIndex = U16_MAX,
  signatureInstructionIndex = U16_MAX,
  messageInstructionIndex = U16_MAX,
  numSignatures = 1,
}) {
  const publicKeyOffset = DATA_START;
  const signatureOffset = publicKeyOffset + PUBKEY_SIZE;
  const messageOffset = signatureOffset + SIGNATURE_SIZE;
  const data = Buffer.alloc(messageOffset + message.length);

  data[0] = numSignatures;
  data[1] = 0;
  writeU16LE(data, 2, signatureOffset);
  writeU16LE(data, 4, signatureInstructionIndex);
  writeU16LE(data, 6, publicKeyOffset);
  writeU16LE(data, 8, publicKeyInstructionIndex);
  writeU16LE(data, 10, messageOffset);
  writeU16LE(data, 12, message.length);
  writeU16LE(data, 14, messageInstructionIndex);

  publicKey.copy(data, publicKeyOffset);
  signature.copy(data, signatureOffset);
  message.copy(data, messageOffset);

  return new TransactionInstruction({
    programId,
    keys: [],
    data,
  });
}

function webAuthnLikeAssertion({
  challenge,
  secretKey,
  type = "webauthn.get",
  rpID = TEST_RP_ID,
  flags = 0x05,
}) {
  const authenticatorData = Buffer.concat([
    Buffer.from(sha256(Buffer.from(rpID))),
    Buffer.from([flags]),
    Buffer.alloc(4),
  ]);
  const clientDataJSON = Buffer.from(
    JSON.stringify({
      type,
      challenge,
      origin: "http://localhost:3002",
      crossOrigin: false,
    })
  );
  const message = Buffer.concat([authenticatorData, sha256(clientDataJSON)]);
  const signature = compactLowSSign(message, secretKey);

  return { authenticatorData, clientDataJSON, message, signature };
}

async function balance(provider, pubkey) {
  return provider.connection.getBalance(pubkey);
}

async function expectReject(promise, expected) {
  try {
    await promise;
    throw new Error("transaction unexpectedly succeeded");
  } catch (error) {
    expect(String(error)).to.include(expected);
  }
}

async function expectRejectAny(promise) {
  try {
    await promise;
    throw new Error("transaction unexpectedly succeeded");
  } catch (error) {
    expect(String(error)).to.not.include("transaction unexpectedly succeeded");
  }
}

function highS(signature) {
  const out = Buffer.from(signature);
  const s = BigInt(`0x${out.slice(32).toString("hex")}`);
  const order = BigInt(
    "0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551"
  );
  const high = order - s;
  const highBytes = Buffer.from(high.toString(16).padStart(64, "0"), "hex");
  highBytes.copy(out, 32);
  return out;
}

describe("imprint", () => {
  anchor.setProvider(anchor.AnchorProvider.env());

  const provider = anchor.getProvider();
  const program = anchor.workspace.imprint;
  const organizer = provider.wallet;
  const destination = Keypair.generate();
  let caseIndex = 0;

  async function setupCase() {
    caseIndex += 1;
    const attackerPasskey = newPasskey();
    const victimPasskey = newPasskey();
    const targetVaultId = Array.from(
      Buffer.from(`target-vault-${String(caseIndex).padStart(3, "0")}`)
    );
    const amount = new anchor.BN(0.04 * LAMPORTS_PER_SOL);
    const initialLamports = new anchor.BN(0.12 * LAMPORTS_PER_SOL);
    const attackerPasskeySeed = Buffer.from(sha256(attackerPasskey.publicKey));

    const [attackerPasskeyPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("passkey"), attackerPasskeySeed],
      program.programId
    );
    const [targetVault] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("vault"),
        organizer.publicKey.toBuffer(),
        Buffer.from(targetVaultId),
      ],
      program.programId
    );

    await program.methods
      .registerPasskey(
        Array.from(attackerPasskeySeed),
        Array.from(attackerPasskey.publicKey),
        Array.from(TEST_RP_ID_HASH)
      )
      .accounts({
        owner: organizer.publicKey,
        registrar: EVENT_REGISTRAR.publicKey,
        passkey: attackerPasskeyPda,
      })
      .signers([EVENT_REGISTRAR])
      .rpc();

    await program.methods
      .initializeVault(
        targetVaultId,
        Array.from(victimPasskey.publicKey),
        initialLamports
      )
      .accounts({
        authority: organizer.publicKey,
        vault: targetVault,
      })
      .rpc();

    return {
      attackerPasskey,
      attackerPasskeyPda,
      attackerPasskeySeed,
      victimPasskey,
      targetVault,
      amount,
    };
  }

  async function withdrawIx({
    setup,
    amount = setup.amount,
    destinationPubkey = destination.publicKey,
    assertion,
    index = 0,
  }) {
    return program.methods
      .withdrawWithPasskey(
        Array.from(setup.attackerPasskeySeed),
        Array.from(setup.attackerPasskey.publicKey),
        amount,
        index,
        assertion.clientDataJSON,
        assertion.authenticatorData
      )
      .accounts({
        vault: setup.targetVault,
        owner: organizer.publicKey,
        passkey: setup.attackerPasskeyPda,
        destination: destinationPubkey,
        instructions: SYSVAR_INSTRUCTIONS_PUBKEY,
      })
      .instruction();
  }

  function validAssertion(
    setup,
    nonce = 0,
    amount = setup.amount,
    destinationPubkey = destination.publicKey,
    type
  ) {
    const challenge = challengeFor(
      setup.targetVault,
      destinationPubkey,
      amount.toNumber(),
      nonce
    );
    return webAuthnLikeAssertion({
      challenge,
      secretKey: setup.attackerPasskey.secretKey,
      type,
    });
  }

  function validPrecompile(setup, assertion) {
    return secp256r1Instruction({
      publicKey: setup.attackerPasskey.publicKey,
      signature: assertion.signature,
      message: assertion.message,
    });
  }

  it("rejects passkey registration without the event registrar", async () => {
    const attackerPasskey = newPasskey();
    const attackerPasskeySeed = Buffer.from(sha256(attackerPasskey.publicKey));
    const fakeRegistrar = Keypair.generate();
    const [attackerPasskeyPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("passkey"), attackerPasskeySeed],
      program.programId
    );

    try {
      await program.methods
        .registerPasskey(
          Array.from(attackerPasskeySeed),
          Array.from(attackerPasskey.publicKey),
          Array.from(TEST_RP_ID_HASH)
        )
        .accounts({
          owner: organizer.publicKey,
          registrar: fakeRegistrar.publicKey,
          passkey: attackerPasskeyPda,
        })
        .signers([fakeRegistrar])
        .rpc();
      throw new Error("registration unexpectedly succeeded");
    } catch (error) {
      expect(String(error)).to.include("InvalidRegistrar");
    }
  });

  it("allows the intended cross-vault passkey exploit", async () => {
    const setup = await setupCase();
    const assertion = validAssertion(setup);

    const before = await balance(provider, destination.publicKey);
    const precompileIx = validPrecompile(setup, assertion);
    const ix = await withdrawIx({ setup, assertion });

    await provider.sendAndConfirm(new Transaction().add(precompileIx, ix), []);

    const after = await balance(provider, destination.publicKey);
    expect(after - before).to.equal(setup.amount.toNumber());

    const vaultAccount = await program.account.vault.fetch(setup.targetVault);
    expect(vaultAccount.nonce.toNumber()).to.equal(1);
    expect(
      Buffer.from(vaultAccount.registeredPasskey).equals(
        setup.victimPasskey.publicKey
      )
    ).to.equal(true);
  });

  it("requires the passkey owner's Solana wallet signature", async () => {
    const setup = await setupCase();
    const assertion = validAssertion(setup);
    const otherOwner = Keypair.generate();
    const ix = await program.methods
      .withdrawWithPasskey(
        Array.from(setup.attackerPasskeySeed),
        Array.from(setup.attackerPasskey.publicKey),
        setup.amount,
        0,
        assertion.clientDataJSON,
        assertion.authenticatorData
      )
      .accounts({
        vault: setup.targetVault,
        owner: otherOwner.publicKey,
        passkey: setup.attackerPasskeyPda,
        destination: destination.publicKey,
        instructions: SYSVAR_INSTRUCTIONS_PUBKEY,
      })
      .instruction();

    await expectReject(
      provider.sendAndConfirm(
        new Transaction().add(validPrecompile(setup, assertion), ix),
        [otherOwner]
      ),
      "PasskeyOwnerMismatch"
    );
  });

  it("rejects an assertion for a different RP ID", async () => {
    const setup = await setupCase();
    const challenge = challengeFor(
      setup.targetVault,
      destination.publicKey,
      setup.amount.toNumber(),
      0
    );
    const assertion = webAuthnLikeAssertion({
      challenge,
      secretKey: setup.attackerPasskey.secretKey,
      rpID: "attacker.invalid",
    });
    const ix = await withdrawIx({ setup, assertion });

    await expectReject(
      provider.sendAndConfirm(
        new Transaction().add(validPrecompile(setup, assertion), ix),
        []
      ),
      "RpIdHashMismatch"
    );
  });

  it("rejects an assertion without user verification", async () => {
    const setup = await setupCase();
    const challenge = challengeFor(
      setup.targetVault,
      destination.publicKey,
      setup.amount.toNumber(),
      0
    );
    const assertion = webAuthnLikeAssertion({
      challenge,
      secretKey: setup.attackerPasskey.secretKey,
      flags: 0x01,
    });
    const ix = await withdrawIx({ setup, assertion });

    await expectReject(
      provider.sendAndConfirm(
        new Transaction().add(validPrecompile(setup, assertion), ix),
        []
      ),
      "UserVerificationRequired"
    );
  });

  it("rejects an assertion without user presence", async () => {
    const setup = await setupCase();
    const challenge = challengeFor(
      setup.targetVault,
      destination.publicKey,
      setup.amount.toNumber(),
      0
    );
    const assertion = webAuthnLikeAssertion({
      challenge,
      secretKey: setup.attackerPasskey.secretKey,
      flags: 0x04,
    });
    const ix = await withdrawIx({ setup, assertion });

    await expectReject(
      provider.sendAndConfirm(
        new Transaction().add(validPrecompile(setup, assertion), ix),
        []
      ),
      "UserPresenceRequired"
    );
  });

  it("rejects replay after the vault nonce changes", async () => {
    const setup = await setupCase();
    const assertion = validAssertion(setup);
    const first = await withdrawIx({ setup, assertion });

    await provider.sendAndConfirm(
      new Transaction().add(validPrecompile(setup, assertion), first),
      []
    );

    const replay = await withdrawIx({ setup, assertion });
    await expectReject(
      provider.sendAndConfirm(
        new Transaction().add(validPrecompile(setup, assertion), replay),
        []
      ),
      "InvalidClientData"
    );
  });

  it("rejects a challenge bound to the wrong amount", async () => {
    const setup = await setupCase();
    const wrongAmount = new anchor.BN(setup.amount.toNumber() + 1);
    const assertion = validAssertion(setup, 0, wrongAmount);
    const ix = await withdrawIx({ setup, assertion });

    await expectReject(
      provider.sendAndConfirm(
        new Transaction().add(validPrecompile(setup, assertion), ix),
        []
      ),
      "InvalidClientData"
    );
  });

  it("rejects a longer WebAuthn challenge that merely contains the expected challenge", async () => {
    const setup = await setupCase();
    const expectedChallenge = challengeFor(
      setup.targetVault,
      destination.publicKey,
      setup.amount.toNumber(),
      0
    );
    const assertion = webAuthnLikeAssertion({
      challenge: `prefix-${expectedChallenge}-suffix`,
      secretKey: setup.attackerPasskey.secretKey,
    });
    const ix = await withdrawIx({ setup, assertion });

    await expectReject(
      provider.sendAndConfirm(
        new Transaction().add(validPrecompile(setup, assertion), ix),
        []
      ),
      "InvalidClientData"
    );
  });

  it("rejects a missing secp256r1 precompile instruction", async () => {
    const setup = await setupCase();
    const assertion = validAssertion(setup);
    const ix = await withdrawIx({ setup, assertion });

    await expectReject(
      provider.sendAndConfirm(new Transaction().add(ix), []),
      "InvalidSecp256r1Instruction"
    );
  });

  it("requires the secp256r1 verification to immediately precede the withdrawal", async () => {
    const setup = await setupCase();
    const assertion = validAssertion(setup);
    const ix = await withdrawIx({ setup, assertion, index: 0 });

    await expectReject(
      provider.sendAndConfirm(
        new Transaction().add(
          validPrecompile(setup, assertion),
          validPrecompile(setup, assertion),
          ix
        ),
        []
      ),
      "InvalidSecp256r1Instruction"
    );
  });

  it("rejects a secp256r1 instruction for a different passkey", async () => {
    const setup = await setupCase();
    const other = newPasskey();
    const challenge = challengeFor(
      setup.targetVault,
      destination.publicKey,
      setup.amount.toNumber(),
      0
    );
    const assertion = webAuthnLikeAssertion({
      challenge,
      secretKey: other.secretKey,
    });
    const precompileIx = secp256r1Instruction({
      publicKey: other.publicKey,
      signature: assertion.signature,
      message: assertion.message,
    });
    const ix = await withdrawIx({ setup, assertion });

    await expectReject(
      provider.sendAndConfirm(new Transaction().add(precompileIx, ix), []),
      "Secp256r1PubkeyMismatch"
    );
  });

  it("rejects a wrong precompile instruction index", async () => {
    const setup = await setupCase();
    const assertion = validAssertion(setup);
    const other = newPasskey();
    const otherAssertion = webAuthnLikeAssertion({
      challenge: challengeFor(
        setup.targetVault,
        destination.publicKey,
        setup.amount.toNumber(),
        0
      ),
      secretKey: other.secretKey,
    });
    const wrongPrecompileIx = secp256r1Instruction({
      publicKey: other.publicKey,
      signature: otherAssertion.signature,
      message: otherAssertion.message,
    });
    const ix = await withdrawIx({ setup, assertion: otherAssertion, index: 1 });

    await expectReject(
      provider.sendAndConfirm(
        new Transaction().add(
          validPrecompile(setup, assertion),
          wrongPrecompileIx,
          ix
        ),
        []
      ),
      "Secp256r1PubkeyMismatch"
    );
  });

  it("rejects tampered clientDataJSON after signing", async () => {
    const setup = await setupCase();
    const assertion = validAssertion(setup);
    const tamperedClientDataJSON = Buffer.from(
      assertion.clientDataJSON
        .toString()
        .replace('"crossOrigin":false', '"crossOrigin":true')
    );
    const tampered = {
      ...assertion,
      clientDataJSON: tamperedClientDataJSON,
    };
    const ix = await withdrawIx({ setup, assertion: tampered });

    await expectReject(
      provider.sendAndConfirm(
        new Transaction().add(validPrecompile(setup, assertion), ix),
        []
      ),
      "Secp256r1MessageMismatch"
    );
  });

  it("rejects a webauthn.create registration assertion for withdraw", async () => {
    const setup = await setupCase();
    const assertion = validAssertion(
      setup,
      0,
      setup.amount,
      destination.publicKey,
      "webauthn.create"
    );
    const ix = await withdrawIx({ setup, assertion });

    await expectReject(
      provider.sendAndConfirm(
        new Transaction().add(validPrecompile(setup, assertion), ix),
        []
      ),
      "InvalidClientData"
    );
  });

  it("rejects high-S secp256r1 signatures", async () => {
    const setup = await setupCase();
    const assertion = validAssertion(setup);
    const highSIx = secp256r1Instruction({
      publicKey: setup.attackerPasskey.publicKey,
      signature: highS(assertion.signature),
      message: assertion.message,
    });
    const ix = await withdrawIx({ setup, assertion });

    await expectRejectAny(
      provider.sendAndConfirm(new Transaction().add(highSIx, ix), [])
    );
  });
});
