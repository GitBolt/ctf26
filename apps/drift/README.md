# DRIFT — operator runbook

DRIFT is a bytecode-only Solana SBF reverse-engineering challenge. Players receive a stripped native
program and a generic submission client. The authoritative checker loads the exact published ELF into
LiteSVM, seeds a deterministic per-team target, replays a bounded raw instruction/sysvar trace,
and awards a flag only when the attacker realizes net profit by draining the original reserve.

## Final architecture

- `native/program/` — native non-Anchor vulnerable program;
- `player-kit/dist/drift_vault.so` — the only program artifact published to players;
- `native/harness/` — exact-byte LiteSVM replay, target seeding, invariant checker, and HMAC flag path;
- `src/service.mjs` — authenticated per-team target/replay/submit service;
- `player-kit/client.mjs` — generic portal-ticket client;
- `src/runtime.mjs` — non-authoritative accounting oracle for fast tests;
- `HINTS.md` — organizer-only progressive hint ladder.

The service never accepts a client-selected team ID, reported balance, arbitrary account write,
replacement program, or arbitrary SVM mutation. Public traces support only raw invocation of the
published program and canonical replacement of an allowlisted sysvar. The portal ticket determines the team. Each replay
starts from a fresh canonical instance and loads the exact ELF whose SHA-256 is returned to players.

## Win invariant

Deposits are real System Program lamport transfers. Transaction fees are paid independently, so the
checker can require all three quantities to agree:

```text
net withdrawals == attacker spendable-balance profit == drain of original reserve
```

All three must meet the per-team threshold. Cycling deposits and withdrawals cannot solve.

## Build and test

Requirements:

- Solana/Agave `cargo build-sbf` 2.3.x;
- Rust stable 1.86 or newer;
- Node.js 20 or newer.

```bash
npm install
npm run build
npm test
```

`npm run build` creates the stripped ELF, release checker, and verified player manifest. `npm test`
rebuilds the ELF, checks for artifact leaks, tests the JavaScript model and authenticated service, then
executes the native integration suite against the exact SBF bytes.

## Local organizer commands

```bash
npm run target -- team-local
npm run demo -- team-local
npm run replay < submission.json
FLAG_SECRET='at-least-32-random-bytes' npm run check < submission.json
```

`demo` contains the organizer reference route and must never enter the player attachment.

## Service configuration

Copy values from `service.env.example` into the service secret store. The portal variable
`CHALLENGE_TICKET_SECRET_DRIFT` must equal this service's `CHALLENGE_TICKET_SECRET`; the ticket
audience remains `drift` for compatibility while the public challenge name is DRIFT.

Start locally:

```bash
set -a
. ./service.env.local
set +a
npm run serve
```

Endpoints:

- `GET /health` — unauthenticated liveness only;
- `POST /api/session` — exchange a short-lived portal ticket for an HttpOnly team session;
- `GET /api/target` — deterministic team target metadata;
- `GET /artifact/drift_vault.so` — exact player ELF;
- `GET /artifact/player-guide.md` — the public replay protocol included in the player kit;
- `POST /api/replay` — bounded unscored exact replay, rate-limited;
- `POST /api/submit` — exact replay plus server-side HMAC flag, more tightly rate-limited.

Terminate TLS at the deployment proxy. Do not expose the checker binary, native source, JavaScript
oracle, reference trace, flag secret, or service environment.

Configure `REDIS_URL` for production. Launch-ticket consumption, session state, replay concurrency,
and rate buckets then use shared atomic Redis state and remain correct across restarts or multiple
replicas. The service deliberately refuses to start in production without Redis. In-memory state is
limited to local development and tests.

## Mandatory launch checks

1. `npm run build && npm test` passes on the deployment toolchain.
2. The player-kit manifest SHA equals `/api/target.programSha256`.
3. `strings player-kit/dist/drift_vault.so` contains none of the forbidden challenge vocabulary,
   including named time/Clock syscall imports.
4. An unauthenticated request cannot download the artifact or invoke replay.
5. A ticket for another challenge or team cannot select a DRIFT target.
6. A deposit/withdraw round trip and recycled gross volume do not solve.
7. Semantic instruction helpers, arbitrary fields, account mutation operations, non-canonical
   encodings, oversized bodies, and excessive traces are rejected.
8. The organizer reference trace solves through the service and produces a `CTF26{drift_...}` flag.
9. Human, AI-assisted-human, and autonomous-agent playtests are recorded before the public event.

## Deployment boundary

The codebase now contains the real SBF artifact pipeline, exact replay checker, authenticated team
service, rate/concurrency limits, and player-only packaging boundary. Event hosting still requires an
ordinary Linux process/container with persistent logs and TLS, plus the later repository-wide portal
URL wiring. Those are deployment operations rather than missing challenge mechanics.
