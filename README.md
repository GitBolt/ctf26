# Settlement Room 73

A Vercel-ready Solana devnet CTF challenge.

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

## Local Run

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## Vercel Env

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
