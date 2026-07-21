# Internal staging runbook

Last updated: 2026-07-22 (Asia/Kolkata)

This document records the currently deployed **internal test environment**. It is not the final event
release manifest. Never copy secret values, ignored keypairs, or `.keys/` contents into this file.

## Live surfaces

| Surface | URL | Verified state |
| --- | --- | --- |
| Central portal | `https://stctf26.vercel.app` | Unified individual portal, leaderboard, and organizer console |
| Reward Sniper | `https://st26-reward.up.railway.app/` | **Challenge complete**; bounded market and immutable event cutoff |
| IMPRINT | `https://st26-imprint.vercel.app` | **Challenge complete**; passkey console and participant inventory health |
| SIGNET | `https://st26-signet.up.railway.app/` | Repository, live checker, and generation-bound target inventory |
| DRIFT | `https://st26-drift.up.railway.app/` | Exact native SBF replay service with Redis replay protection |
| LAST STOP | `https://st26-laststop.up.railway.app/` | Hosted SSH journey with TCP-safe global and per-code budgets |
| AFTER HOURS | `https://after-hours-production-159b.up.railway.app/` | Discord checkout service and Solana payment verifier live |
| PLAYER TWO | `https://st26-player2.up.railway.app/` | Devnet credential-lifecycle cabinet and native verifier |
| THE BROADCAST | `https://st26-broadcast.up.railway.app/` | Wallet-signature protocol and completion verifier |
| EVIDENCE ROOM | `https://st26-evidence.up.railway.app/` | Account-lifecycle service with Redis and payer-capacity health |
| SECOND KEY | `https://st26-secondkey.up.railway.app/` | Token-2022 custody service with Redis and payer-capacity health |

AFTER HOURS deliberately retains its longer Railway hostname because immutable on-chain NIGHT
metadata references that origin. Do not rename it without a migration plan for the published mint.
The short Vercel aliases are public, but the portal must keep its currently allowlisted Google OAuth
base URL until the new callback is added and tested in Google Cloud.

The active event model is individual-only. The portal has one organizer dashboard for lifecycle,
leaderboard finalization, eligibility, and integrity review. A solve under five minutes opens a
review-only ticket without changing visibility, score, rank, or eligibility. The final concurrency
simulation passed 23 of 23 tests with 40 concurrent participant sessions across every
service plus invalid and repeated traffic. Score freeze and integrity intake or review sealing are
separate atomic controls, and neither an integrity signal nor a review ticket changes score by itself.
Lifecycle changes are durable, one-way organizer actions. Deployments cannot silently advance or roll
back the event, and finalization locks solve intake, fast-solve review intake, and eligibility together.

The portal route slug and cryptographic ticket audience are intentionally separate. In particular,
`/api/launch/signet` issues an `aud=signet` ticket. Regression tests cover every catalogue mapping.
The portal health contract verifies all ten ticket secrets and hosted destinations, probes every
challenge health endpoint, exercises all eight private completion contracts, checks Reward Sniper's
scoreboard and authenticated integrity administration, confirms the active event generation and
Reward scoring configuration across all three Reward endpoints, and requires Redis to respond. Every
dependency probe has a short timeout and the public response exposes
only aggregate readiness, never URLs or credentials. A stale completion receipt or solve from another
event generation is ignored by the participant challenge board. Ticket receiver secrets were
synchronized with the portal production environment on 2026-07-20.

## Proof already completed

### Reward Sniper

**Challenge status: COMPLETE FOR THE CURRENT ITERATION.** Manual and autonomous-agent playtests have
validated the mechanics, stopping condition, integrity policy/disclosure path, behavioral evidence,
organizer review view, and reset hygiene. Do not return to challenge design during normal slate work.
Final synchronized timing, parameter selection, and event reset remain event operations; a future
on-chain rewrite would be a new explicitly approved revision.

- One Railway replica with `/data/reward-sniper-state.json` on a persistent volume.
- Live portal-ticket exchange, nine-bin market read, and production health check passed.
- A real service restart preserved the round, participant session, tickets, and score state.
- Durable state is generation-bound and scoring-config-bound. Official mode requires a scheduled start
  and an exact preloaded roster, and the portal pins both the market ID and scoring configuration hash.
- Focused market/service tests cover HttpOnly session recovery, synchronized waiting-room enforcement,
  cross-instance ticket replay rejection, and state/config mismatch rejection.

