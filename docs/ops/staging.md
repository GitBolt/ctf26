# Internal staging runbook

Last verified: 2026-07-15 (Asia/Kolkata)

This document records the currently deployed **internal test environment**. It is not the final event
release manifest. Never copy secret values, ignored keypairs, or `.keys/` contents into this file.

## Live surfaces

| Surface | URL | Verified state |
| --- | --- | --- |
| Central portal | `https://ctf26-eta.vercel.app` | Production build live; all six catalogue launch mappings are covered by portal tests |
| Reward Sniper | `https://reward-sniper-production.up.railway.app/web/` | **Challenge complete**; mechanics and autonomous-agent resistance validated |
| IMPRINT | `https://imprint-sage.vercel.app` | **Challenge complete**; hardened devnet program and updated five-stage console live |
| SIGNET | `https://signet-production-4018.up.railway.app/` | Public repository/live target/checker; solved proof plus a fresh internal target |
| DRIFT | `https://drift-production-c697.up.railway.app/` | Exact native SBF replay service; Redis replay protection live |
| LAST STOP | `https://last-stop-production.up.railway.app/` | Hosted SSH gateway and per-session terminal journey live |
| AFTER HOURS | `https://after-hours-production-159b.up.railway.app/` | Discord checkout service and Solana payment verifier live |

The portal route slug and cryptographic ticket audience are intentionally separate. In particular,
`/api/launch/signet` issues an `aud=signet` ticket. A regression test covers all four mappings.

## Proof already completed

### Reward Sniper

**Challenge status: COMPLETE FOR THE CURRENT ITERATION.** Manual and autonomous-agent playtests have
validated the mechanics, stopping condition, integrity policy/disclosure path, behavioral evidence,
organizer review view, and reset hygiene. Do not return to challenge design during normal slate work.
Final synchronized timing, parameter selection, and event reset remain event operations; a future
on-chain rewrite would be a new explicitly approved revision.

- One Railway replica with `/data/reward-sniper-state.json` on a persistent volume.
- Live portal-ticket exchange, nine-bin market read, and production health check passed.
- A real service restart preserved the round, team session, tickets, and score state.
- Twenty-six market/service tests pass, including HttpOnly session recovery and synchronized waiting
  room enforcement; the production dependency audit is clean.

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
- Canonical target: `7p4iZ7pbm8zZf9y6g9b4GkEmD4QvGR4qLMefbgJAUjQe`
- Internal staging balance: `1,001,572,960` lamports, enough for two qualifying `0.5 SOL` solves.
- Sixteen Anchor integration tests, four Rust unit tests, and seventeen web/security tests pass.
- Production dependency audit is clean.

The target capacity is intentionally only two for internal testing. Before the event, rerun the
capacity-aware setup script with the final maximum solver count and update
`IMPRINT_INITIAL_TARGET_LAMPORTS` in Vercel.

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
- The live sacrificial transaction was rechecked through a freshly issued team ticket: the intended
  team received a correctly formatted server flag, while reuse under `internal-player` failed with
  `wrong_target` and no flag.
- The application and starter-kit production dependency audits are clean.

The current program is deliberately **staging-only** because the public sacrificial transaction reveals
the exploit and attacker program. Event production must use new vulnerable program IDs and new targets;
prefer one program/target deployment per team to remove cross-team griefing.

### DRIFT

- Published SBF artifact SHA-256:
  `9d22f4172796c78b294ea8478c529e12545f4787ff601e3c10d65b96f57bd0bd`
- The Railway image builds the locked LiteSVM harness and ships the exact published artifact.
- Live portal-ticket exchange, team-bound target generation, one-time JTI rejection (`409`), and native
  replay execution passed after Redis credential rotation.
- A fresh production audit team executed the intended five-step Clock trace against the deployed ELF,
  drained its `57,090`-unit reserve, and received a correctly formatted server flag. A funded
  deposit/withdraw round trip returned `422` and no flag.
- Twenty-three service/model/UI tests and seven native replay tests pass.

## Human and event-only gates

The following work cannot be safely guessed or automated from this repository:

1. **Google OAuth:** create/provide `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`, and register exactly
   `https://ctf26-eta.vercel.app/api/auth/google/callback`. The portal intentionally returns `500` from
   the OAuth start route until these are configured.
2. **Participant roster:** set `PARTICIPANT_ROSTER_JSON` with final registered emails and team IDs. The
   current empty setting is suitable only for early internal testing, where each account becomes its
   own team.
3. **IMPRINT platform passkeys:** enroll one unique approved platform credential per final team in
   person, verify the production credential roster and registrar key, then disable enrollment and
   rotate/remove the enrollment admin secret.
4. **IMPRINT capacity:** choose the actual maximum number of full solves and fund the canonical target
   accordingly. Total top-up from the original one-solve baseline is `0.5 × (solve_count - 1)` devnet
   SOL; from the current two-solve staging balance, the additional amount is
   `0.5 × max(0, solve_count - 2)` SOL.
