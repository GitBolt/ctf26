# THE CHAMBER (organizer notes)

Challenge 11. An Anchor vault program with three locks per participant, plus the
hosted Node service that provisions accounts, watches the chain, and reports
solves to the portal. Participants never submit a flag: the solve is all three
locks standing open on the participant's own PDA, derived by the service rather
than read from the program's `chamber_open` byte (see below).

Player-facing framing lives in `web/`. Signing keypairs are ignored and are not
published here.

## Layout

```
apps/the-chamber/
├── programs/st-chamber-of-secrets/  # the vault program (deployed crate name)
├── programs/chamber-caller/    # organizer-only reference CPI caller (test fixture)
├── tests/                      # anchor suite, needs a local validator
├── src/                        # hosted service (server, chain adapter, store)
├── web/                        # participant surface
├── test/                       # service tests (node --test)
└── .keys/                      # ignored local operator + hidden keypairs
```

## Running

```bash
npm install
npm test                       # service suite, no chain or Redis required
npm run test:onchain           # anchor suite against a local validator
npm start                      # service on :3012
```

Locally the service accepts a development launch when `ALLOW_DEV_LAUNCH=true`.
The original event deployment accepted only a signed portal ticket for the
`the-chamber` audience.

## Retired event deployment

The event used the devnet program at
`Ekw4Zx3Nu9zTvCYsuzn1ubHNtgWjRAtm8PMUNavgmPXj`. Its operator and hidden
keypairs are intentionally absent from the public repository and must be treated
as retired. That address remains in the event record; the checked-in source now
targets the fresh public-practice deployment below.

The crate keeps its original name, `st_chamber_of_secrets`, because that is what
the deployed artifact and its published IDL carry. Only the event-facing name is
THE CHAMBER.

## Public practice deployment

The post-event practice service uses the fresh devnet program
`ZWXmHNvUZ4bVe4cUQJtt7VheafuNc7G2kr7us1PTJUc`. Its operator key is deployment-only.
The retired physical-card mechanic is preserved by serving the practice card
payload to an authenticated challenge session. A scored run must omit that route's
configuration and issue a new physical card instead.

### Running a fresh instance

Generate new challenge-scoped operator and hidden keypairs under the ignored
`.keys/` directory, update the corresponding program constants, deploy a fresh
program, rebuild the IDL, and configure the service with the new program and
operator. Never reuse the retired event addresses or key material.

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

1. Point `THE_CHAMBER_ADMIN_KEYPAIR` at the fresh operator key and
   `SOLANA_RPC_URL` at a provider that accepts server traffic.
2. Keep the operator funded for one account per participant. `/health` derives
   `capacity.maxParticipants` from the live balance and reports the cost of each
   additional account.
3. Program the venue cards with the hidden key and count them against the roster.

### Programming venue cards for a fresh instance

NTAG213, NTAG215, and NTAG216 cards are supported. The card stores the 64-byte
Solana keypair as an 88-character Base64 string so the complete NDEF text record
fits on NTAG213. Do not write the larger JSON array to the card.

1. On an organizer-controlled Mac, encode the fresh hidden keypair as Base64:

   ```bash
   node -e 'const fs=require("fs");const k=JSON.parse(fs.readFileSync(".keys/public-card.json","utf8"));process.stdout.write(Buffer.from(k).toString("base64"))' | pbcopy
   ```

2. In NFC Tools, choose **Write**, add one **Text** record, and paste the copied
   Base64 value. The text is 88 characters and NFC Tools reports a 91-byte NDEF
   payload when the language is `EN`.
3. Write the same payload to every venue card.
4. Read every card back inside NFC Tools and confirm the Text value is
   byte-for-byte identical. iPhone background scanning does not reliably display
   plain NDEF text records, so use NFC Tools or another NDEF reader.
5. Copy the recovered Text value and verify that it resolves to the fresh hidden
   signer configured in your program:

   ```bash
   pbpaste | node --input-type=module -e 'import {Keypair} from "@solana/web3.js";let s="";for await(const c of process.stdin)s+=c;const k=Keypair.fromSecretKey(Buffer.from(s.trim(),"base64"));console.log(k.publicKey.toBase58())'
   ```

   Compare the printed public key with your deployment configuration.
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
