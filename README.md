# CTF26

Design, research, and implementation code for the next **Superteam Solana security CTF** — an
on-site, learn-friendly event combining a dynamic flagship with focused Solana-native security
challenges. Jeopardy-style scoring is acceptable where the solve still requires meaningful human
interaction or judgment and resists unattended agent completion.

## Layout

```
ctf-26/
├── docs/                    # strategy, research, operations, challenge specs, feedback
├── packaging/               # canonical challenge delivery and player-file boundary
├── packages/                # shared ticket and integrity primitives
├── scripts/                 # repository verification and challenge test discovery
└── apps/
    ├── reward-sniper/        # DLMM-style market/KOTH simulator + checker
    ├── imprint/              # Anchor passkey vault challenge + web console
    ├── silent-patch/         # stale-deployment archaeology pack + checker
    ├── overclock/            # DRIFT native SBF RE challenge + exact replay service
    ├── last-stop/            # hosted SSH PDA journey + native replay checker
    ├── after-hours/          # Discord-native Solana checkout challenge
    ├── st-genesis-airdrop/   # hosted Solana-wallet signature challenge
    ├── portal/               # central registration portal (Next.js)
    ├── player-two/           # retained challenge prototype and reference implementation
    └── settlement-room-73/   # older memo-forensics prototype kept as reference
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

### Signet

```bash
cd apps/silent-patch
npm test
npm run play -- target
npm run play -- demo-exploit
```

### Drift

```bash
cd apps/overclock
npm test
npm run target -- team-local
npm run demo -- team-local       # organizer-only reference
npm run serve                    # authenticated event service on :3020
```

### Portal

```bash
cd apps/portal
npm install
cp .env.example .env.local
npm run dev                  # http://localhost:3001
```

### $ST Genesis Airdrop

```bash
cd apps/st-genesis-airdrop
npm install
cp .env.example .env
npm test
npm start                    # launch through http://localhost:3008/launch?teamId=local-player
```

Generate independent values for `CENTRAL_SESSION_SECRET`, `PARTICIPANT_ID_SECRET`, and each
`CHALLENGE_TICKET_SECRET_*`; every secret must contain at least 32 random bytes. Each deployed
challenge receives only its own ticket verifier key. `ALLOW_DEV_LOGIN=true` is available only outside
production.

The portal authenticates players and lists the current slate. Hosted launches receive a signed,
five-minute participant ticket bound to the selected challenge. Each challenge must atomically
consume its ticket JTI, establish an HTTP-only first-party session, and remove the ticket from the
URL; the shared contract is in [`packages/participant-ticket/`](packages/participant-ticket/). For
local use, the CLI/harness challenges are launched from their app directories; for production, set
`REWARD_SNIPER_URL`, `IMPRINT_URL`, `SILENT_PATCH_URL`, `OVERCLOCK_URL`, `LAST_STOP_URL`, and
`AFTER_HOURS_URL`, `PLAYER_TWO_URL`, and `ST_GENESIS_AIRDROP_URL` to hosted challenge surfaces.

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
`apps/imprint/web`. Reward Sniper, SIGNET, and DRIFT run as long-lived Railway services; the shared
Redis instance provides atomic replay/rate-limit state for SIGNET, DRIFT, and $ST Genesis Airdrop, while Reward Sniper uses
one persistent Railway volume and exactly one writer replica. See
[`docs/ops/staging.md`](docs/ops/staging.md) for live URLs, verified proofs, and the
manual gates that remain before an event release.

## Challenge design notes (Settlement Room 73)

Players inspect the devnet memo evidence, request a session, create their own session-bound memo
filing, and submit their wallet pubkey + their own devnet transaction signature + the settlement
phrase. The checker verifies the transaction against devnet and returns a server-generated HMAC flag.

Anti-cheat canaries collect **public contest telemetry only** — never keys, cookies, env vars, wallet
secrets, or local files. Canary/disclosure hits are logged for manual review; the live challenge does
not auto-ban on a canary firing. Full anti-agent surface and attribution model are documented in the
app code and in [`docs/research/ai-resistance.md`](docs/research/ai-resistance.md).

> Note: `docs/02` §18 concludes this memo-forensics prototype is a dead-end vs. agents. It's kept as a
> working reference; the event's real direction is the flagship in [`docs/strategy/event.md`](docs/strategy/event.md).
