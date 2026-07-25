# THE CHAMBER (organizer notes)

Challenge 11. An Anchor vault program with three locks per participant, plus the
hosted Node service that provisions accounts, watches the chain, and reports
solves to the portal. Participants never submit a flag: the solve is all three
locks standing open on the participant's own PDA, derived by the service rather
than read from the program's `chamber_open` byte (see below).

Player-facing framing lives on the hosted surface in `web/`. The full solution is
in [`INTERNAL_ANSWER_KEY.md`](INTERNAL_ANSWER_KEY.md) — organizer-only, never
shipped.

## Layout

```
apps/the-chamber/
├── programs/st-chamber-of-secrets/  # the vault program (deployed crate name)
├── programs/chamber-caller/    # organizer-only reference CPI caller (test fixture)
├── tests/                      # anchor suite, needs a local validator
├── src/                        # hosted service (server, chain adapter, store)
├── web/                        # participant surface
├── test/                       # service tests (node --test)
└── .keys/                      # tracked operator + hidden keypairs (organizer-only)
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

Both keypairs are inherited from the prototype and are **committed to this repo**
under `.keys/`, because they are compiled into the already-deployed program and
cannot be rotated without a redeploy:

| file | pubkey | role |
| --- | --- | --- |
| `the-chamber-operator.json` | `2pqmreJi…v7AGZ` | `ADMIN_KEY` and rent payer |
| `the-chamber-hidden.json` | `AnCccXSJ…tXaty` | `HIDDEN_KEY`; the value written to the venue cards |

The live program's upgrade authority is the separate address
`GpEetfasA7J3kbERkBAqqas8vTTfTTkyUdSrS4DKQrq2`. The operator key cannot upgrade
the program. Confirm custody of that authority before planning an in-place key
rotation. Without it, rotation requires a new deployment and program ID.

Both are challenge-scoped rather than personal wallets, so the substantive rule in
`docs/strategy/anti-ai.md` §9 holds — but tracking them departs from that section's
"gitignored" requirement, deliberately and with the consequences below.

**This repository is now itself a control on the challenge.** Anyone who can read it
can turn lock two without the physical card, which is the venue-local gate the
challenge's anti-agent property rests on. Keep `GitBolt/ctf26` private for the
duration of the event, keep write access to the people running it, and treat repo
access as equivalent to handing out a card. The same is true of
`KunalBagaria/ctf-2026`, which holds the same two keys plus the full writeup.

Only `.keys/the-chamber-operator.json` and `.keys/the-chamber-hidden.json` are
tracked; anything else placed in `.keys/` stays ignored. Neither file may be served
to participants — `.keys` is listed organizer-only in `packaging/challenges.json`.

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
2. Keep the operator funded for one account per participant. `/health` derives
   `capacity.maxParticipants` from the live balance and reports the cost of each
   additional account.
3. Program the venue cards with the hidden key and count them against the roster.

### Programming the venue cards

NTAG213, NTAG215, and NTAG216 cards are supported. The card stores the 64-byte
Solana keypair as an 88-character Base64 string so the complete NDEF text record
fits on NTAG213. Do not write the larger JSON array to the card.

1. On an organizer-controlled Mac, run this from `apps/the-chamber` to copy the
   compact payload:

   ```bash
   node -e 'const fs=require("fs");const k=JSON.parse(fs.readFileSync(".keys/the-chamber-hidden.json","utf8"));process.stdout.write(Buffer.from(k).toString("base64"))' | pbcopy
   ```

2. In NFC Tools, choose **Write**, add one **Text** record, and paste the copied
   Base64 value. The text is 88 characters and NFC Tools reports a 91-byte NDEF
   payload when the language is `EN`.
3. Write the same payload to every venue card.
4. Read every card back inside NFC Tools and confirm the Text value is
   byte-for-byte identical. iPhone background scanning does not reliably display
   plain NDEF text records, so use NFC Tools or another NDEF reader.
5. Copy the recovered Text value and verify the signer:

   ```bash
   pbpaste | node --input-type=module -e 'import {Keypair} from "@solana/web3.js";let s="";for await(const c of process.stdin)s+=c;const k=Keypair.fromSecretKey(Buffer.from(s.trim(),"base64"));console.log(k.publicKey.toBase58())'
   ```

   It must print `AnCccXSJrEbge2W5cttNJ6JEf21dusiXfNMqMAZtXaty`.
6. After the full batch passes, make the tags read-only if the purchased tags and
   writer support an irreversible lock. Keep two verified unlocked spares with
   organizers until the event ends.

Do not write a URL record, upload the payload, or use a cloud-backed NFC workflow.
The card should contain only the local NDEF text record.

Participants recover the signer with:

```ts
const hidden = Keypair.fromSecretKey(
  Buffer.from(textFromCard.trim(), "base64"),
);
```

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
