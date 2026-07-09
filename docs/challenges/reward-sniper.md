# Challenge Spec — Reward Sniper (DLMM-style, Meteora sponsor candidate)

Status: **FINAL — Challenge 1 of 4 (dynamic DeFi) / Meteora sponsor candidate** · Updated: 2026-07-08

> **Identity in the 4-challenge slate (`04`, `00`):** the **dynamic DeFi / KOTH** challenge. The core
> player task is simple: understand a DLMM-style reward-accounting flaw, then write searcher logic that
> extracts more reward than everyone else from a live market. Its anti-agent layer is secondary:
> dynamic state, relative scoring, scarce high-value attempts, commit–reveal, and imperfect telemetry.
> Source-first discovery is out of v1 (`§6`), so the live solve is **black-box behavioral**, not
> white-box. Real-CTF lineage: DEF CON attack/defense + Dev Cave-style dynamic KOTH + live DeFi
> searcher games + `minions-in-16k`-style granular scoring.

A live, relatively-scored, Solana-native challenge. Teams compete as **searchers/liquidators** in a
purpose-built **DLMM-style liquidity-mining market** on a private validator. The core is a real
reward-accounting bug, and the output is a real technical artifact: a bot/script/client that commits
market actions and moves reward tokens into the team's escrow. The solve path is UI/simulator-first:
teams infer the bug by interacting with a market console, watching bin/reward behavior, then automate
the profitable strategy. The leaderboard is decided by who extracts the most reward value from a
**shared, changing, contested** market during a live round.

> **Framing (important):** this is a DLMM-*style* educational program we build. It is **not**
> Meteora's code, not a Meteora pool, not mainnet, and not "hack Meteora." Local mints only. Source can
> be published after the event; during the round, the primary surface is the market UI + local
> simulator + observed transactions, not source review.

---

## 1. Why this challenge exists / what it proves

- **Sponsor-authentic:** the skill is reasoning about **active liquidity, bin movement, reward
  checkpoints, and window accounting** — the actual conceptual core of DLMM liquidity mining — instead
  of a generic Solana bug with Meteora branding.
- **Proper CTF output:** teams do not submit a static answer. They write and run a searcher client that
  commits actions against the live pool and proves the exploit by moving reward tokens into escrow.
- **Non-Jeopardy:** reading code is not the solve path. The entry ticket is figuring out from market
  behavior that the reward window can be sniped; ranking is live relative extraction.
- **Granular scoring:** inspired by challenges like `minions-in-16k`, the leaderboard should measure
  quality of weaponization. A team that merely discovers the accounting issue should lose to a team
  whose searcher chooses better windows, avoids bad tickets, adapts across regimes, and extracts more
  value over repeated rounds.
- **AI-differentiated in the live phase (see §6):** we do *not* claim "AI-proof." AI is useful for
  scripting once the hypothesis exists; the live round rewards market/accounting understanding,
  timing, and scarce-shot decisions under incomplete information.

---

## 2. The security core

### The invariant the market is supposed to hold
> Liquidity-mining rewards accrue only to liquidity that was actually active during the elapsed reward
> window. Adding liquidity *now* must not retroactively earn rewards for a window it wasn't present for.

### The bug class (real and respected)
This is **just-in-time (JIT) liquidity reward theft** — the DLMM cousin of the classic MasterChef /
staking-pool "update accounting in the wrong order" bug. The exploit: deposit right before a stale
reward window settles, capture rewards you didn't earn, withdraw.

### Why this cannot be a source-code challenge
The naked "call `update_rewards` after the liquidity mutation instead of before" is the single most
pattern-matchable bug in DeFi — an LLM recognizes it on sight. Any version where the main task is
"inspect the source and find the wrong ordering" is out.

So the challenge should be built as a **black-box / gray-box market exercise**:
- players get the market UI, pool state, transaction history, imperfect telemetry, and a local
  simulator;
- they do **not** get the vulnerable program source/IDL as the main artifact during the scored round;
- they infer the issue by trying actions and observing that rewards drift in a way normal active
  liquidity accounting should not allow;
- the code can be open-sourced after the event for writeups and education.

The bug is still the same security core, but discovery is by behavior:

1. **Ordering/checkpoint bug:** `add_liquidity` records the new position checkpoint against the
   **stale pre-settlement accumulator**, then the same bundle triggers settlement of the elapsed window.
   The late position is now eligible for an accumulator delta that belongs to earlier liquidity.
