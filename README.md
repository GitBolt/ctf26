# CTF26

The public archive of the **Superteam Solana security CTF**: eleven distinct challenges covering
program-derived addresses, passkeys, deployment drift, Token-2022 custody, wallet signatures,
account lifecycle, cross-program invocation, and adversarial market systems.

The in-person event is complete. Its production Google gate, signed launch tickets, Redis-backed
leaderboard, integrity telemetry, and hosted challenge services have been retired. The public portal
is an ungated catalogue; the repository preserves each implementation for local study and fresh
deployments.

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
    ├── the-chamber/          # three-lock Anchor vault + CPI authority challenge
    └── portal/               # public challenge archive (Next.js)

prototypes/
└── settlement-room-73/       # retired memo-forensics experiment, not an active app
```

## Where to start

- **Design & direction:** [`docs/`](docs/) — read [`docs/README.md`](docs/README.md) first.
  Current flagship design: [`docs/strategy/event.md`](docs/strategy/event.md).
- **Consolidated working memory:** [`docs/strategy/knowledge.md`](docs/strategy/knowledge.md).
- **Retired deployment record:** [`docs/ops/staging.md`](docs/ops/staging.md).
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
npm run dev                  # http://localhost:3001
```

### THE CHAMBER

```bash
cd apps/the-chamber
npm install
cp .env.example .env
npm test                     # service suite
npm run test:onchain         # anchor suite, needs a local validator
npm start                    # http://localhost:3012
```

### THE BROADCAST

```bash
cd apps/the-broadcast
npm install
cp .env.example .env
npm test
npm start                    # launch through the portal or a signed local participant ticket
```

During the live event, the portal authenticated approved participants and issued signed,
five-minute, challenge-bound tickets. Challenge services consumed each ticket once and reported
authoritative solves to the Redis-backed leaderboard. Those packages remain in `packages/` as a
record of the event architecture, but the public portal does not import or run them.

For local use, launch each CLI, harness, or web challenge from its own app directory. Hosted and
on-chain challenges require fresh local secrets, challenge-scoped wallets, and deployments; retired
event credentials are intentionally not included.

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

## Public deployment

Only `apps/portal` is deployed. It is static with respect to event state and needs no Google OAuth,
Redis, challenge ticket secrets, Railway services, or participant data. The historical service code
is available for local study and can be deployed independently with fresh configuration.

## Retired prototypes

`prototypes/settlement-room-73` preserves an earlier memo-forensics experiment for historical reference.
It is not an active challenge, production service, or player artifact. The canonical active catalogue is
[`packaging/challenges.json`](packaging/challenges.json), with current challenge documentation under
[`docs/challenges/`](docs/challenges/).
