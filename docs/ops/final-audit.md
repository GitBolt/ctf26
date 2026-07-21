# CTF26 final audit

Updated: 2026-07-22

## Verdict

The ten-challenge system is ready for a final event rehearsal. The implementation now has one
participant identity model, bounded public request paths, generation-scoped state, durable solve
recovery, review-only integrity signals, explicit event timing, and fail-closed score finalization.

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
| Leaderboard | Nine binary captures plus Reward Sniper's relative market result |
| Integrity | Minimal evidence, suspicion ticket, two-organizer human decision |
| Finalization | Closed recovery, complete Reward event, resolved reviews, sealed snapshot |

The event is individual-only. Registration, challenge state, solve receipts, leaderboard rows,
integrity cases, eligibility, rank, and awards use one participant ID. There is no group identity.

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

Score freezing is atomic, so no concurrent capture or fast-solve signal can enter after the finalization
lock. Integrity intake has its own freeze and review seal. Finalization refuses stale Reward data, open
cases, pending eligibility, configuration drift, or an incomplete recovery window. Event phases advance
only through organizer controls, never through a deployment environment change, and the last stable
leaderboard remains available while final review is underway.

Eligibility never changes automatically. One organizer proposes an action and a different organizer
must approve or reject it. Later evidence can restore eligibility before the immutable snapshot.

## Challenge proof review

| Challenge | Security lesson | Authoritative proof |
| --- | --- | --- |
| Reward Sniper | stale reward accounting and adversarial timing | persistent commit and reveal market |
| IMPRINT | WebAuthn target binding | finalized assigned-target drain signed by enrolled owner |
| SIGNET | signer privilege through unpinned CPI | assigned reserve-to-escrow transition |
| DRIFT | adversarial Clock data | personalized exact SBF replay in LiteSVM |
| LAST STOP | ambiguous concatenated PDA seeds | stateful SSH journey and restricted card acceptance |
| AFTER HOURS | metadata mistaken for token identity | finalized counterfeit payment with invoice reference |
| PLAYER TWO | credential lifecycle and authority composition | finalized two-stage cabinet transition |
| The Broadcast | Ed25519 representation malleability | eight accepted encodings of one authorization |
| Evidence Room | uninitialized SPL account race | factory failure, participant initialization, close |
| Second Key | Token-2022 permanent delegate | pledge and exact delegated removal |

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
  exact credential count for IMPRINT, and exact count plus participant-ID digest for SIGNET.
- AFTER HOURS, PLAYER TWO, Evidence Room, and Second Key report field capacity based on current payer or
  treasury funding. Capacity is a launch condition, not merely a positive-balance check.
- Reward Sniper's official start and end are immutable configuration. Writes and scheduled or manual
  transitions stop at the exact end, and a restart cannot create a free late round.

The concurrency suite passed **23 of 23 tests**, modeling 40 concurrent participant
sessions across every service plus invalid and repeated traffic. It verified identity isolation,
one-use tickets, duplicate solves, bounded global work, atomic updates, and recovery. It does not
replace live canaries, resource monitoring, or an isolated validator.

## Integrity model

The integrity system is policy and evidence, not universal AI detection. It records narrow,
participant-bound workflow events without flags, credentials, wallets, signatures, raw commands, or
unrelated personal data. Service delivery is best effort and never blocks a legitimate solve.

A solve under five minutes creates a review ticket. It does not hide the solve, alter points, hold a
participant, or imply misconduct. Scripting, fuzzing, curl, headless use, a missing UI event, or speed
is not proof by itself.

Rules must state what conceptual assistance is allowed and prohibit sending challenge artifacts,
credentials, screenshots, output, or scored actions to an autonomous system. Prize action requires
preserved evidence, an author-led solve defense, two organizers, private notice, and an appeal path.

## Clean deployment surfaces

| Surface | Canonical staging URL |
| --- | --- |
| Portal | `https://stctf26.vercel.app` |
| Reward Sniper | `https://st26-reward.up.railway.app` |
| IMPRINT | `https://st26-imprint.vercel.app` |
| SIGNET | `https://st26-signet.up.railway.app` |
| DRIFT | `https://st26-drift.up.railway.app` |
| LAST STOP | `https://st26-laststop.up.railway.app` |
| AFTER HOURS | `https://after-hours-production-159b.up.railway.app` |
| PLAYER TWO | `https://st26-player2.up.railway.app` |
| The Broadcast | `https://st26-broadcast.up.railway.app` |
| Evidence Room | `https://st26-evidence.up.railway.app` |
| Second Key | `https://st26-secondkey.up.railway.app` |

AFTER HOURS keeps its existing hostname because immutable on-chain token metadata points to that
origin. The portal's Google OAuth base URL must remain on its currently allowlisted origin until the
short alias callback is added in Google Cloud and verified with a real sign-in.

## Official launch gates

1. Choose a new live generation and prove every participant completion namespace is empty.
2. Freeze the individual roster and confirm exact Portal, Reward, IMPRINT, and SIGNET inventory parity.
3. Reset Reward Sniper to a new event ID and rehearse start, rounds, cutoff, restart, and completion.
4. Provision isolated IMPRINT and SIGNET programs and targets for every participant.
5. Run Evidence Room on an isolated or access-controlled validator with a reset plan.
6. Give PLAYER TWO, Evidence Room, and Second Key separate funded disposable payers.
7. Use a private primary RPC plus an independent fallback and keep lock-sensitive services at one replica.
8. Run an authenticated launch, meaningful action, and completion canary for every challenge.
9. Rotate ticket, session, flag, Redis, integrity, Discord, organizer, and payer secrets after rehearsal.
10. Add and verify `https://stctf26.vercel.app/api/auth/google/callback` before changing the portal base URL.
11. Revoke the Discord webhook and QuickNode RPC credentials exposed in repository history before making
    the repository public.
12. Resolve every integrity case and eligibility proposal, then have two organizers verify the final ledger.

Keep the repository private until the event ends. It contains organizer answer material.

## Accepted dependency risk

Evidence Room and Second Key retain `bigint-buffer` advisory GHSA-3gc7-fjrx-p6mg with no compatible patch. Explicit fixed-offset parsing bypasses the vulnerable decoder. This is accepted reachability
risk, not a clean audit, and must be reassessed if decoder use or upstream support changes.

## Event lifecycle

Move from `staging` to `live`, then `recovery`, `freezing`, organizer review, and `frozen` through the
organizer console. Recovery
accepts only signed retries whose authoritative occurrence was inside the live window. Freezing stops
score ingest atomically. Frozen serves only the sealed snapshot and payout ledger.

## Primary references

[CTFd scoring](https://docs.ctfd.io/docs/custom-challenges/dynamic-value/), [Solana transactions](https://solana.com/docs/core/transactions),
[WebAuthn](https://www.w3.org/TR/webauthn-3/), and [OWASP resource controls](https://owasp.org/API-Security/editions/2023/en/0xa4-unrestricted-resource-consumption/).