2. **Lazy settlement:** the accumulator only advances when someone *touches the active bin*
   (`claim_rewards` or `swap`). So a fat, exploitable window only exists when time has elapsed **and**
   the active bin has been left untouched — which the reader has to reason about across instructions,
   not spot in one function.
3. **Settlement supply bug:** the stale window is settled after the new liquidity has been added, so
   `reward_per_liquidity += elapsed * rate / liquidity_supply` divides the backlog across a supply that
   includes liquidity that was not active during that elapsed window.

Net: a careful player can discover the bug without source by noticing that fresh liquidity can capture
backlog from a stale window. That is the intended skill: market/accounting exploration first, scripting
second.

---

## 3. What we give the hackers (resources)

- **Market Console UI** for the DLMM-style market: bin ladder, active bin, position controls, reward
  vault, telemetry panel, and ticket actions.
- **Local simulator / replay client** that lets teams run harmless dry-runs against recorded market
  states. It exposes normal actions and outputs, not the vulnerable source.
- **Minimal action SDK** or CLI for legitimate flows (`inspect`, `quote`, `simulate`, `submit ticket`)
  so teams can eventually automate, but not by directly reading the vulnerable implementation.
- **A funded devnet/local wallet** per team, and a **registered team escrow** the scoreboard watches.
- **Local mints** for token X, token Y, and the reward token.
- **A pool-inspection view** that shows enough market state to reason, but not a perfect internal
  accumulator dump.
- **A telemetry card** per team with one imperfect signal about the market.
- **Live scoreboard URL** (also on the big screen): pool state, round timer, each team's extracted
  reward share.
- **An unlockable hint ladder** (small score cost) nudging from "how does reward accrual work here?"
  toward the window idea — so the floor stays reachable for learners.

---

## 4. How a player solves it (POV, floor → ceiling)

**Normal exploration (everyone, minutes):** use the Market Console to place liquidity, move across bins,
watch rewards accrue, claim, remove, and replay states locally. This teaches the mechanics and is the
on-ramp.

**Bug discovery path (no source required):**
1. Run small LP experiments in the UI/simulator.
2. Notice that joining a stale active bin sometimes yields too much reward.
3. Compare behavior across bins that were touched recently vs. untouched bins.
4. Infer that settlement/checkpoint order around add/remove + active-bin movement is wrong.
5. Turn that behavioral insight into a script/bot that spends scarce tickets on the best windows.

**The extraction ladder — each rung is a bigger edge, and higher rungs need judgment, not a loop:**

- **Rung 1 — stale-window claim timing (beginner floor).** Notice from UI/replay behavior that after a quiet period the active
  bin has an unsettled reward window. Add liquidity just before triggering settlement, claim the
  backlog, remove. With a hint, a beginner lands this and gets on the board. *Learned: JIT reward
  timing.*
- **Rung 2 — active-bin selection (intermediate).** Windows only exist where the accumulator is stale.
  Read the bins, find *which* bin has the fattest untouched window, and place there. *Learned:
  per-bin reward accounting.*
- **Rung 3 — bin manipulation via swap (advanced).** Move the active bin with a swap to *open* a
  profitable window elsewhere — but swaps cost fees and move price, so it's a trade-off, not free.
  *Learned: how bin movement drives reward eligibility.*
- **Rung 4 — adversarial timing (expert / PvP).** The window is shared. Any team's claim or swap
  settles the accumulator and *closes* your window. So you race to trigger settlement at the right
  moment, avoid bait windows, or use active-bin movement to change which windows remain exploitable.
  *This rung is where reward-accounting judgment matters most.*

**Round shape:** rewards keep streaming (`reward_rate_per_second`), so windows keep regenerating and
late entrants still have opportunities. Copying a rival's technique is expected and fine — the game is
who spends scarce Sniper Tickets on the best windows.

---

## 5. Scoring (relative, scarce-shot)

- **Raw score** = reward tokens a team moved into its registered escrow during the live round (net of
  what it put in). No fixed points anywhere.
- **Leaderboard value** = share of total extracted: `score_i / Σ score`. Relative to the field, per
  OtterSec's model.
- **Repeated evaluation:** prefer multiple short market rounds over one long round when feasible. Each
  round randomizes market state and reward regime, so the final board reflects searcher quality across
  conditions, not one lucky stale window.
