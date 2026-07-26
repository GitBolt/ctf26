# CTF26 final audit

Updated: 2026-07-25

## Verdict

The eleven-challenge system is ready for a final event rehearsal. The implementation now has one
participant identity model, bounded public request paths, generation-scoped state, durable solve
recovery, passive integrity signals, explicit event timing, and fail-closed score finalization.

This is not yet an official-launch clearance. The final roster, event generation, isolated challenge
infrastructure, funded disposable payers, private RPC, rotated secrets, Google callback, and historical
webhook revocation remain human launch gates. Several challenges are intentionally vulnerable, so a
shared public Devnet deployment cannot prevent one hostile participant from griefing another.

## Authority model

| Layer | Authority |
| --- | --- |
| Portal | Google identity, individual registration, rules acknowledgement, launch ticket |
| Challenge | Participant session, challenge state, proof verification, completion evidence |
| Chain or replay | Finalized transaction, account transition, or exact SBF execution |
| Score ingest | Challenge HMAC, participant ID, generation, occurrence time, live window |
| Leaderboard | Ten binary captures plus Reward Sniper's relative market result |
| Integrity | Minimal, read-only participant-bound observations |
| Finalization | Closed recovery, complete Reward event, locked configuration, sealed snapshot |

The event is individual-only. Registration, challenge state, solve receipts, leaderboard rows,
integrity observations, rank, and awards use one participant ID. There is no group identity.

Every durable namespace is generation-scoped. A rehearsal and official event must not share a
generation, Reward event ID, target inventory, state file, or completion receipt.

## Scoring and awards

- Each binary challenge begins at 1,000 points and approaches 250 as more checked-in participants solve
  it. All solvers receive the same current value, so speed is not a hidden score bonus.
- Reward Sniper contributes 1 to 1,000 points for positive relative performance. Qualification
  requires positive extraction in at least two scored rounds.
- Rank uses points only. Solve time is integrity context, not a tiebreaker.
- Award pool, individual floor, and top-ten weight boost are explicit event settings. Repository
  defaults are zero, so examples do not become financial promises.
- Exact ties at the top-ten boundary receive equal payout weight. Cent allocation is deterministic,
  exhausts the configured pool, and fails closed if the pool cannot fund the configured floor.
- Scoring policy, field, roster, generation, live and recovery windows, challenge set, payout policy,
  and Reward event identity are configuration-locked before finalization.

Score freezing is atomic, so no concurrent capture can enter after the finalization lock. Integrity
intake has its own freeze and evidence digest, but observations never affect points, rank, access, or
finalization. Finalization refuses stale Reward data, configuration drift, or an incomplete recovery
window. Event phases advance only through organizer controls, never through a deployment environment
change, and the last stable leaderboard remains available while the final snapshot is prepared.

## Challenge proof review

| Challenge | Security lesson | Authoritative proof |
| --- | --- | --- |
| Reward Sniper | stale reward accounting and adversarial timing | persistent commit and reveal market |
| IMPRINT | WebAuthn target binding | finalized assigned-target drain signed by the participant's registered owner |
| SIGNET | signer privilege through unpinned CPI | assigned reserve-to-escrow transition |
| DRIFT | adversarial Clock data | personalized exact SBF replay in LiteSVM |
| LAST STOP | ambiguous concatenated PDA seeds | stateful SSH journey and restricted card acceptance |
| AFTER HOURS | metadata mistaken for token identity | finalized counterfeit payment with invoice reference |
| PLAYER TWO | credential lifecycle and authority composition | finalized two-stage cabinet transition |
| The Broadcast | Ed25519 representation malleability | eight accepted encodings of one authorization |
| Evidence Room | uninitialized SPL account race | factory failure, participant initialization, close |
| Second Key | Token-2022 permanent delegate | pledge and exact delegated removal |
| The Chamber | CPI-shape check mistaken for authorization | all three locks open on the participant PDA, the third turned through a participant-deployed caller |

## Reliability and abuse controls

- Ticket signatures and participant admission are verified before scarce session or proof-verification
  budgets are consumed. Invalid floods cannot drain a valid participant's allowance.
- Shared Redis counters protect expensive public paths. In-memory fallbacks are for tests and local
  development, not multi-replica production.
