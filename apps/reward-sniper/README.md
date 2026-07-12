# Reward Sniper

Reward Sniper is the hosted, off-chain reference implementation of the CTF26 dynamic DeFi challenge.
Teams inspect a shared DLMM-style bin market, lock an action during a commit phase, reveal it in the
next phase, and compete on relative reward extraction across rotating rounds.

The service is server-authoritative. Player-delivered files contain the interface, a limited client
SDK, and mechanics documentation; they do not contain the market engine, voucher authority, exact
optimizer, or persistence state.

## Implemented mechanics

- the intended JIT reward-accounting flaw: fresh liquidity enters before an old reward window settles;
- a shared market with nine liquidity bins, a moving active bin, changing reward regimes, and partial
  public activity observations;
- three scarce Sniper Tickets per team per round, funded liquidity limits, and automatic round
  rotation;
- ticket and market-swap orders behind a deterministic commit–reveal batch;
- network-arrival-independent batch ordering derived from the round seed, tick, and team identity;
- HMAC vouchers bound to team, tick, bin, and nonce, with one-shot verification;
- incomplete multi-signal telemetry, settled market tape, cumulative escrow scores, share-of-total
  ranking, and a multi-round rehearsal validation threshold;
- one-time, audience-bound participant tickets from the central event portal;
- signed 12-hour team sessions, bounded request bodies, rate limits, and production security headers;
- event-bound HttpOnly browser sessions plus explicit, short-lived searcher sessions;
- organizer-only action audit records retaining participant, team, session scope, event, tick, and phase;
- personalized agent-policy canaries, behavioral profiles, durable suspicion cases, and an
  organizer-only review API that never changes gameplay;
- an organizer-scheduled waiting room for synchronized event starts;
- atomic file snapshots for market, clock, sessions, ticket replay protection, and server-only
  authorities;
- a responsive, keyboard-usable player console and a limited automation SDK.

This service is intentionally single-writer. Run one application replica against one persistent state
file. Multiple replicas sharing no transactional store would fork the market and are unsupported.

## Local development

```bash
npm install
npm test
npm run play -- commit-reveal
npm run serve
```

Open <http://127.0.0.1:3010/> or <http://127.0.0.1:3010/web/>. With no participant-ticket secret,
the service enables local anonymous team creation. Production disables that path.

Useful local timing overrides:

```bash
COMMIT_MS=20000 REVEAL_MS=10000 ROUND_TICKS=12 npm run serve
```

## Production service

Use a persistent container or VM, not a stateless/serverless function. The phase clock and contested
market are long-lived shared state.

```bash
docker build -f apps/reward-sniper/Dockerfile -t ctf26-reward-sniper .
docker run --rm -p 3010:3010 \
  --env-file apps/reward-sniper/service.env \
  -v reward-sniper-data:/data \
  ctf26-reward-sniper
```

Copy `service.env.example` to a secret-managed deployment environment and replace every placeholder.
The portal's `CHALLENGE_TICKET_SECRET_REWARD_SNIPER` and this service's
`PARTICIPANT_TICKET_SECRET` must contain the same secret. Configure the portal's `REWARD_SNIPER_URL`
to this service's HTTPS `/web/` URL.

Health check: `GET /api/health`. A `503` response means persistence is degraded and organizers should
stop the round rather than continue with non-durable mutations.

### Railway settings

Reward Sniper is a shared monorepo service because it imports `packages/participant-ticket`. Keep the
Railway service Root Directory at the repository root and set:

```text
RAILWAY_DOCKERFILE_PATH=/apps/reward-sniper/Dockerfile
```

Leave Railway's Start Command override empty; the image starts `node src/server.mjs` from
`/app/apps/reward-sniper`. Attach one Railway Volume at `/data`, keep exactly one service replica, and
configure `/api/health` as the deployment healthcheck path. The image binds `0.0.0.0`, Railway injects
`PORT`, and state is stored at `/data/reward-sniper-state.json`.

Required service variables are `PARTICIPANT_TICKET_SECRET`, `SESSION_SECRET`, `VOUCHER_SECRET`,
`INTEGRITY_ADMIN_KEY`, and `MARKET_SEED`. The Docker image supplies `NODE_ENV`, `HOST`, and `STATE_FILE`; `COMMIT_MS`,
`REVEAL_MS`, and `ROUND_TICKS` are optional tuning variables. Set the portal `REWARD_SNIPER_URL` to
the generated HTTPS domain's `/web/` route.

For internal rehearsals, `START_ON_FIRST_SESSION=true` starts the clock when the first tester joins.
For the event, set it to `false` and set `EVENT_START_AT` to one ISO-8601 timestamp. Participants may
redeem tickets in the waiting room, but every state-changing endpoint returns `409` until kickoff.

The portal organizer console reads `GET /api/admin/integrity` and updates cases through
`PATCH /api/admin/integrity/:caseId` using `INTEGRITY_ADMIN_KEY`. Cases contain public contest metadata,
hashed network identifiers, reason codes, and participant action timelines. They are review signals,
not automatic sanctions. `INTEGRITY_ALERT_WEBHOOK_URL` optionally mirrors new-case alerts to Discord;
the persisted first-party case remains authoritative.

## Player boundary

Player-safe files:

- `web/index.html`, `web/style.css`, and `web/main.js`;
- `player-kit/README.md` and `player-kit/sdk.mjs`;
- the deterministic `reward-sniper-player.zip` built and served by the central portal.

The live market does not serve documentation or SDK downloads. The portal presents the briefing ZIP
and ticketed market launch as separate first-class starting actions. The stable launch URL in the
guide points to the portal's launch endpoint, which creates a fresh participant ticket at click time;
no expiring credential is embedded in the package.

Organizer-only files:

- `src/`, `test/`, and `bin/`;
- the state file and all environment secrets;
- exact simulation and optimizer helpers.

## Remaining architecture distinction

This is a production-capable **hosted market service**, but it is not the private-validator Anchor
implementation described in the long-form challenge spec. Moving settlement and escrow balances to a
Solana program remains necessary if the final event requires the score itself to be an on-chain state
transition. Do not describe this off-chain build as a deployed Meteora pool or a mainnet system.