- **Replay log:** store every action, commit/reveal, pool-state delta, ticket spend, and escrow delta.
  This is the DeFi equivalent of a `minions-in-16k` replay: useful for judging, anti-cheat review, and
  post-event writeups.
- **Anti-latecomer:** because rewards keep streaming and windows regenerate, use **share-of-total**,
  not first-come cumulative. Late teams can still climb.
- **High-value attempts:** each team gets **3 Sniper Tickets** per round. A ticket is consumed when a
  team executes the powerful claim bundle (`add + settle + claim`) against a bin. If they use it on the
  wrong bin or wrong tick, it is gone. Normal inspect/swap/liquidity actions can still exist, but the
  major scoring action is scarce.
- **Market-console gateway:** high-value Sniper Ticket plays require a short-lived
  execution voucher issued by the Market Console. The voucher is bound to `team`, `tick`, `bin`, and
  `nonce`, so raw RPC calls cannot directly spam the scoring action. Teams can still automate *after*
  they understand the strategy, but every scarce ticket must pass through the intended market surface.
  Turnstile/session binding can sit in front of the console as friction against cheap scraping, but it
  is not the security boundary.
- **Dynamic environment (rotation):** market parameters — active-bin start, reward regime, bin layout —
  **rotate each round** (and drift within a round). A memorized "claim bin 4 at tick 12" recipe does not
  transfer; the accounting *insight* does. This is the DEF-CON-tick property: the environment shifts, so
  a one-shot exploit isn't enough — you must adapt.
- **Action model — commit–reveal, simply:** first everyone secretly locks in a move, then everyone
  reveals, then the tick resolves. A team cannot wait to see another team's claim and instantly react.
  They must predict.
- **Private intel per team:** each team starts with one imperfect telemetry card (see §6). It gives a
  partial signal about the market, not the answer. Teams infer where stale windows likely are and spend
  Sniper Tickets only when the window looks fat enough.
- **Optional portal flag:** if `escrow_balance > threshold`, the checker also issues an HMAC flag for
  compatibility with a flag-based portal — but the *ranking* is the extraction share, not the flag.

---

## 6. AI reality check (honest, calibrated)

**Do not frame this as "AI-proof."** The important correction is: if the vulnerable source is handed
out as the primary artifact, this challenge collapses into an agent task. Therefore source-first bug
discovery is explicitly out of v1.

The defensible goal is: **AI can help write scripts after the team has a hypothesis, but winning still
requires behavioral exploration, UI/simulator navigation, and scarce-shot security judgment under
incomplete information.**

**Phase-by-phase honesty** (informed by external review):

| Phase | Who's favored | Why |
|---|---|---|
| Source-code bug discovery | **AI (~9/10)** | This path is removed from v1. |
| Behavioral exploration | **mixed** | Players must infer accounting drift from UI/simulator interactions and imperfect telemetry. |
| Exploit implementation | **AI-favored** | Once the hypothesis is known, agents can help script. |
| Live optimization with scarce/partial info | **contested** | AI can plan, but teams cannot brute-force every suspected window. |

Use only these three anti-agent mechanics for v1:

1. **Private intel per team.** Each team gets a different partial view of the same market:
   - noisy reward-rate history;
   - partial bin-touch logs;
   - delayed active-bin movement logs;
   - oracle/regime hints;
   - partial swap-pressure hints.

   The signals are security-relevant but incomplete. They do not say "claim bin 4 now." They help teams
   infer:
   - where the stale window may be;
   - which bin is unsafe;
   - when the accounting is exploitable;
   - whether a window is bait or actually worth spending a ticket on.

2. **Commit–reveal, simply explained.** First: everyone secretly locks in their move. Then: everyone
   reveals their move. Then: the tick resolves.

   Example:

   ```text
   Tick 12:
   Team A commits: claim bin 4
   Team B commits: swap active bin to 6
   Team C commits: add liquidity to bin 4
   Then all reveal.
   Now the tick resolves.
   ```

   This prevents a pure reaction loop: `wait → see opponent claim → react instantly`. Teams must
   predict.

3. **Limited high-value attempts.** Each team gets **3 Sniper Tickets** per round. A ticket allows the
   powerful exploit bundle:

   ```text
   add liquidity + settle stale window + claim reward
   ```

   If a team uses a ticket on the wrong bin or wrong tick, it is wasted. This blocks brute-force
   grinding and forces the real decision:
   - is this window fat enough?
   - will someone else close it?
   - should we wait one more tick?
   - is this a bait?

