# THE CHAMBER

## Participant premise

A vault program holds one account per participant, derived at seeds `["user", wallet]` and provisioned by the challenge service under its own admin key. The account carries three locks and a chamber flag, all closed. The participant registers the wallet they intend to sign with, then opens the locks in order. The hosted surface reads the locks straight from Devnet and states only the objective of each: prove the account is yours, co-sign with the key issued to you at the venue, and turn the last lock.

There is no flag to submit. The solve is all three locks standing open on the participant's own PDA, read straight from devnet by the challenge service.

## Vulnerability

`unlock_third` gates on caller *shape* rather than caller *identity*:

```rust
require!(
    get_stack_height() > TRANSACTION_LEVEL_STACK_HEIGHT,
    ChamberError::ThirdLockResists
);
```

A wallet invoking the instruction directly runs at transaction level and is rejected. Any cross-program invocation runs deeper and passes. The vault never checks *which* program called it, so an entirely unprivileged program the participant writes and deploys themselves satisfies the constraint. This is authority/CPI confusion: the check reads as an authorization boundary and is not one.

The earlier locks are ordinary sequencing. `unlock_second` requires `first_unlock` and a co-signature from a hidden key; `unlock_third` requires both predecessors. Every constraint is bound to the participant's own PDA through `seeds` plus `has_one`, so opening one account never advances another.

## Intended solve

1. Register a working wallet; the service admin-signs `create_user` for it.
2. Call `unlock_first` signed by that wallet.
3. Recover the second signer from the physical card issued at the venue and co-sign `unlock_second`.
4. Call `unlock_third` directly, receive the deliberately vague `ThirdLockResists` message, and work out that the caller must itself be a program.
5. Write, deploy, and invoke a minimal Solana program that CPIs into `unlock_third`. The participant's signature on the outer transaction propagates through the invocation, so the vault still sees them as the PDA owner.

The service polls the account and reports the solve the moment all three locks are open, using the block time of the opening transaction as the solve time, read at the same commitment as the lock state that triggered it. It derives that state rather than reading the account's `chamber_open` byte, which the deployed program sets false at creation and never writes again. The portal's private completion contract performs the same reconciliation, so a participant who never reopens the page is still scored.

## Delivery and integrity

The program interface is published to the participant, so the security core is white-box by design — per `../strategy/anti-ai.md` §2 the resistance lives in the access and act layers, not in hiding the bug. Two gates sit there:

**Lock two was venue-local** (§4.3). The hidden key was never served over the network; its 64 bytes were Base64-encoded into a compact NDEF Text record on an NTAG213-compatible plain PVC card handed out at the desk. Participants read the card with NFC Tools or another NDEF reader, copied the Text value, and decoded it locally. This was a *pace* gate rather than a per-participant gate: one shared key served the whole field, so sharing remained possible after the first physical discovery.

**Lock three requires an unprompted deploy** (§4.7). The participant surface says only "turn the last lock" and the on-chain error explains nothing, per §6 law 7. Nothing in the brief names cross-program invocation. An agent handed the objective acts literally against the instruction it was given; the sideways step to *write and ship a second program* is the human instinct this challenge tests. That property survives only while the framing stays silent, so learner orientation belongs in the paid hint ladder, never in the default text.

Registration is exclusive in both directions for the event generation: one wallet per participant and one participant per wallet, arbitrated by an atomic write so two participants racing on the same wallet cannot both win. Only the admin key can call `create_user`, so a participant cannot provision an account outside a portal launch, and program-derived addresses are rejected at registration because they can never sign lock one.

Production pins the Devnet RPC, program ID, and admin keypair, and keeps generation-scoped state in Redis. The admin pays rent and fees for one account per participant; `/health` derives `capacity.maxParticipants` from the live payer balance, and portal readiness compares it with the checked-in field. The service runs at one replica: chain writes are serialized behind a per-participant lease and a single write slot.

The event used the prototype program at `Ekw4Zx3Nu9zTvCYsuzn1ubHNtgWjRAtm8PMUNavgmPXj`. Its operator and hidden keypairs were archived privately after the event and removed from the public tree. A fresh run must generate new challenge-scoped keys, update the program constants, and redeploy before issuing new NFC cards.
