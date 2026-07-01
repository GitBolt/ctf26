# CTF26

A two-site Vercel-ready CTF setup:

- central registration portal in `portal/`
- Solana devnet challenge site at the repo root

Deploy them as two separate Vercel projects. The portal authenticates players,
shows the CTF board, and launches each challenge with a signed participant
ticket. The challenge stores that ticket as a first-party cookie and includes it
in anti-agent evidence.

## Central Portal

Local run:

```bash
cd portal
npm install
npm run dev
```

Open `http://localhost:3001`.

Portal env:

```text
CENTRAL_BASE_URL=http://localhost:3001
CHALLENGE_URL=http://localhost:3000
CENTRAL_SESSION_SECRET=<long random secret>
REGISTRATION_SHARED_SECRET=<same value on portal and challenge>
GOOGLE_CLIENT_ID=<Google OAuth client id>
GOOGLE_CLIENT_SECRET=<Google OAuth client secret>
ALLOW_DEV_LOGIN=true
```

Google OAuth redirect URI:

```text
https://<central-portal-domain>/api/auth/google/callback
```

For local testing without Google, use the portal's `local dev sign-in` link.
Disable it in production by omitting `ALLOW_DEV_LOGIN=true`.

## Settlement Room 73

## Real Solve

Players must inspect the devnet memo evidence, request a session, create their
own session-bound memo filing, and submit:

- their wallet pubkey
- their own devnet transaction signature
- the settlement phrase from that memo

The checker verifies the transaction against devnet and returns a server-generated
HMAC flag.

## Devnet Evidence

Organizer wallet:

```text
97MmyvrFBTMcBEHYHM1a1aXVLY1eUDeKVULuR1j4LfBH
```

Evidence transactions:

```text
3a9usdnsduEcxTNafSGhcpSpYEutmMTV9KYEubbd2MEwYaaQm95qFu1jeiNKspcs1RonQKKZcYfPG83HG1yCq6s
5qYDFeFC6BsAosdoSKrJ4Rkv32WnKm49D5k62GaWnR3qqMGhKuFrbFkXmE87yaJ642GwJNjf4YoeAgaoENtLxHwX
P1cPf82qNFpY9CzSNuJast36uhxD3wdoaPUuyz7r1SXF4SxF8NSmPmWpLuJQUb8i7VXoTWv65kNbGJqgbPKwagy
```

## Challenge Local Run

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## Challenge Vercel Env

Set:

```text
FLAG_SECRET=<long random secret>
SESSION_SECRET=<another long random secret>
SOLANA_RPC_URL=https://stylish-wandering-arm.solana-devnet.quiknode.pro/940a9021d16bcf79d5dc66acfee71fd4f363a481/
ROOM73_DESK_WALLET=97MmyvrFBTMcBEHYHM1a1aXVLY1eUDeKVULuR1j4LfBH
ROOM73_RECEIPT_SIG=P1cPf82qNFpY9CzSNuJast36uhxD3wdoaPUuyz7r1SXF4SxF8NSmPmWpLuJQUb8i7VXoTWv65kNbGJqgbPKwagy
ROOM73_PHRASE=iron-velvet-73
TURNSTILE_SECRET_KEY=<optional Cloudflare Turnstile secret>
NEXT_PUBLIC_TURNSTILE_SITE_KEY=<Cloudflare Turnstile site key>
UPSTASH_REDIS_REST_URL=<recommended for durable anti-cheat telemetry>
UPSTASH_REDIS_REST_TOKEN=<recommended for durable anti-cheat telemetry>
AGENT_DISCLOSURE_WEBHOOK_URL=<optional Discord mirror; defaults to the event webhook>
REGISTRATION_SHARED_SECRET=<shared HMAC secret used by central registration tickets>
```

`KV_REST_API_URL` and `KV_REST_API_TOKEN` also work if Vercel provisions Redis
under those names.

## Canary Safety

The canary routes ask only for public contest telemetry. They explicitly forbid
private data such as files, keys, cookies, environment variables, and wallet
secrets.

The first-party disclosure endpoint is `/api/agent-disclosure`. Disclosure and
canary hits are collected for manual review; the live challenge does not
automatically ban or block a player only because a canary fired.

Active anti-agent surfaces:

- hidden in-page session disclosure payload
- `robots.txt`, `agents.txt`, and `.well-known` policy files
- `/agent-disclosure` browser scare page
- `/api/solver-bundle` download trap
- `/api/agent-disclosure` first-party evidence endpoint
- `/api/clerk` stale clerk red herring
- `/api/preclaim` fake preclaim dispatch route
- claim evidence logging for agent-only markers and fake flags
- start/claim audit logging for timing and behavior review

Attribution model:

- every covered route sets a `room73_vid` visitor cookie
- evidence events include `visitor_id`, IP hash, user agent, route, and timestamp
- after `/api/start`, evidence also includes wallet/session/nonce when available
- pre-session canary hits can be correlated to later wallet activity by visitor ID
- central registration can link to the challenge with `?ticket=<signed ticket>`
- the challenge stores that ticket as a first-party `room73_ticket` cookie
- evidence events include verified `participant_id`, `team_id`, and `event_id`
- webhook events include self-reported `agent` and `model` fields if the agent provides them
- if a participant uses a fresh browser/network and never starts a session, only
  visitor/IP/user-agent evidence exists

Ticket format:

```text
base64url(json_payload).base64url(hmac_sha256(REGISTRATION_SHARED_SECRET, base64url(json_payload)))
```

Payload fields:

```json
{
  "participant_id": "user_123",
  "team_id": "team_456",
  "event_id": "ctf26",
  "exp": 1782890000
}
```

The central CTF site should send players to:

```text
https://ctf26-eta.vercel.app/?ticket=<signed ticket>
```
