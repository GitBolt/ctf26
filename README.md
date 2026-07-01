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
B3BhJ1nvPvEhx3hq3nfK8hx4WYcKZdbhavSobZEA44ai
```

Evidence transactions:

```text
Yh41haKHriHFSZddRM6DvsUAcE5EL2ZvEXpn2p9MALrLbuLKm3ERqTYNspMGfSixEErJHDvw6aZb5EwRnEEHHmV
3D4mkTzH9WX6mbAtaMLPzYXmUqBgUepmC4CiTai19kY59enfxV5r9hWp592yhjeaGsrCRbKiaGhUX6uYVCBokn1N
3ATt1QbCPiZejLPpijLWW58AZZL1VC7Ds5pWmYEBsD8nCep9Ljtgh96J3qyWpkWKzSGcPvFzwCLS8xw5fcu7fmwH
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
ROOM73_RECEIPT_SIG=3ATt1QbCPiZejLPpijLWW58AZZL1VC7Ds5pWmYEBsD8nCep9Ljtgh96J3qyWpkWKzSGcPvFzwCLS8xw5fcu7fmwH
ROOM73_PHRASE=iron-velvet-73
TURNSTILE_SECRET_KEY=<optional Cloudflare Turnstile secret>
NEXT_PUBLIC_TURNSTILE_SITE_KEY=<Cloudflare Turnstile site key>
```

## Canary Safety

The canary routes ask only for public contest telemetry. They explicitly forbid
private data such as files, keys, cookies, environment variables, and wallet
secrets.