- Public client identity prefers Railway's validated `X-Real-IP`, then trusted platform headers, then
  a conservative fallback. Arbitrary forwarded chains are not treated as authoritative.
- Railway TCP proxy does not expose a trustworthy per-client address to LAST STOP SSH. SSH therefore
  uses a global authentication budget, a hashed per-code budget, connection cap, and authentication
  timeout instead of claiming per-IP isolation.
- Health aggregation is cached and single-flight. Public leaderboard reads use a short edge cache.
  Completion fanout skips solved or unlaunched challenges and backs off unhealthy services.
- Inventory and capacity health checks fail closed. Portal health checks exact roster parity for Reward,
  funded dynamic provisioning for IMPRINT, and exact count plus participant-ID digest for SIGNET.
- SIGNET budgets the operator balance for every unprovisioned participant. A fresh generation may
  begin with an empty inventory; each approved participant is provisioned on first launch, and
  official readiness requires the resulting inventory to match the checked-in field exactly.
- AFTER HOURS, PLAYER TWO, Evidence Room, and Second Key report field capacity based on current payer or
  treasury funding. Capacity is a launch condition, not merely a positive-balance check.
- PLAYER TWO, Evidence Room, and Second Key use separate Devnet payers. Portal readiness rejects a future
  configuration that assigns one payer to more than one independently budgeted challenge.
- Reward Sniper's official start and end are immutable configuration. Writes and scheduled or manual
  transitions stop at the exact end, and a restart cannot create a free late round.

The concurrency suite passed **24 of 24 tests**, modeling 50 concurrent participant
sessions across every service plus invalid and repeated traffic. It verified identity isolation,
one-use tickets, duplicate solves, bounded global work, atomic updates, and recovery. It does not
replace live canaries, resource monitoring, or an isolated validator.

## Current deployed state

Observed on 2026-07-25:

- The portal is healthy in explicit staging mode with open rehearsal registration, zero checked-in
  participants, and two configured organizers. It is not presenting this as official readiness.
- The organizer console contains event lifecycle controls, Reward Sniper reset, system readiness, and a
  compact read-only observation feed. It has no participant marking, case workflow, eligibility override,
  or leaderboard exclusion control.
- Reward Sniper is complete for rehearsal event `3dd7604f-88f5-471b-aabc-91e79e40d5d8` on generation
  `ctf26-rehearsal-20260721-r2`. An official event requires a new generation and Reward event.
- IMPRINT reports `eventReady: true`, `targetMode: on-demand`, and funded dynamic provisioning when
  Redis, RPC, registrar, operator, and instance configuration are healthy.
- SIGNET is healthy on the rehearsal generation with three participant-bound targets. Approved Google
  sign-in attempts best-effort pre-provisioning, and first challenge launch retries provisioning if RPC
  access was temporarily unavailable.
- IMPRINT `5EgXikx8uaGDDRdLdxzoLsDafSruHZnNnstE7bd8wH6B`, SIGNET
  `GvX54HkYCVcM946oTSWMaV3MHhqWgHPf4CcLab2LZahR`, PLAYER TWO
  `BGJkBJaEHAakMso532hE1vfGdFkYX8dvjy9gDbCGN7eW`, and Second Key
  `NcPgcz4zQ2CKZK6evWYwGC6iFcdji2Yrw65nCoto5rn` are executable on Devnet. Dumped program bytes match
  the repository builds; IMPRINT and PLAYER TWO contain only normal trailing deployment padding.
- AFTER HOURS mint `95nuWsFkzdp3wB23FPBmroyAU8vJVqNVwzCSBE5ZeahH` has six decimals, fixed supply,
  immutable matching metadata, and no mint or freeze authority.
- The independent live funding checks pass: Evidence Room has 2.570 SOL against 2.516 required, Second
  Key has 2.818 SOL against 2.122 required, PLAYER TWO has 0.769 SOL against 0.618 required, and AFTER
  HOURS has 0.495 SOL against its 0.100 SOL fee-payer minimum.

## Integrity model

The integrity system is policy and evidence, not universal AI detection. It records narrow,
participant-bound workflow events without flags, credentials, wallets, signatures, raw commands, or
unrelated personal data. Service delivery is best effort and never blocks a legitimate solve.

