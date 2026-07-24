# THE CHAMBER — internal answer key

Organizer-only. Never ship this file, `programs/chamber-caller`, or the contents
of `.keys/` to participants.

The vault is the already-deployed prototype program at
`Ekw4Zx3Nu9zTvCYsuzn1ubHNtgWjRAtm8PMUNavgmPXj`; it is not redeployed for the event,
and `ADMIN_KEY` / `HIDDEN_KEY` are the inherited keys compiled into that bytecode.
The full public writeup for this challenge exists in the **private**
`KunalBagaria/ctf-2026` repository, along with both keypairs. Keep it private for
the duration of the event.

## Shape

Each participant gets a `User` PDA at seeds `["user", wallet]`, provisioned by the
service under `ADMIN_KEY` when they register a wallet. Four booleans start false:
`first_unlock`, `second_unlock`, `third_unlock`, `chamber_open`. The locks must be
turned in order.

`chamber_open` is a decoy in practice: the deployed program writes it false at
creation and never touches it again. The solve is all three locks being open, which
the service derives itself.

## Lock 1 — the wallet signs

`unlock_first` only requires a signature from the PDA owner.

```ts
await program.methods
  .unlockFirst()
  .accounts({ user: wallet.publicKey, userAccount: userPda })
  .signers([wallet])
  .rpc();
```

Learner floor. Anyone who can build a transaction clears it.

## Lock 2 — the venue card

`unlock_second` requires two signatures in one transaction: the PDA owner and
`HIDDEN_KEY`. It refuses to run until lock one is open (`FirstLockNotUnlocked`).

The hidden key is not published anywhere online. Participants are handed a plain
PVC card at the desk; an NFC tag inside holds the secret-key bytes. The intended
discovery is that the blank-looking card is readable at all. This is the
venue-local gate from `docs/strategy/anti-ai.md` §4.3 — a remote autonomous agent
cannot obtain it, while an on-site human recovers it in seconds.

```ts
const hidden = Keypair.fromSecretKey(hiddenSecretFromCard);
await program.methods
  .unlockSecond()
  .accounts({ user: wallet.publicKey, hidden: hidden.publicKey, userAccount: userPda })
  .signers([wallet, hidden])
  .rpc();
```

**Known limitation, decided deliberately.** One shared hidden key serves the whole
field, so the first participant to read a card can pass the bytes to anyone. Lock 2
is therefore a *pace* gate, not a per-participant gate: it holds until the first
leak and is expected to be public knowledge among on-site players well before the
event ends. Locks 1 and 3 are unaffected — they are bound to each participant's own
PDA and signature. If a future event needs lock 2 to survive sharing, store a
per-participant `hidden` pubkey in the `User` account at `create_user` and change
the constraint to `address = user_account.hidden`; that also requires one uniquely
programmed card per participant.

## Lock 3 — the CPI gate

`unlock_third` requires locks one and two, then:

```rust
require!(
    get_stack_height() > TRANSACTION_LEVEL_STACK_HEIGHT,
    ChamberError::ThirdLockResists
);
```

A wallet calling the instruction directly runs at transaction level and is
rejected with the deliberately vague message *"Unlocking the third lock isn't going
to be easy"*, which never states why. The instruction only runs when reached
through a cross-program invocation, so the participant must write and deploy their
own Solana program that CPIs into the vault. The vault checks only that *some*
program invoked it, never which one — the caller is entirely unprivileged.

`programs/chamber-caller` is the reference implementation used by the Anchor suite.
The participant's outer transaction signature propagates through the CPI, so the
vault still sees them as the PDA owner.

Per §6 law 7, the brief never names this. The participant surface says only "turn
the last lock".

## Expected human workflow

1. Launch from the portal, register a working wallet.
2. Turn lock one directly.
3. Realize the card is readable, recover the key, co-sign lock two.
4. Hit the vague failure on lock three, work out that the caller must be a program,
   write and deploy one, invoke it.

## Adjudication

Author defense questions for a contested solve:

- What exactly does `ThirdLockResists` detect, and why does a wallet trip it?
- Show the caller program you deployed and its program ID on devnet.
- Whose signature authorizes the PDA write inside the CPI, and how does it get there?
- Where did the second signer come from, and what does the card physically contain?

A solve reported within `FAST_SOLVE_REVIEW_SECONDS` of the participant's first
launch raises a portal review signal. That is a lead, not proof — lock two's
shared-key limitation above makes fast lock-two turns expected later in the event.