This staging build is the authoritative hosted implementation. It reproduces the intended live market,
commit/reveal, scarce-ticket, imperfect-telemetry, and relative-score mechanics. It is **not** yet the
private-validator Anchor implementation described by the long-form sponsor spec; that remains a
separate event-architecture decision and must not be represented as a Meteora pool or an on-chain
escrow.

### IMPRINT

**Challenge status: COMPLETE.** The security primitive, hardened verifier, anti-agent passkey gate,
checker, UI, deployed program, and AI/autonomous-agent evaluation are finished. The items below are
event operations for the final roster, not missing challenge mechanics.

- Program: `5EgXikx8uaGDDRdLdxzoLsDafSruHZnNnstE7bd8wH6B`
- Upgrade authority: `DWtP6GyDdye8hcpogEiAaGN2mJAVdvZV8TmsjFy9Mr4`
- Hardened deployment slot: `475397531`
- Upgrade transaction:
  `YcboFc29duUg9r7tz1LPGF7sdyjiMjFrGgj4hyGauGkTTp8doN4BuY2BSyaYnnyQ7xDdpW1kQCRrrAF9mCq2DwS`
- Local/deployed ELF SHA-256:
  `4a27829a0f993a82d339f617dea9220617bb4619bbe05cc6ff004eb8f889221c`
- Rehearsal target: `7p4iZ7pbm8zZf9y6g9b4GkEmD4QvGR4qLMefbgJAUjQe`
- Internal rehearsal balance: `1,001,572,960` lamports. This target must not be shared in production.
- The Anchor integration, Rust unit, and web/security suites pass.
- Production dependency audit is clean.

Before the event, seed one unique target per final roster participant and configure the complete server-only
`IMPRINT_PARTICIPANT_TARGETS_JSON` map in Vercel. Its participant IDs must exactly match the credential roster.
Before deploying the checker update to the current internal environment, set
`IMPRINT_TARGET_MODE=single-target-rehearsal` so the existing target remains an explicit non-event
fallback. For the event release, change the mode to `per-participant`, remove all legacy target variables,
and add the complete map in the same configuration change.

### SIGNET

- Staging vulnerable program: `9xN3K7QfVtkUhFUgVawMuNvWPePvfrmnDmBGDxpo3grD`
- Staging program SHA-256:
  `0f6ee1aa84f95189c3880e16eb4400954e333663f9a4ab8497248c332f07c854`
- Sacrificial solve transaction:
  `21Wg7QwmqfK2C11cL3q1ZZcysSCgbHBjRV7vs2yvN5gNJWMLdy9866de2ueDKeA8RmePQRwZ3ppC6AW3kJqXjsHv`
- The live checker accepted that transaction and returned a server-side HMAC flag.
- Fresh `internal-player` assignment remains unsolved: reserve `1,088,141`, escrow `0`, threshold
  `785,964` raw QRY.
- Twenty-nine app/service/build checks and both executable Anchor tests pass.
- The live sacrificial transaction was rechecked through a freshly issued participant ticket: the intended
  participant received a correctly formatted server flag, while reuse under `internal-player` failed with
  `wrong_target` and no flag.
- The application and starter-kit production dependency audits are clean.

The current program is deliberately **staging-only** because the public sacrificial transaction reveals
the exploit and attacker program. Event production must use new vulnerable program IDs and new targets;
prefer one program and target deployment per participant to remove cross-participant griefing.

### DRIFT

- Published SBF artifact SHA-256:
  `b508a98d849a33f760a22889241f7356c034d956cf79be376b2260344a60b0f5`
- The Railway image builds the locked LiteSVM harness and ships the exact published artifact.
- Live portal-ticket exchange, participant-bound target generation, one-time JTI rejection (`409`), and native
  replay execution passed after Redis credential rotation.
- A fresh production audit participant executed the intended five-step Clock trace against the deployed ELF,
  drained its `57,090`-unit reserve, and received a correctly formatted server flag. A funded
  deposit/withdraw round trip returned `422` and no flag.
- Twenty-three service/model/UI tests and seven native replay tests pass.

## Human and event-only gates

The following work cannot be safely guessed or automated from this repository:

> **Event-generation parity:** choose one new identifier for each rehearsal or scored run. Set that
> exact value as `CTF_EVENT_GENERATION` on AFTER HOURS, LAST STOP, PLAYER TWO, THE BROADCAST, Evidence
> Room, SECOND KEY, DRIFT, and SIGNET, and as `LEADERBOARD_EVENT_GENERATION` on the portal. A mismatch
> makes completion recovery fail closed. Never reuse a rehearsal generation for the live event, and
> provision fresh IMPRINT targets for the same run.

> **Production identity and SIGNET setup note:** event production now rejects unregistered accounts
> when `PARTICIPANT_ROSTER_JSON` is absent. An intentionally open production staging deployment must
> opt in with `ALLOW_OPEN_REGISTRATION=true`. Before public launch, configure the final
> approved-email roster and verify that an unlisted Google account is redirected with
> `error=not_registered`. Also replace SIGNET's current manually published target assumption with an
> automatic, idempotent first-launch setup: after an approved participant opens SIGNET, the service
> must create or assign that participant's challenge vault and escrow behind the scenes, show a short
> retryable “preparing challenge” state, and then continue into the challenge. Participants must not
> encounter `No target is assigned to this participant`, provide organizer-side setup data, or wait for a
> manual target publication. A repeated launch must reuse the same participant assignment rather than create
> another one.

1. **Google OAuth:** production credentials are configured. Add and verify
   `https://stctf26.vercel.app/api/auth/google/callback` before changing the portal base URL. Until
   then, keep `https://ctf26-eta.vercel.app/api/auth/google/callback` registered and complete a real
   browser sign-in and sign-out rehearsal with the final roster.
2. **Approved Google accounts:** set `PARTICIPANT_ROSTER_JSON` with the final approved emails and display
   names. Participant IDs are derived by the portal. Keep `ALLOW_OPEN_REGISTRATION=false` for the event.
   Before launch, test one approved account, one unlisted account, and normalization of email case.
3. **Replica safety:** keep PLAYER TWO, EVIDENCE ROOM, and SECOND KEY at one Railway replica unless their
   transaction queues are replaced with distributed Redis locks. Redis makes their state durable, but
   the current per-participant transaction mutexes are process-local.
4. **IMPRINT platform passkeys:** enroll one unique approved platform credential per final participant in
   person, verify the production credential roster and registrar key, then disable enrollment and
   rotate/remove the enrollment admin secret.
5. **IMPRINT isolation:** seed one unique funded target per final participant with a unique 16-byte vault ID,
   merge the script outputs into `IMPRINT_PARTICIPANT_TARGETS_JSON`, and confirm `/api/health` reports the same
   participant count as the credential roster with `eventReady: true`. Set `IMPRINT_TARGET_MODE=per-participant` and
   do not configure the rehearsal single-target variables in event production. Per-participant vaults
   prevent accidental reserve collisions, but the intentional owner-binding flaw means malicious
   cross-participant draining still requires per-participant program instances or an operator reset or reseed plan.
6. **SIGNET automatic participant setup:** remove the requirement for an organizer to manually publish a
   target for every participant. On the first authenticated SIGNET launch, atomically create or assign
   the participant-specific vault, reserve, escrow, mint, and challenge record from the portal-bound participant
   identity. Persist a setup state (`preparing`, `ready`, or retryable `failed`), make concurrent first
   launches converge on one assignment, and return a clear preparation screen instead of a generic
   service error. Participants may use any disposable devnet wallet for fees and exploit deployment;
   the assigned challenge state and checker, not a manually registered wallet, must bind the solve to
   the participant.
7. **SIGNET production isolation:** deploy fresh vulnerable program IDs and isolate participant targets so one
   participant cannot consume or corrupt another participant's challenge. Fund the organizer setup authority and
   document the maximum first-launch setup cost, retry policy, and rate limits. Close or quarantine the
   public staging attacker program before the event.
8. **RPC operations:** replace public devnet RPC endpoints with a private primary and an independent
   fallback before the event.
9. **Final secret rotation:** rotate all portal tickets, service sessions, flags, Redis credentials, and
   organizer-only secrets after staging testers finish.
10. **Public-history gate:** revoke and replace the Discord webhook and QuickNode RPC credentials exposed
    in repository history before making the repository public. A normal commit does not remove historical secrets.
11. **Human QA:** complete a clean-room solve and desktop/mobile/keyboard pass for every interface.
   Automated screenshot control was unavailable in the current runtime, so no screenshot review is
   claimed here.