**The claim to use (with OtterSec / Meteora):**
> This is a DeFi KOTH: teams infer a DLMM-style reward-accounting bug from live market behavior, then
> write searcher logic to extract more reward than the field. AI can help write the bot, but the
> challenge is not source review and not a one-shot flag.

**Validate it, don't assert it.** Playtest **humans vs AI-assisted teams** and publish the result — the
only claim you can actually defend, and a strong thing to show a sponsor.

**Where the design should lean:** not "read code and solve bug" but "**operate the market, infer the
accounting issue, then exploit it better than everyone else**." Lean into that hard.

**Residual risks (stated plainly):** a sophisticated browser-capable agent can still play this well,
especially with human prompting. The design does not prove humans beat agents; it prevents the
static-code failure mode where an agent reads the repo, writes one exploit, and the challenge is over.

---

## 7. How we build it (architecture)

### On-chain program (Anchor)

Accounts:

```text
Pool
  authority
  active_bin
  reward_rate_per_second
  last_reward_update_ts        // used by the (buggy) accrual math
  reward_vault                 // holds the streamable reward supply
  bins[]

Bin
  bin_id
  liquidity_supply
  reward_per_liquidity         // lazy accumulator; advances only on touch
  last_update_tick
  x_reserve
  y_reserve

Position
  owner
  lower_bin, upper_bin
  liquidity_by_bin[]
  reward_checkpoint_by_bin[]
  pending_rewards
  sniper_tickets_remaining     // starts at 3
  last_commit_tick             // one commit per tick
  pending_commitment           // hash(action_args ‖ nonce) for the current tick

ExecutionVoucher
  team_id
  tick
  bin_id
  nonce
  expires_slot
  console_authority_signature

TeamEscrow
  team_id
  owner
  reward_token_account
```

Instructions: `initialize_pool`, `register_team`, `commit_action`, `reveal_action`
(which internally dispatches `add_liquidity` / `remove_liquidity` / `swap` / `claim_rewards` /
`claim_with_sniper_ticket`), plus voucher verification for high-value ticket claims.

The on-chain program is still real and auditable by us, but the scored round should not hand teams a
direct "here is the bug" source bundle. They interact through the Market Console, local replay
simulator, and a limited action SDK. Source/IDL can be released after the round for writeups.

**The commit–reveal tick loop:**

```text
// each team, each tick:
commit_action(tick, commitment = hash(action_args ‖ nonce)):
  require!(commit.tick == current_tick && commit.slot in commit-window)
  require!(position.last_commit_tick < current_tick, OneActionPerTick)
  store commitment; position.last_commit_tick = current_tick

reveal_action(tick, action_args, nonce):
  require!(current_slot in reveal-window for `tick`)
  require!(hash(action_args ‖ nonce) == stored commitment)
  dispatch add_liquidity / remove_liquidity / swap / claim_rewards
// unrevealed commits are void. No team sees another team's move before
// choosing its own.
```

Ticks are derived on-chain from the slot (`tick = Clock::slot / SLOTS_PER_TICK`, ~10s) — no cron
needed. The one-commit-per-tick gate lives in `commit_action` (via `position.last_commit_tick`), so
raw polling speed buys nothing and each ticket play is a blind, simultaneous decision.

**Sniper Ticket execution:**

```text
claim_with_sniper_ticket(bin_id, liquidity_amount, execution_voucher):
  require!(voucher.team == team)
  require!(voucher.tick == current_tick)
  require!(voucher.bin_id == bin_id)
  require!(voucher.console_authority_signature is valid)
  require!(position.sniper_tickets_remaining > 0)
  position.sniper_tickets_remaining -= 1
  add liquidity to target bin
  settle the bin reward window
  claim pending rewards to registered escrow
```

This is the main scoring action. Normal actions teach the mechanics; Sniper Tickets decide the round.
The voucher keeps the high-value path behind the Market Console instead of exposing a perfect
source/IDL/API route.

**The intentional (composed) bug in `claim_with_sniper_ticket` — vulnerable flow:**

