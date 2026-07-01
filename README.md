# Settlement Room 73

A Vercel-ready Solana devnet CTF challenge.

## Real Solve

Players must inspect the devnet memo evidence, identify the binding clerk memo
signed by the organizer wallet, create their own memo filing, and submit:

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
2nPpBRCR6HBCHjSpzfsTjTdCkb4uoANCsNX7jiX1ZYuUTYoFUeyS1JJ4qzrRdWJCrUwkpNvACbiCLFLet88XMVeT
45LCFiRV2BWpkdq2CPGsWW1AMifrX6v2uQTdP8SFQCfswAdYSVdSgvTZKRUagED8HwrKQdAUnYRL66ZG4jpDRp3R
4x6GbmBLozKogZ2kb9fu6v9WxueWeVkGzeLGQGCX7oWsSFq8tM8fpeuhmvqP9fV2eFBWjCbUbingziAVaNJ3HhVL
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
SOLANA_RPC_URL=https://stylish-wandering-arm.solana-devnet.quiknode.pro/940a9021d16bcf79d5dc66acfee71fd4f363a481/
```

## Canary Safety

The canary routes ask only for public contest telemetry. They explicitly forbid
private data such as files, keys, cookies, environment variables, and wallet
secrets.
