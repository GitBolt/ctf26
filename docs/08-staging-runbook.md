# Internal staging runbook

Last verified: 2026-07-11 (Asia/Kolkata)

This document records the currently deployed **internal test environment**. It is not the final event
release manifest. Never copy secret values, ignored keypairs, or `.keys/` contents into this file.

## Live surfaces

| Surface | URL | Verified state |
| --- | --- | --- |
| Central portal | `https://ctf26-eta.vercel.app` | Production build live; all four signed launch exchanges passed |
| Reward Sniper | `https://reward-sniper-production.up.railway.app/web/` | Persistent live market; portal session and restart recovery passed |
| IMPRINT | `https://imprint-sage.vercel.app` | **Challenge complete**; hardened devnet program and updated five-stage console live |
| SIGNET | `https://signet-production-4018.up.railway.app/` | Live archive/target/checker; solved proof plus a fresh internal target |
| DRIFT | `https://drift-production-c697.up.railway.app/` | Exact native SBF replay service; Redis replay protection live |

The portal route slug and cryptographic ticket audience are intentionally separate. In particular,
`/api/launch/silent-patch` issues an `aud=signet` ticket. A regression test covers all four mappings.

## Proof already completed

### Reward Sniper

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
