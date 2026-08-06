# Reward Sniper

Reward Sniper is a shared DLMM-style market. You receive one unscored practice round followed by three
scored rounds. Each scored round awards you your share of the reward extracted in that round;
the final event score is the sum of those normalized round shares.

## Start

The shared event market has been retired. Run a fresh local market from the public repository:

```bash
cd apps/reward-sniper
npm install
npm run serve
```

Open `http://127.0.0.1:3010/web/`. With no participant-ticket secret, the service creates an
anonymous local participant so the full round loop can be explored without the event portal.

## Round loop

Each tick has two phases:

1. **Commit:** select a bin and lock one exact order. Other participants cannot see the order.
2. **Reveal:** reveal the same order and nonce. Accepted reveals enter one deterministic settlement
   batch after the phase closes.

A missed reveal does not settle. A participant can resolve at most one action per tick.

Each round gives you three Sniper Tickets and a funded liquidity balance. A successful ticket
order consumes one ticket and the submitted liquidity. A market swap consumes the tick but not a
ticket; it moves the active bin and directly extracts no reward. Market parameters, initial history,
active bin, and participant ticket balances rotate at the next round. Practice extraction is discarded when
scoring begins. Scored rounds start from unseen regimes, so an exact sequence learned in practice is
not a reusable answer.

Public liquidity, active-bin state, activity heat, and telemetry are observations, not internal
accumulator values. Reward samples are noisy, flow is probabilistic, and touch records are partial and
delayed. Combine the signals; none directly identifies the best outcome.

Passive inspection is unlimited. State-changing actions are limited to one per tick, and only three
high-value ticket orders are available each round. There is no hypothetical-outcome or reset API.

## Deliverables

Live ranking is determined by normalized extraction share. A solo rehearsal is mechanically validated
only after positive extraction in at least two scored rounds; rank one on an otherwise empty board is
not a completed test. Prize eligibility also requires the participant to retain their searcher source, explain
the vulnerable reward behavior, describe the evidence used to infer it, and identify one successful
settled extraction after the event.

## SDK

`sdk.mjs` exposes inspect, lock, reveal, and scoreboard flows without a market optimizer:

```js
import { RewardSniperClient } from "./sdk.mjs";

const client = new RewardSniperClient({
  baseUrl: "http://127.0.0.1:3010/",
  searcherToken: process.env.REWARD_SNIPER_SEARCHER_TOKEN,
});

const market = await client.market();
const locked = await client.lockTicket({ binId: 2, liquidity: 900 });

// Wait until market.phase === "reveal", then:
await client.reveal(locked);
```

Keep the complete locked-order object and nonce until settlement. Losing it means the commitment
cannot be revealed.

The live page uses an HttpOnly browser session and does not store an API token in browser storage. To
authorize a terminal searcher deliberately, open the live market's browser developer console and run:

```js
copy((await fetch("/api/searcher-session", {
  method: "POST",
  headers: { "x-reward-sniper-searcher": "issue" },
}).then((response) => response.json())).searcherToken);
```

Export the copied value as `REWARD_SNIPER_SEARCHER_TOKEN`. It is bound to your participant and
current market event, expires after 90 minutes, and stops working after an organizer reset.
