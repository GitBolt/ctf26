# IMPRINT

Status: **complete and deployed**

Identity: passkey-controlled Solana vault

Core bug: missing vault-to-passkey owner binding

## Security core

The Anchor program verifies a real WebAuthn P-256 assertion through Solana's secp256r1 precompile. It
checks the passkey account, wallet owner, relying-party hash, user-presence and user-verification flags,
withdrawal challenge, signature form, destination, amount, and nonce.

It deliberately omits one check:

```rust
require!(
    passkey_pubkey == vault.registered_passkey,
    ImprintError::PasskeyNotBoundToVault
);
```

A participant can therefore register their own passkey, sign the exact withdrawal challenge, and use
that valid assertion to drain an assigned vault whose stored passkey is different.

## Participant experience

1. Launch through the authenticated portal.
2. Receive a unique funded vault created from the participant ID.
3. Connect any devnet Solana wallet.
4. Create a platform passkey on first use.
5. Approve the registrar-co-signed on-chain passkey registration.
6. Inspect the program and assigned target.
7. Construct the secp256r1 verification instruction and vulnerable withdrawal.
8. Submit the finalized exploit signature for authoritative verification.

Both passkey and vault creation happen on first launch. Redis stores the participant's credential and
serializes provisioning. The target address is deterministic, so retries and refreshes converge on the
same on-chain account. No attendance count, wallet roster, credential roster, or static target map is
required.

## Player materials

- Anchor program source and IDL
- Assigned target address and public account state
- Generic 32-byte passkey assertion workbench
- User-selected devnet wallet support
- Progressive hints

The workbench deliberately does not build the withdrawal challenge, secp256r1 instruction, or exploit
transaction.

## Scoring

IMPRINT is one binary capture under the shared rarity curve. The checker accepts only a finalized
transaction that:

- invokes the canonical IMPRINT program;
- drains the authenticated participant's assigned vault by the configured minimum;
- uses that participant's registered passkey PDA;
- is signed by the wallet that owns the passkey account.

Draining a participant-created lookalike or another assigned target does not score.

## Anti-agent position

The exploit requires a live platform-passkey assertion and Solana wallet approval. This is useful
interaction friction, but it is not a perfect autonomous-agent barrier because first-launch registration
is self-service. A virtual authenticator may satisfy WebAuthn without physical biometrics.

That is an explicit event tradeoff. The event does not have staff capacity for organizer enrollment.
Integrity telemetry, fast-solve review, and prize-contender review remain the backstop. Documentation
must not claim that self-enrollment is equivalent to organizer-observed hardware enrollment.

## Production configuration

- Program: `5EgXikx8uaGDDRdLdxzoLsDafSruHZnNnstE7bd8wH6B`
- Registrar: `AdtCf3S1zEHZ14js7G7vqN5EDatSGC9SxSTDotJBEvJF`
- Host: `https://st26-imprint.vercel.app`
- Target mode: `on-demand`
- Credential state: generation-scoped Redis
- Target derivation: HMAC of participant ID under a server-only instance secret
- Default target deposit: `10000000` lamports
- Required drain: `5000000` lamports

Health is ready only when durable Redis, the event generation, RPC, provisioning secrets, and an
adequately funded operator are available.

## Event checks

1. Launch with a fresh approved identity.
2. Confirm the first launch creates one target and refresh returns the same address.
3. Confirm registration displays the platform passkey prompt.
4. Confirm a different identity receives a different target.
5. Confirm returning use authenticates the stored passkey rather than registering another.
6. Confirm the registrar transaction can be signed by any participant-selected wallet.
7. Confirm a lookalike-vault drain is rejected.
8. Confirm a valid assigned-target drain produces one leaderboard solve.