5. **SIGNET wallet enrollment:** collect one disposable Solana public key per team before provisioning,
   reject duplicate and personal-wallet registrations, and verify the starter preflight signer matches
   both the target `teamWallet` and escrow owner. Teams retain their private keys.
6. **SIGNET production isolation:** deploy fresh program IDs/targets, fund each participant wallet for
   its intended strategy path (the current full Anchor strategy build needs roughly `1.41 SOL` rent
   plus fees), publish final manifests, and close or quarantine the public staging attacker program.
7. **RPC operations:** replace public devnet RPC endpoints with a private primary and an independent
   fallback before the event.
8. **Final secret rotation:** rotate all portal tickets, service sessions, flags, Redis credentials, and
   organizer-only secrets after staging testers finish.
9. **Human QA:** complete a clean-room solve and desktop/mobile/keyboard pass for every interface.
   Automated screenshot control was unavailable in the current runtime, so no screenshot review is
   claimed here.
10. **Integrity rules:** freeze the permitted/prohibited AI-use matrix, team-liability rule,
    immediate-submission rule, sanctions, evidence policy, and appeal path. Require acknowledgement at
    registration and first scored launch.
11. **Reviewer staffing:** assign an integrity lead, incident scribe, appeal owner, and author-qualified
    reviewer per challenge. Publish the event-day rota and private escalation channel.
12. **Detection telemetry:** verify team-bound timestamps for launches, hints, submissions, wrong values,
    checker results, replays/actions, and administrative changes. Exclude secrets and unrelated personal
    data from evidence exports.
13. **Solve-defense packets:** each author provides expected milestones, legitimate alternate paths,
    three adaptive questions, and one safe parameterized reproduction variant.
14. **Adjudication rehearsal:** dry-run a false positive, high-confidence case, mixed-compliance team,
    and appeal. Confirm evidence preservation and reversible scoreboard holds/corrections.

## Repeatable checks

From the repository root:

```bash
npm test
npm run test:onchain
npm run verify:portal
git diff --check
```

Public health checks:

```bash
curl -fsS https://reward-sniper-production.up.railway.app/api/health
curl -fsS https://signet-production-4018.up.railway.app/api/health
curl -fsS https://drift-production-c697.up.railway.app/health
```

All deployment credentials and staging keypairs remain ignored. Back up the dedicated operator/program
keys offline before event reprovisioning; do not use a personal Solana wallet.

## Historical build review and implementation audit

This section preserves the three self-review passes run after the initial challenge builds. It is a
historical audit record, not a claim of “AI-proof.” It checks whether each implementation matches the
doctrine: a real Solana security core, no static answer, a state-transition or replay checker, and
distinct anti-agent pressure.

### Pass 1 — doctrine and challenge design

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
  disposable player-controlled Solana wallet per team.

#### DRIFT

- Core: bytecode/localnet runtime bug where vault math trusts adversarial `Clock` time.
- Built: generated bytecode artifact, local runtime, forward/rewind exploit paths, replay checker, and
  no-string leak test.
- Anti-agent layer: no-source reverse engineering, a niche Solana sysvar/time insight, and deterministic
  replay.
- Status: finalized for event hosting. The compact JavaScript runtime is now only a test oracle; the
  authoritative path is a genuine stripped native SBF ELF, exact-byte LiteSVM replay checker,
  authenticated per-team service, strict net-drain invariant, and player-only artifact package.

### Pass 2 — implementation checks

- `apps/reward-sniper`: `npm test` passes; `npm run play -- commit-reveal` produces a scored extract.
- `apps/imprint`: `npm test` passes the Anchor tests; `npm run build` in `web/` passes.
- `apps/signet`: `npm test` passes; `npm run play -- demo-exploit` replays a drain and emits an
  HMAC flag.
- `apps/drift`: `npm test` passes; generated bytecode has no obvious strings from the challenge
  vocabulary; `npm run play -- demo-exploit` replays a drain and emits an HMAC flag.
- `apps/portal`: `npm run build` passes and lists the current catalogue.
- `apps/settlement-room-73`: `npm run build` passes after removing the private RPC fallback.

### Pass 3 — operations and reviewer readiness

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
- SIGNET: rotate away from the public staging solve; provision fresh per-team targets and program IDs,
  register and fund disposable team wallets, and verify every starter preflight against its manifest.
- DRIFT: complete the measured human, AI-assisted, and autonomous playtest matrix and decide timed
  release points for the organizer-only hint ladder. Its hosted exact-SBF service is already portal-wired.
- IMPRINT: pre-enroll the final physical-key roster, choose final target capacity, disable the organizer
  enrollment route before the event, and run the clean-room human solve. These are event operations;
  the challenge itself is complete.
- All challenges: run the required human-driven, AI-assisted-human, and autonomous-agent playtest matrix.