12. **Integrity rules:** the portal already requires a signed, versioned, participant-bound
    acknowledgement before any challenge launch. Freeze the final permitted and prohibited AI-use
    matrix, participant-responsibility rule, immediate-submission rule, sanctions, evidence policy, and appeal path,
    then advance the rules version so every participant must acknowledge the final text.
13. **Reviewer staffing:** assign an integrity lead, incident scribe, appeal owner, and author-qualified
    reviewer per challenge. Publish the event-day rota and private escalation channel.
14. **Detection telemetry:** verify participant-bound timestamps for launches, hints, submissions, wrong values,
    checker results, replays/actions, and administrative changes. Exclude secrets and unrelated personal
    data from evidence exports.
15. **Solve-defense packets:** each author provides expected milestones, legitimate alternate paths,
    three adaptive questions, and one safe parameterized reproduction variant.
16. **Adjudication rehearsal:** dry-run a false positive, high-confidence case, mixed-compliance participant,
    and appeal. Confirm evidence preservation and reversible scoreboard holds/corrections.

## Repeatable checks

From the repository root:

```bash
npm test
npm run test:onchain
npm run build:web
npm run simulate:leaderboard
npm run simulate:load
npm run verify:portal
git diff --check
```

Public health checks:

```bash
curl -fsS https://stctf26.vercel.app/api/health
curl -fsS https://st26-reward.up.railway.app/api/health
curl -fsS https://st26-signet.up.railway.app/api/health
curl -fsS https://st26-drift.up.railway.app/health
curl -fsS https://st26-laststop.up.railway.app/health
curl -fsS https://after-hours-production-159b.up.railway.app/health
curl -fsS https://st26-player2.up.railway.app/health
curl -fsS https://st26-broadcast.up.railway.app/health
curl -fsS https://st26-evidence.up.railway.app/health
curl -fsS https://st26-secondkey.up.railway.app/health
curl -fsS https://st26-imprint.vercel.app/api/health
```

All deployment credentials and staging keypairs remain ignored. Back up the dedicated operator/program
keys offline before event reprovisioning; do not use a personal Solana wallet.

## Accepted SPL dependency advisory

`npm audit --omit=dev` currently reports GHSA-3gc7-fjrx-p6mg through
`@solana/spl-token` and `bigint-buffer` in EVIDENCE ROOM and SECOND KEY. The
suggested npm fix is an incompatible downgrade to `@solana/spl-token` 0.1.8,
not a supported security upgrade. Both services keep the package only for
account-size constants and instruction construction. Public RPC account bytes
are parsed with explicit owner, length, state, and fixed-offset checks, so the
advisory's `toBigIntLE` decoding path is not reachable. Treat this as an
accepted, reviewed dependency risk rather than a clean audit, and reassess it
if either service starts using SPL account decoders or a compatible upstream
fix is released.

## Historical build review and implementation audit

This section preserves the three self-review passes run after the initial challenge builds. It is a
historical audit record, not a claim of “AI-proof.” It checks whether each implementation matches the
doctrine: a real Solana security core, no static answer, a state-transition or replay checker, and
distinct anti-agent pressure.

### Pass 1: doctrine and challenge design

#### Reward Sniper

- Core: DLMM-style stale reward-window accounting, not source review.
- Built: market simulator, bins, active bin, stale windows, relative score, asymmetric telemetry,
  commit-reveal, HMAC execution vouchers, and three Sniper Tickets.
- Anti-agent layer: dynamic state, scarce high-value attempts, and the console/voucher gateway.
- Status: complete and validated for the current iteration. The hosted KOTH, persistent state,
  practice/scored rounds, resumable sessions, integrity controls, and autonomous-agent playtest were
  exercised successfully. Do not reopen its mechanics during routine slate work; revisit only for an
  explicitly requested future revision or event-day configuration. It remains deliberately off-chain
  and must not be presented as a deployed Meteora pool or on-chain settlement challenge.

#### IMPRINT

- Core: secp256r1/WebAuthn owner-binding miss in a passkey-controlled Solana vault.
- Built: Anchor program, WebAuthn registration/assertion web app, registrar co-sign flow, devnet
  deployment, target seeding, exploit tests, and negative tests.