A solve under five minutes creates a passive timing observation. It does not hide the solve, alter
points, hold a participant, block finalization, or imply misconduct. Scripting, fuzzing, curl, headless
use, a missing UI event, or speed is not proof by itself.

Rules must state what conceptual assistance is allowed and prohibit sending challenge artifacts,
credentials, screenshots, output, or scored actions to an autonomous system. Prize action requires
preserved evidence, an author-led solve defense, two organizers, private notice, and an appeal path.

## Clean deployment surfaces

| Surface | Canonical staging URL |
| --- | --- |
| Portal | `https://ctf26-eta.vercel.app` |
| Reward Sniper | `https://st26-reward.up.railway.app` |
| IMPRINT | `https://st26-imprint.vercel.app` |
| SIGNET | `https://st26-signet.up.railway.app` |
| DRIFT | `https://st26-drift.up.railway.app` |
| LAST STOP | `https://st26-laststop.up.railway.app` |
| AFTER HOURS | `https://st26-afterhours.up.railway.app` |
| PLAYER TWO | `https://st26-player2.up.railway.app` |
| The Broadcast | `https://st26-broadcast.up.railway.app` |
| Evidence Room | `https://st26-evidence.up.railway.app` |
| Second Key | `https://st26-secondkey.up.railway.app` |
| The Chamber | `https://st26-chamber.up.railway.app` |

AFTER HOURS keeps its existing hostname because immutable on-chain token metadata points to that
origin. The portal's Google OAuth base URL must remain on its currently allowlisted origin until the
short alias callback is added in Google Cloud and verified with a real sign-in.

## Official launch gates

1. Choose a new live generation and prove every participant completion namespace is empty.
2. Freeze the individual roster and confirm Portal and Reward parity, IMPRINT provisioning health, and
   SIGNET inventory coverage.
3. Reset Reward Sniper to a new event ID and rehearse start, rounds, cutoff, restart, and completion.
4. Confirm fresh identities can provision isolated IMPRINT and SIGNET targets on first launch.
5. Run Evidence Room on an isolated or access-controlled validator with a reset plan.
6. Confirm every disposable payer and treasury still covers the final individual field after provisioning.
7. Use a private primary RPC plus an independent fallback and keep lock-sensitive services at one replica.
8. Run an authenticated launch, meaningful action, and completion canary for every challenge.
9. Rotate ticket, session, flag, Redis, integrity, Discord, organizer, and payer secrets after rehearsal.
10. Keep `https://ctf26-eta.vercel.app/api/auth/google/callback` registered until the final custom domain is ready.
11. Revoke the Discord webhook and QuickNode RPC credentials exposed in repository history before making
    the repository public.
12. Have two organizers independently verify the final snapshot and payout ledger.

Keep the repository private until the event ends. It contains organizer answer material.

## Accepted dependency risk

SIGNET, Evidence Room, and Second Key retain `bigint-buffer` advisory GHSA-3gc7-fjrx-p6mg with no
compatible patch. Evidence Room and Second Key use fixed-offset parsing or instruction construction
instead of the vulnerable decoder. SIGNET reads only deterministic service-created mint and reserve
accounts during provisioning. This is accepted reachability risk, not a clean audit, and must be
reassessed if decoder use, account selection, RPC trust, or upstream support changes.

The actionable production advisories were removed: Portal and IMPRINT pin patched `sharp`, while SIGNET
and AFTER HOURS pin the patched transitive `uuid`. Production audits are otherwise clean.

## Event lifecycle

Move from `staging` to `live`, then `recovery`, `freezing`, and `frozen` through the organizer console.
Recovery accepts only signed retries whose authoritative occurrence was inside the live window. Freezing
stops score ingest atomically. Frozen serves only the sealed snapshot and payout ledger.

## Primary references

[CTFd scoring](https://docs.ctfd.io/docs/custom-challenges/dynamic-value/), [Solana transactions](https://solana.com/docs/core/transactions),
[WebAuthn](https://www.w3.org/TR/webauthn-3/), and [OWASP resource controls](https://owasp.org/API-Security/editions/2023/en/0xa4-unrestricted-resource-consumption/).
