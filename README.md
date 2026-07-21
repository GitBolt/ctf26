# CTF26

Design, research, and implementation code for the next **Superteam Solana security CTF** — an
on-site, learn-friendly event combining a dynamic flagship with focused Solana-native security
challenges. Jeopardy-style scoring is acceptable where the solve still requires meaningful human
interaction or judgment and resists unattended agent completion, but the active ten-challenge slate
uses one field-relative scoring contract with no author-assigned difficulty.

## Layout

```
ctf-26/
├── docs/                    # strategy, research, operations, challenge specs, feedback
├── packaging/               # canonical challenge delivery and player-file boundary
├── packages/                # shared ticket, integrity, scoring, and solve-event primitives
├── prototypes/              # retired experiments, never part of the active event slate
├── scripts/                 # repository verification and challenge test discovery
└── apps/
    ├── reward-sniper/        # DLMM-style market/KOTH simulator + checker
    ├── imprint/              # Anchor passkey authorization challenge + web console
    ├── signet/               # SIGNET source-archaeology pack + checker
    ├── drift/                # DRIFT native SBF RE challenge + exact replay service
    ├── last-stop/            # hosted SSH PDA journey + native replay checker
    ├── after-hours/          # Discord-native Solana checkout challenge
    ├── player-two/           # credential-lifecycle arcade challenge
    ├── the-broadcast/        # hosted Solana-wallet signature challenge
    ├── evidence-room/        # live account-lifecycle factory challenge
    ├── second-key/           # Token-2022 collateral custody challenge
    └── portal/               # central registration portal (Next.js)

prototypes/
└── settlement-room-73/       # retired memo-forensics experiment, not an active app
```

## Where to start

- **Design & direction:** [`docs/`](docs/) — read [`docs/README.md`](docs/README.md) first.
  Current flagship design: [`docs/strategy/event.md`](docs/strategy/event.md).
- **Consolidated working memory:** [`docs/strategy/knowledge.md`](docs/strategy/knowledge.md).
- **Current internal staging status:** [`docs/ops/staging.md`](docs/ops/staging.md).
- **Clean-room human/AI launch gate:** [`docs/ops/playtest.md`](docs/ops/playtest.md).
- **Sponsorship status & message archive:** [`docs/ops/sponsors.md`](docs/ops/sponsors.md).

## Running the apps

Each app is self-contained. Copy the example env, install, and run.

### Reward Sniper

```bash
cd apps/reward-sniper
npm test
npm run play
npm run serve                # http://localhost:3010/web/
```

### IMPRINT

```bash
cd apps/imprint
yarn test
npm --prefix web run build
npm run web:dev              # http://localhost:3002
```

### SIGNET

```bash
cd apps/signet
npm test
npm run play -- target
npm run play -- demo-exploit
```

### DRIFT

```bash
cd apps/drift
npm test
npm run target -- participant-local
npm run demo -- participant-local       # organizer-only reference
npm run serve                    # authenticated event service on :3020
```

### Portal

```bash
cd apps/portal
npm install
cp .env.example .env.local
npm run dev                  # http://localhost:3001
# public standings:          # http://localhost:3001/leaderboard
```

### THE BROADCAST

```bash
cd apps/the-broadcast
npm install
cp .env.example .env
npm test
npm start                    # launch through the portal or a signed local participant ticket
```

Generate independent values for `CENTRAL_SESSION_SECRET`, `PARTICIPANT_ID_SECRET`, and each
`CHALLENGE_TICKET_SECRET_*`; every secret must contain at least 32 random bytes. Each deployed
challenge receives only its own ticket verifier key. `ALLOW_DEV_LOGIN=true` is available only outside
production.

The portal authenticates participants and lists the current slate. Hosted launches receive a signed,
five-minute participant ticket bound to the selected challenge. Each challenge must atomically
consume its ticket JTI, establish an HTTP-only first-party session, and remove the ticket from the
URL; the shared contract is in [`packages/participant-ticket/`](packages/participant-ticket/).
Verified binary solves are sent to the portal with the signed, idempotent contract in
[`packages/leaderboard/`](packages/leaderboard/); Reward Sniper remains sourced from its continuous
market scoreboard. The portal's Redis-backed public leaderboard applies the formulas documented in
[`docs/strategy/event.md`](docs/strategy/event.md#3-dynamic--relative-scoring-decision).

For local use, the CLI and harness challenges are launched from their app directories. For production,
set `REWARD_SNIPER_URL`, `IMPRINT_URL`, `SIGNET_URL`, `DRIFT_URL`, `LAST_STOP_URL`,
`AFTER_HOURS_URL`, `PLAYER_TWO_URL`, `THE_BROADCAST_URL`, `EVIDENCE_ROOM_URL`, and
`SECOND_KEY_URL` to the ten hosted challenge surfaces.

Run all fast unit/integration checks, or the slower on-chain suites, from the repository root:

```bash
npm test
npm run test:onchain
npm run verify:portal
```

[`packaging/challenges.json`](packaging/challenges.json) is the player/organizer boundary and the
canonical challenge application list. Only its allowlisted player paths belong in hosted public assets
or attachment archives; `npm run check:packaging` rejects catalog drift and common
secret/answer/solver files. `npm run test:challenges` reads the same manifest, so a new challenge is
added to the repository test sweep by declaring its `appPath` there.

## Deploy note

The portal and IMPRINT web console deploy as separate Vercel projects rooted at `apps/portal` and
`apps/imprint/web`. The other nine hosted challenge services run on Railway. Redis provides durable
ticket, session, completion, rate-limit, and challenge state where required. Reward Sniper uses one
persistent Railway volume and exactly one writer replica. Services whose state transitions are not yet
safe across replicas must also remain at one replica, as listed in the operations runbook. See
[`docs/ops/staging.md`](docs/ops/staging.md) for live URLs, verified proofs, and the
manual gates that remain before an event release.

## Retired prototypes

`prototypes/settlement-room-73` preserves an earlier memo-forensics experiment for historical reference.
It is not an active challenge, production service, or player artifact. The canonical active catalogue is
[`packaging/challenges.json`](packaging/challenges.json), with current challenge documentation under
[`docs/challenges/`](docs/challenges/).