- Anti-agent layer: organizer-pre-enrolled physical security key, live key assertion, and Solana
  wallet approval. The player service accepts no public WebAuthn registration.
- Status: complete. The hardened v2 program, canonical-target HMAC checker, deployed web console,
  physical-passkey gate, and autonomous-agent evaluation are complete. Final roster enrollment and
  target funding are event operations, not unfinished challenge mechanics.

#### SIGNET

- Core: stale pre-fix CPI/PDA authority bug discovered by reading a quiet strategy patch.
- Built: public 24-commit Anchor repository, stale target model, latest-fixed model, replay checker
  with HMAC flag, and the minimal archival checker UI.
- Anti-agent layer: messy source archaeology plus a live target state transition. Canaries remain
  telemetry only.
- Status: hosted staging is functional: public source repository, deterministic starter kit, exact
  on-chain checker, Redis-backed identity/rate state, and a live sacrificial target pass. Event launch
  still requires fresh program/target provisioning for the final roster and pre-enrollment of one
  disposable player-controlled Solana wallet per participant.

#### DRIFT

- Core: bytecode/localnet runtime bug where vault math trusts adversarial `Clock` time.
- Built: generated bytecode artifact, local runtime, forward/rewind exploit paths, replay checker, and
  no-string leak test.
- Anti-agent layer: no-source reverse engineering, a niche Solana sysvar/time insight, and deterministic
  replay.
- Status: finalized for event hosting. The compact JavaScript runtime is now only a test oracle; the
  authoritative path is a genuine stripped native SBF ELF, exact-byte LiteSVM replay checker,
  authenticated per-participant service, strict net-drain invariant, and player-only artifact package.

### Pass 2: implementation checks

- `apps/reward-sniper`: `npm test` passes; `npm run play -- commit-reveal` produces a scored extract.
- `apps/imprint`: `npm test` passes the Anchor tests; `npm run build` in `web/` passes.
- `apps/signet`: `npm test` passes; `npm run play -- demo-exploit` replays a drain and emits an
  HMAC flag.
- `apps/drift`: `npm test` passes; generated bytecode has no obvious strings from the challenge
  vocabulary; `npm run play -- demo-exploit` replays a drain and emits an HMAC flag.
- `apps/portal`: `npm run build` passes and lists the current catalogue.
- `prototypes/settlement-room-73`: `npm run build` passed after removing the private RPC fallback.

### Pass 3: operations and reviewer readiness

Fixed during review:

- Corrected Reward Sniper's accumulator/checkpoint primitive: the attacker must be checkpointed against
  the stale pre-settlement accumulator, then lazy settlement credits the stale window. Added a test
  proving a post-settlement checkpoint cannot capture backlog.
- Tightened DRIFT's replay boundary: the checker accepts canonical program instructions plus the
  declared clock schedule only, and rejects arbitrary account or SVM mutation such as `set_account`.
- Reframed SIGNET anti-agent claims: GitHub enumeration is not the security boundary. The live stale-
  target exploit and checker replay are; the target exposes an opaque build fingerprint instead of an
  exact commit.
- Removed the private QuickNode fallback from the old Settlement prototype.
- Replaced old “human-only” canary phrasing with autonomous-agent-restricted language.
- Updated the documentation from the earlier three-challenge slate to the then-current four-challenge
  slate and kept the portal catalogue aligned at that stage.
- Kept Phantom as a supported wallet branch but not a requirement; player-facing language says Solana
  wallet approval.

Known remaining work before a real public event:

- Reward Sniper: challenge work is complete. Choosing synchronized start time and round parameters and
  resetting the persistent market are event operations. Moving settlement on-chain is a separately
  approved future redesign, not unfinished work.
- SIGNET: rotate away from the public staging solve; finish automatic first-launch target creation,
  isolate each participant's challenge state, fund the setup authority, and verify every starter preflight
  against its generated manifest.
- DRIFT: complete the measured human, AI-assisted, and autonomous playtest matrix and decide timed
  release points for the organizer-only hint ladder. Its hosted exact-SBF service is already portal-wired.
- IMPRINT: pre-enroll the final physical-key roster, seed one isolated target per participant, publish the
  exact matching target map, disable the organizer enrollment route, and run the clean-room human
  solve. These are event operations; the challenge itself is complete.
- All challenges: run the required human-driven, AI-assisted-human, and autonomous-agent playtest matrix.
