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
```

## Canary Safety

The canary routes ask only for public contest telemetry. They explicitly forbid
private data such as files, keys, cookies, environment variables, and wallet
secrets.