```text
claim_with_sniper_ticket(amount):
  enforce one-action-per-tick
  let checkpoint = bin.reward_per_liquidity  // (1) STALE accumulator, before settlement
  bin.liquidity_supply += amount             // (2) fresh liquidity joins the bin
  position.liquidity += amount
  position.reward_checkpoint = checkpoint    // (3) position is checkpointed at R0, not post-settle R1
  update_rewards(bin):                       // (4) stale elapsed window settles lazily
    elapsed = now - pool.last_reward_update_ts
    bin.reward_per_liquidity += elapsed * rate / bin.liquidity_supply
    pool.last_reward_update_ts = now
  claim(position):                          // (5) attacker earns amount * (R1 - R0)
    reward = position.liquidity * (bin.reward_per_liquidity - position.reward_checkpoint)
```

**Correct flow (what a patch looks like):**

```text
claim_with_sniper_ticket(amount):
  enforce one-action-per-tick
  update_rewards(bin)                        // settle stale window BEFORE the new position exists
  bin.liquidity_supply += amount
  position.liquidity += amount
  position.reward_checkpoint = bin.reward_per_liquidity
  claim(position)                            // no stale backlog; only future rewards accrue
```

Ship tests proving (a) the normal LP→reward→claim flow, and (b) the intended over-claim path, so the
design is verifiable and we can detect if a "patch" breaks normal behavior.

### Off-chain services
- **Tick source:** derived on-chain from slot — **no cron needed**, deterministic and trustless. On a
  private validator we control slot time; `SLOTS_PER_TICK` sets the ~10s cadence.
- **Reward stream:** `reward_vault` is funded up front; `reward_rate_per_second` makes claimable
  rewards regenerate over the round (the "refill" that keeps it a live contest).
- **Market Console UI:** the main challenge surface. Players drag/place liquidity across bins, inspect
  active-bin movement, watch reward vault/position behavior, replay recent ticks, and submit Sniper
  Ticket plays. The UI is not decorative; it is the gateway for understanding the market. For each
  Sniper Ticket, the console shows a short tick replay / bin heatmap and the player commits a bin/tick
  choice through the UI; the console issues the execution voucher for that choice.
- **Local simulator / replay client:** ships with recorded market states and the same public quote
  behavior as the UI. Players can run experiments locally, but not inspect the vulnerable accounting
  implementation directly.
- **Limited action SDK:** enough for teams to automate once they understand the strategy (`quote`,
  `simulate`, `commit`, `reveal`, `submit_ticket`). It should not expose a perfect internal state dump.
- **Telemetry cards:** generated at round start and assigned per team. Each card is an imperfect
  market signal: noisy reward-rate history, delayed active-bin logs, partial bin-touch history, or
  regime/oracle hints. These are not secrets needed to solve; they are asymmetric clues that make
  teams reason about where to spend scarce Sniper Tickets.
- **Indexer:** watches `reward_vault` outflows / registered escrow balances → pushes
  `share = score_i / Σ score` to the scoreboard over websocket.
- **Scoreboard web app:** pool state, program/pool/mint addresses, docs, round timer, live leaderboard.
- **Post-round source release:** publish program source and the intended exploit after the round. That
  keeps the event educational without making source review the live solve path.
- **Anti-cheat:** only count reward tokens that left `reward_vault` into a **registered** escrow (via
  portal ticket → `register_team`); Sniper Tickets cap high-value claims; execution vouchers bind
  ticket plays to the Market Console; Sybil teams are bound to portal identity; wash transfers between a
  team's own wallets create no rewards, so they don't score.

---

## 8. Setup & operations (our end)

**One-command local bring-up:**
1. `anchor deploy` the market program to a private `solana-test-validator`.
2. Setup script: create X/Y/reward mints; `initialize_pool` with `active_bin`, `reward_rate_per_second`,
   `SLOTS_PER_TICK`; fund `reward_vault`; seed initial liquidity across a few bins; import the team
   roster from the portal export and `register_team` each escrow with `3` Sniper Tickets.
3. Generate and assign asymmetric telemetry cards to teams.
4. Start the Market Console, local replay/simulator package, indexer, and scoreboard; put the
   scoreboard on the big screen.
5. Hand teams: console URL, pool address, reward mint, funded wallet, telemetry card, limited action
   SDK, docs, hints. Do not hand them the vulnerable source bundle during the scored round.

**Running the round:** open a fixed window (e.g., 45 min) shown as a countdown. Rewards stream the
whole time. At close, freeze escrows; final `share = score_i / Σ score` is the ranking.

**Reset between rounds/cohorts:** a reset script redeploys fresh pool state, fresh mints, fresh
`last_reward_update_ts`, and re-registers escrows — so nothing from a prior run leaks an answer.

