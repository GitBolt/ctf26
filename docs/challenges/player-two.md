# PLAYER TWO

Status: implementation contract

## Player-facing brief

The Neon Twin arcade has one rule: the jackpot opens for two active members.

Your cabinet profile was migrated before you arrived. The attendant says the old pass was retired and
the new pass is ready. The second reader is still waiting.

Open the jackpot.

## Experience

PLAYER TWO is a compact browser arcade game, not a landing page and not a form. The first screen is an
occupied cabinet: two pass readers flank a sealed prize chamber, the left reader already contains the
player's current pass, and the right reader is empty. A maintenance drawer, receipt printer, pass
scanner, and transaction lens are physical parts of the same machine.

The cabinet remains one continuous scene. Controls move, illuminate, jam, print, and react in place.
There are no disconnected marketing sections, giant headings, decorative dashboards, or meaningless
floating shapes. The important state is readable without scrolling on an ordinary laptop.

The visual direction is a late-night Japanese arcade maintenance bay: black lacquer, bruised violet
light, warm ticket paper, worn plastic, CRT bloom, and a restrained prize glow. Display text uses a
humanist sans face. Monospace is reserved for addresses, signatures, and transaction fields.

## Security core

The assigned participant begins with two membership pass accounts owned by the same holder:

- generation one was created during enrollment;
- generation two was created by a migration immediately before launch;
- the migration was intended to retire generation one;
- a lifecycle bug left generation one active.

The jackpot instruction accepts two pass accounts and two holder account positions. It verifies that
the pass account addresses differ and that both passes are active. It also verifies each pass against
the holder in its corresponding position. It does not require the two holder addresses to differ.

One participant can therefore place the current pass in one reader, recover the still-active earlier
pass from the migration transaction, place it in the other reader, and authorize both holder positions
with the same signer.

This is one coherent invariant failure with two coupled parts:

1. credential rotation did not revoke the predecessor;
2. uniqueness was checked at the credential layer instead of the principal layer.

The production fix is to revoke the old pass atomically during migration and require distinct holders
when the policy is two people, not merely distinct pass accounts.

## Intended human route

1. Launch from the event portal into an identity-bound cabinet session.
2. Pull the lever with the current pass mirrored into both readers.
3. Observe the cabinet reject the attempt because the pass account is duplicated.
4. Notice the migration receipt already protruding from the machine.
5. Pull it out and open its transaction signature in the cabinet's inspection lens.
6. Follow the transaction account flow to the earlier pass account.
7. Scan that address with the maintenance reader and observe that the pass is still active and belongs
   to the same member.
8. Insert the earlier pass in the empty reader, keep the current pass in the other reader, and pull the
   lever.
9. The service replays the exact account ordering against the native checker. The jackpot opens only
   after the assigned on-chain state transition succeeds.

The interface never labels the earlier account as the answer. The transaction lens shows ordinary
migration evidence: account roles, before and after state, and a directional account flow. The player
must decide which account matters and why.

## Fairness contract

- The migration receipt is visible at launch and remains recoverable.
- The receipt signature is unique to the participant instance.
- Every address required for the intended solution can be reached through the transaction lens.
- The manual scanner accepts any valid address shown by the lens and reports only public account data.
- A failed jackpot attempt consumes no unique credential and does not corrupt the instance.
- Error feedback distinguishes a duplicated pass from an inactive pass, holder mismatch, invalid
  account, and already-open jackpot without explaining the exploit.
- No flag, winning account pair, retired-pass semantic label, or solution trace is present in player
  HTML, JavaScript, source maps, public packages, logs, policy files, or static metadata.
- The server is authoritative. Client animation state never decides completion.

## Agent-resistance threat model

PLAYER TWO is not claimed to be AI-proof. Its goal is to prevent a participant from pointing an
autonomous agent at a clean API and receiving a scored solve without the intended investigation.

### Without browser or computer control

An API-only agent receives no public source, account enumeration endpoint, or semantic solve route.
Launch tickets are one-use and become an HttpOnly session. The ordinary state response contains the
current cabinet state but not the earlier pass address. Migration evidence is released only through
the authenticated receipt interaction and transaction inspection sequence. High-value requests are
bound to the event instance and logged in order.

