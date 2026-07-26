# IMPRINT Internal Answer Key

Do not ship this file to players.

## Intended Bug

`withdraw_with_passkey` verifies:

- the supplied passkey PDA is registered;
- the Solana transaction is signed by that passkey account's registered wallet owner;
- `authenticatorData` matches the RP ID hash stored during verified enrollment and sets both the
  user-presence and user-verification flags;
- the secp256r1 precompile instruction verified the supplied compressed P-256 pubkey;
- the signed message is `authenticatorData || sha256(clientDataJSON)`;
- `clientDataJSON` contains `type:"webauthn.get"` and the current withdrawal challenge;
- the withdrawal challenge is bound to `(vault, destination, amount, nonce)`.

The missing check is the **vault-to-passkey** binding:

```rust
require!(
    passkey_pubkey == ctx.accounts.vault.registered_passkey,
    ImprintError::PasskeyNotBoundToVault
);
```

Because that check is absent, a solver can use any valid passkey account they own and sign the target
vault's withdrawal challenge with that passkey, so the vault's configured `registered_passkey` is ignored.

In the hosted IMPRINT deployment, the authenticated participant creates one platform passkey on first
launch. The credential is stored in generation-scoped Redis and returning launches must verify that
same passkey. The user-verification prompt remains required, but self-enrollment deliberately accepts
the virtual-authenticator risk documented in the challenge spec.

## Intended Patch

Add the owner-binding check immediately after `verify_secp256r1_instruction(...)` succeeds and before
any lamports move.

## Intended Solve

1. Create and claim the participant-bound platform passkey through `/api/passkey/claim`.
2. Read the target vault account and note that its `registered_passkey` differs from your claimed
   key.
3. Build the withdrawal challenge for the target vault, solver destination, chosen amount, and current
   nonce.
4. Use WebAuthn `navigator.credentials.get` to produce a P-256 assertion over that challenge.
5. Prepend the Solana secp256r1 verification instruction.
6. Call `withdraw_with_passkey` with the solver's wallet signature, passkey account, and the target
   vault.
