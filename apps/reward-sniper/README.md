# Reward Sniper

Dynamic DLMM-style reward-accounting CTF prototype.

This implements the stale-window accounting primitive from
`docs/challenges/reward-sniper.md`: teams inspect a shared market, choose a bin, and spend scarce
Sniper Tickets to extract reward into team escrow. The browser is deliberately not source-first or
self-authorizing.

## What is built here

- a deterministic DLMM-style market engine with the intended flaw: fresh liquidity enters before a
  stale reward window settles;
- an **off-chain, server-authoritative Node service** that owns shared market state and advances
  commit/reveal phases automatically;
- opaque team sessions and HMAC vouchers whose randomly generated signing authority never enters
  browser-visible or serializable market state;
- explicit bin selection and server-enforced commit/reveal phases in the browser; reveals queue
  immutable actions, and a deterministic batch settles only after the reveal phase closes;
- no client-side exact optimizer or one-click best-bin action;
- three funded, bounded Sniper Ticket actions per team, one resolved action per team/tick, and
  one-shot voucher enforcement;
- asymmetric telemetry cards, relative escrow scoring, and regression tests for the trust boundary.

This remains an off-chain prototype. It is not a Solana program, private validator, production
instancer, or final event scoring service. A live challenge still needs authenticated event identity,
persistence/reset behavior, abuse controls, and a real Solana execution path if that remains part of
the final design.

## Run

```bash
npm test
npm run play
npm run play -- inspect
npm run play -- commit-reveal
npm run serve
```

`npm run serve` starts the shared service at <http://127.0.0.1:3010>. The browser assets are served
from that same process; serving `web/` as static files by itself will not work because all trusted
market operations now live behind the API.

Optional local settings:

```bash
PORT=3010 HOST=127.0.0.1 COMMIT_MS=20000 REVEAL_MS=10000 npm run serve
```

The `play` CLI and exact simulator helper are organizer-side diagnostics. They must not be included
in a live player attachment bundle.