---

## 9. Fairness, accessibility, ethics

- **Learner floor is real:** Rung 1 + the hint ladder let a beginner score and learn a genuine DeFi
  bug class. **Expert ceiling is real:** Rungs 3–4 reward deep understanding and live play.
- **Accessibility:** the Market Console is interactive, but it should not depend on eyesight strain,
  hidden text, or arbitrary CAPTCHA tricks. The visual layer should represent real market state
  (bins, heatmaps, tick replay) and have text/table equivalents where possible. The friction should be
  market navigation and judgment, not unreadable media.
- **Ethics / Meteora safety:** always describe it as "compete as searchers in a DLMM-*style* market."
  Never "hack Meteora," never Meteora's real code, never mainnet or real liquidity. Open-source the
  challenge program after the round so it reads as education, and share it back to Meteora.

---

## 10. Build plan (milestones)

1. **Core program v1:** pool/bin/position/escrow, `add_liquidity`/`claim_rewards`, the composed bug,
   the one-commit-per-tick gate. Tests for normal flow + intended over-claim.
2. **Reward stream + tick:** slot-derived tick, funded reward vault, regenerating windows.
3. **Extraction ladder:** add `swap` + `remove_liquidity` so Rungs 2–3 exist; verify windows move with
   the active bin.
4. **Sniper Tickets:** implement `claim_with_sniper_ticket`, initialize each team with 3 tickets, and
   verify failed/low-value tickets are still consumed.
5. **Telemetry cards:** generate asymmetric but imperfect market signals for each team; keep them
   security-relevant, not social/negotiation-based.
6. **Scoring service:** indexer + share-of-total + websocket scoreboard.
7. **Player kit:** limited action SDK, pool inspector, docs, hint ladder.
8. **Market Console + simulator:** browser UI for bin/liquidity/reward exploration; local replay client
   for experiments; limited action SDK for automation after players form a hypothesis.
9. **Execution vouchers:** console authority signs short-lived vouchers for Sniper Ticket plays; program
   verifies voucher binding before consuming a ticket.
10. **Ops:** one-command setup + reset scripts; portal `register_team` integration; big-screen board.
11. **Post-round source release:** publish source, bug explanation, and reference exploit for education.
12. **Playtest:** human beta + an AI-assisted beta. Validate the actual claim: source-first solving is
   removed, and agents can script only after the team has inferred the accounting issue.

---

## 11. Open decisions (for review)

- **Tick length** (`SLOTS_PER_TICK`) and **round length** — should be slow enough to reason, fast enough
  that stale windows matter.
- **Reward rate + vault size** — how fat windows get and how fast they regenerate.
- **Sniper Ticket count** — default is 3 per team per round; tune only after playtest.
- **Telemetry card set** — which partial views are fair/useful: noisy reward-rate history, partial
  bin-touch logs, delayed active-bin logs, oracle/regime hints, partial swap pressure.
- **UI/simulator surface** — how much state the console reveals. It must be enough for security
  reasoning, but not a perfect internal accumulator dump.
- **Voucher strictness** — how much of the high-value path must go through the Market Console vs. the
  SDK. Default: Sniper Ticket claims require console-issued vouchers; normal learning actions can use
  SDK/CLI.
- **Source release timing** — default: post-round only.
- **v1 scope:** include Rung 3 (swap/bin-move) and Rung 4 (PvP) at launch, or ship Rungs 1–2 first and
  layer the rest after playtest?
- **Team size / count** — affects how contested the shared pool feels.
- **Prize threshold** for the optional HMAC flag, if we keep portal flag compatibility.

### The core tension to resolve (from the AI review)

Every mechanic that differentiates humans from AI can raise the floor or pull the challenge from
"security" toward "econ/game-theory." Keep the anti-agent layer small and security-relevant:

- **In for v1:** UI/simulator-first discovery, private intel per team, simple commit–reveal, and 3
  Sniper Tickets.
- **Out for v1:** social negotiation, complex hidden-state machinery, Arcium-sealed regimes, and
  elaborate diminishing-return curves. Also out: source-code bug hunting as the primary solve path.
- **Must validate, not assert:** playtest **humans vs AI-assisted teams**; the leaderboard split is the
  claim. Add this as a launch gate.
- **Open question:** is commit–reveal too abstract for the beginner floor? If so, keep normal learning
  actions direct and apply commit–reveal only to Sniper Ticket plays.
