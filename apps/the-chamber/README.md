# THE CHAMBER (organizer notes)

Challenge 11. An Anchor vault program with three locks per participant, plus the
hosted Node service that provisions accounts, watches the chain, and reports
solves to the portal. Participants never submit a flag: the program's own
`chamber_open` flag is the solve.

Player-facing framing lives on the hosted surface in `web/`. The full solution is
in [`INTERNAL_ANSWER_KEY.md`](INTERNAL_ANSWER_KEY.md) — organizer-only, never
shipped.

## Layout

```
apps/the-chamber/
├── programs/the-chamber/       # the vault program
├── programs/chamber-caller/    # organizer-only reference CPI caller (test fixture)
├── tests/                      # anchor suite, needs a local validator
├── src/                        # hosted service (server, chain adapter, store)
├── web/                        # participant surface
├── test/                       # service tests (node --test)
└── .keys/                      # gitignored operator + hidden keypairs
```

## Running

```bash
npm install
npm test                       # service suite, no chain or Redis required
npm run test:onchain           # anchor suite against a local validator
npm start                      # service on :3012
```

Locally the service accepts a development launch when `ALLOW_DEV_LAUNCH=true`;
in production only a signed portal ticket for the `the-chamber` audience opens a
session.

## The program is already deployed — do not redeploy

The vault is live on devnet at `Ekw4Zx3Nu9zTvCYsuzn1ubHNtgWjRAtm8PMUNavgmPXj`,
carried over from the `ctf-2026` prototype. `ADMIN_KEY` and `HIDDEN_KEY` are
compiled into that bytecode, so the source here is a **mirror of what is live**,
not a thing to rebuild and ship. Editing `declare_id!` or either constant without
a redeploy silently diverges from what participants actually hit.

The crate keeps its original name, `st_chamber_of_secrets`, because that is what
the deployed artifact and its published IDL carry. Only the event-facing name is
THE CHAMBER.

### Keys

Both keypairs are inherited from the prototype and live in gitignored `.keys/`:

| file | pubkey | role |
| --- | --- | --- |
| `the-chamber-operator.json` | `2pqmreJi…v7AGZ` | `ADMIN_KEY`, rent payer, program upgrade authority |
| `the-chamber-hidden.json` | `AnCccXSJ…tXaty` | `HIDDEN_KEY`; the value written to the venue cards |

Both are challenge-scoped rather than personal wallets, so `docs/strategy/anti-ai.md`
§9's substantive rule holds. The caveat it does not satisfy: these two are committed
in the **private** `KunalBagaria/ctf-2026` repository's history. That repo must stay
private for the duration of the event — publishing it would expose the lock-two
answer and the admin key at once. Rotating either would require a redeploy.

### `chamber_open` is derived, never read

The deployed program sets `chamber_open` false at creation and **never writes it
again**. The service therefore derives the open chamber from the three locks. This
is not a style choice: of the four fully-unlocked accounts already on devnet, zero
have the stored byte set, so reading it would score none of them. Do not "fix"
`decodeLocks` to trust offset 44 without deploying a program that writes it.

## Deployment

Railway, one replica (the service serializes chain writes with a per-participant
lease and a single write slot). Required configuration is in `.env.example`. Before
release:

1. Point `THE_CHAMBER_ADMIN_KEYPAIR` at the inherited operator key and
   `SOLANA_RPC_URL` at a provider that accepts server traffic.
2. Keep the operator funded for one account per participant; `/health` reports
   `funding.requiredBalance` and fails closed when short. It held 10.01 SOL against
   a 0.12 SOL requirement for a 50-person field at last check.
3. Program the venue cards with the hidden key and count them against the roster.

`web/the-chamber-idl.json` is the IDL of the deployed program and is committed, so
`/api/idl` works without a build. `npm run build:idl` only needs to run if the
program is ever rebuilt.

## Contracts

- `POST /api/session` — consumes a portal ticket, sets `the_chamber_session`.
- `POST /api/register` — binds one wallet to one participant and admin-signs
  `create_user`. Both directions are exclusive for the event generation.
- `GET /api/state` — reads the locks from the chain and scores an open chamber.
- `GET /api/completion` — bearer-authenticated portal recovery; reconciles the
  chain so a solve is recorded even if the participant never reopens the page.
- `GET /api/idl` — the program interface, session-gated.
- `/health`, `/robots.txt`, `/agents.txt`, `/llms.txt`, `/.well-known/agents.txt` — public.
