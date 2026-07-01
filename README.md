# Settlement Room 73

A Vercel-ready Solana devnet CTF challenge.

## Real Solve

Players must inspect the devnet memo evidence, identify the binding `CLERK_SEAL v1`
memo signed by the organizer wallet, and submit:

- their wallet pubkey
- the authoritative devnet transaction signature
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
NanMqYJh59vsPmxmHAMjWnToD7EsUHSMstikiz6xbchgBapeypzWLyhDCJTbneeayLpWn2Ukzsf8rb3sg5CXBXu
6658VtwPgvnSHdww5DQtijwZz99GsdBq8vWXjZvuGsQgXF9TR3gDyMtbzLtngSX9Mq35N3ZC1vsYh3w5DwhnpeAZ
WT6yZmwCpTqhobQqFK9QmB1rP9ukSWFeACM6Ve7z3fNzoqEqVYUSbxXX51kb2WyHqqC2HREJcCYwugfHy56mnXx
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