A hostile custom client can still reproduce browser calls after reverse engineering the shipped
client. That is not treated as impossible. It must discover the interaction protocol, reconstruct the
transaction evidence, identify the stale account, and submit the real exploit transition. Policy
routes require compliant autonomous agents to disclose and stop. Policy compliance is evidence about
the policy layer, not proof of mechanical resistance.

### With browser or computer control

The browser presents a spatial apparatus whose state changes through direct manipulation. The
important evidence is conveyed by the receipt, animated account flow, reader lights, and scanner
result together. Controls retain accessible names and keyboard operation, so the challenge does not
exclude people who need assistive technology.

A capable multimodal browser agent may solve it. Resistance comes from requiring coherent perception,
stateful exploration, address transcription, causal interpretation, and a real final transition rather
than from inaccessible pixels or arbitrary reaction tests. The service records UI interaction order,
API-only divergence, machine-like cadence, policy discovery, disclosures, failed pairs, and completion
evidence for human review. No single signal disqualifies a participant.

## State and verification

Each participant receives fresh deterministic-but-secret instance material:

- participant holder;
- generation-one pass;
- generation-two pass;
- migration receipt signature;
- jackpot account;
- event nonce and challenge version.

The native program and checker are the authority for:

- pass ownership and active state;
- distinct pass accounts;
- pass-to-holder binding;
- holder signatures;
- the final jackpot-opened state.

The checker issues a participant-bound completion receipt only when the assigned jackpot changes from
closed to open in a replay of the submitted reader state. Reuse across another participant, event, or version
must fail.

## Integrity evidence

Retain synchronized events for launch, receipt removal, transaction inspection, account focus,
scanner reads, reader changes, lever pulls, native verification result, policy access, disclosure, and
completion. Store exact rejected account pairs and reason codes. Never collect wallet secrets, browser
history, unrelated files, or hidden device data.

Expected milestone sequence:

```text
launch -> duplicate attempt -> receipt -> transaction flow -> earlier pass scan
       -> two distinct passes -> native jackpot transition -> completion
```

Alternate legitimate routes include recognizing the migration problem before the first lever pull or
copying the relevant account directly from the receipt detail. Either route must still scan or submit
the assigned earlier pass and complete the native transition.

## Solve defense

Mechanism questions:

1. Which migration postcondition failed, and how did you verify it from account state?
2. Why are two distinct pass accounts sufficient for this program even though one person controls
   both?
3. Which check would you add to the jackpot instruction, and why is revocation alone still the correct
   migration fix?

Safe variation: reset the instance with a different holder and migration signature while preserving
the program behavior. The player must recover the new earlier pass and reproduce the transition.

## Release gates

- Native positive exploit and all negative controls pass.
- Clean-room humans discover the receipt route without organizer improvisation.
- The full interface fits at 1440 by 900 and remains usable at 390 by 844.
- Keyboard-only operation and reduced-motion behavior pass.
- Static asset inspection reveals no winning pair or completion secret.
- An API-only agent is forced through the evidence and exploit workflow rather than a clean solve
  endpoint.
- A browser agent test records milestones, interventions, false starts, and the exact final state.
- Portal completion, reset behavior, policy disclosure, deployment health, and production secret
  parity pass.

## Production configuration

Production must pin `SOLANA_RPC_URL` and `PLAYER_TWO_PROGRAM_ID` explicitly. It also requires the
event-only `PLAYER_TWO_DEVNET_KEYPAIR`, a strong `PLAYER_TWO_CHAIN_SECRET`, durable `REDIS_URL` storage,
the shared participant-ticket and leaderboard settings, and the session, completion, and integrity
secrets listed in `apps/player-two/.env.example`. Development may use the checked-in Devnet defaults,
but production never falls back to them silently. Set `PLAYER_TWO_EXPECTED_PARTICIPANTS` from the
final individual registration capacity, `PLAYER_TWO_PROVISION_FEE_BUFFER_LAMPORTS` to a conservative
per-participant transaction-fee allowance, and `PLAYER_TWO_MIN_PAYER_LAMPORTS` to the SOL safety
reserve that must remain after all outstanding allocations. The readiness probe reads current Devnet
rent for ten pass-sized accounts and one jackpot account, combines that rent with the fee allowance
for every remaining participant, and adds the safety reserve. A generation-scoped durable set counts
fully provisioned participant instances once, so retries and repeat sessions do not consume capacity
twice. `/health` returns aggregate counts and capacity booleans, not the payer address or secret.
