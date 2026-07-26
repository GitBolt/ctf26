# Flagship Design — Non-Jeopardy, Relatively-Scored, Solana-Native

Updated: 2026-07-22

The current design direction for the next Superteam Solana security CTF. This doc holds the event
framing, the scoring decision, the AI policy, and the **eleven-challenge slate** (§4). **Read
[`anti-ai.md`](anti-ai.md) first** — it is the doctrine this builds on.

**Where the arc landed (important):** we spent a long time trying to make the *bug* agent-proof and
kept producing gimmicks. The resolution (see
[`anti-ai.md` §2](anti-ai.md#2-the-key-model-two-layers)) is to keep the security bug **deep and real**
and put the anti-AI in the **access/action layer**. The event runs **eleven distinct challenges** (§4),
each Solana-specific and each a different real-CTF style: Reward Sniper (dynamic DeFi KOTH), IMPRINT
(passkey hardware-auth), SIGNET (N-day source archaeology ending in a live Solana exploit), DRIFT
(bytecode/runtime RE on a localnet), LAST STOP (hosted SSH/PDA journey), AFTER HOURS
(Discord-native checkout reconciliation), PLAYER TWO (credential lifecycle arcade), THE BROADCAST
(wallet-signature cryptography), EVIDENCE ROOM (account initialization lifecycle), SECOND KEY
(Token-2022 custody analysis), and THE CHAMBER (cross-program invocation authority).
Full specs live in [`../challenges/`](../challenges/). Sponsorship, including the OtterSec fund, lives in
[`../ops/sponsors.md`](../ops/sponsors.md); deeper history lives in [`../research/`](../research/).

---

## 1. Event overview

- **What:** next edition of India's first-ever Solana *security* CTF, run by Superteam. Last edition:
  50+ builders at Microsoft's Bangalore office.
- **Format:** an on-site *event* — fixed synced window, break, food, merch, and a **live leaderboard
  on a big screen** for competitive feel.
- **Participants:** on-site, synced, and scored individually. Registration, challenge state, and
  awards all use one stable participant ID per person.
- **Audience:** *not* elite hackers — people curious about the Solana ecosystem who want to get into
  security or just learn. Design needs a **low floor** (beginners score and learn) and a **high
  ceiling** (the leaderboard still rewards deep skill).
- **Build capacity:** solid — several weeks and real devs. Ambitious live-PvP infra (shared cluster,
  live scoring, sandboxed submissions, anti-cheat) is feasible.

---

## 2. Why non-Jeopardy (the problem)

Jeopardy (solve → fixed points) is broken by two forces:

1. **Agentic AI** — not just better models. Agents download anything, write helper scripts, work
   across multimedia, crawl sites, and learn to solve in real time. Cranking difficulty is
   "difficulty chicken" against frontier training runs — unwinnable.
2. **Fixed points no longer measure skill** — when AI flattens the solve curve, an absolute
   leaderboard measures token budget and luck.

This mirrors OtterSec's "Save CTFs Fund" thesis (see `../ops/sponsors.md` §OtterSec). Our own earlier
work ([`challenge-ideas.md` §8](../research/challenge-ideas.md#8-adversarial-self-test--could-i--codex--a-computer-use-agent-solve-v1))
had already concluded the only durable anti-AI property is *interaction that can't be batched or
relayed*. The two conclusions converge.

The most useful concrete precedent is `_mixy1`'s `minions-in-16k` for Project SEKAI CTF 2026: a
reverse-engineering/KOTH game where participants wrote cheats/bots for repeated matches, and scoring measured
performance quality rather than a binary flag. We should take the scoring philosophy, not the game
skin: in Solana terms, the exploit is the entry ticket, and the leaderboard should measure how well a
participant weaponizes it across live state changes.

**The Solana-specific insight (also our sponsor pitch):** general CTFs must *manufacture* a
competitive arena. **Solana already is one** — blockspace, transaction ordering, MEV, liquidations,
liquidity are natively zero-sum, real-time, adversarial. Mastering that *is* the Solana security
skill, so a Solana-native relative-scoring format is novel and reusable.

---

## 3. Dynamic / relative scoring (decision)

The model is implemented in `packages/leaderboard/` and exposed publicly at `/leaderboard` in the
portal. It has four locked principles:

1. **No author-assigned difficulty.** Every challenge has the same 1,000 point cap. Authors do not
   choose easy, medium, hard, decay, or first-blood bonuses.
2. **Equal work receives equal current credit.** Everyone who solves the same binary challenge holds
   the same value, including a participant who solves later. When another participant solves, the
   value changes retroactively for every solver.
3. **The present scoring field is the denominator.** Let `N` be the number of rostered participants
   who have signed in and accepted the current rules for this event generation. The portal derives
   that set from durable acknowledgments, so it supports any actual turnout without a hard-coded
   attendance count. Rehearsal simulations use 50 participants only as a capacity example.
4. **Time is not a hidden tiebreaker.** Equal totals share the same rank and prize weight. Final
   currency rounding can differ by at most one cent. Solve time remains integrity evidence, not score.

### Binary challenge value

IMPRINT, SIGNET, DRIFT, LAST STOP, AFTER HOURS, PLAYER TWO, THE BROADCAST, EVIDENCE ROOM,
SECOND KEY, and THE CHAMBER use one
information-content curve. For `s` unique participant solves in a checked-in field of `N`:

```text
value(s, N) = round_to_10(250 + 750 × ln(N / s) / ln(N))
```

An unsolved challenge displays its 1,000 point ceiling but awards nothing. The first solve is worth
1,000. A challenge solved by the entire field settles at 250. The 250 floor keeps a common capture
meaningful, while the 4-to-1 ceiling-to-floor ratio prevents one rare solve from erasing a broad body
of work. At `N = 50`, solve counts of 1, 2, 5, 10, 20, and 50 produce 1,000, 870, 690, 560, 430, and
250 points respectively.

This is normalized self-information, not an author difficulty estimate. CTFd's official dynamic-value
model established the useful precedent that challenge value falls with solve count and changes for
previous solvers as well as new ones. We use the actual field size instead of a manually selected
decay parameter so every challenge follows the same rule.

### Reward Sniper performance value

Reward Sniper is already granular. Its authoritative score is the sum of each participant's finalized
per-round share of the live market. The leaderboard does not flatten that into a binary solve:

```text
reward_sniper_points(i) = round(1,000 × market_score(i) / highest_market_score)
```

The leader receives 1,000. Every other participant receives their direct performance ratio. Practice
rounds do not count, and after the market closes an entrant who failed Reward Sniper's existing
minimum-round qualification receives zero. A positive qualifying performance always receives at
least one point, even when the ratio would otherwise round below one. This keeps the challenge
genuinely relative without an extra subjective exponent or bonus.

### Rank and projected prize

Total points are the sum of the ten binary values plus Reward Sniper points, for an 11,000-point
theoretical ceiling. Every participant with positive points first receives the configured individual
award floor. The remainder of the configured pool follows points, with a small 10% boost to the top
ten. Rank does not otherwise determine payout:

```text
prize_weight(i) = points(i) × 1.10, when rank(i) <= 10
prize_weight(i) = points(i), when rank(i) > 10
merit_pool = configured_pool - (individual_floor × number of scoring participants)
live_award(i) = individual_floor + merit_pool × prize_weight(i) / sum(all positive prize weights)
```

This makes the money follow demonstrated accomplishment instead of placement. Solving even one
challenge always creates a positive prize share. Among participants on the same side of the cutoff,
a participant with 10,000 points has twice the theoretical prize weight of one with 5,000 points. The
top-ten boost is deliberately small enough that points remain the dominant factor. Exact point ties
receive equal theoretical weights, including a tie at rank ten, where the entire tie group receives
the boost.

The board recalculates the projection every five seconds. A score change or movement into or out of
the top ten immediately changes every participant's share. The pool and individual floor are event
configuration, not fixed policy. The checked-in `$4,000` pool and `$10` floor are rehearsal examples;
organizers must deliberately set and publish the final values before scoring opens. Live projections
are not payout promises. The board freezes after the event and final payouts follow integrity review.

Money is allocated in integer cents. Each scoring participant receives the configurable floor set by
`LEADERBOARD_MIN_INDIVIDUAL_AWARD_USD`. The remaining cents follow the published
prize weights. Any indivisible remainder is assigned by the largest-remainder method with participant ID as a
stable final tiebreaker. This guarantees that the displayed cent values sum to the configured pool
exactly. Currency rounding can make otherwise equal theoretical shares differ by at most one cent when
the pool cannot be divided evenly.

### Event lifecycle

The field and clock are explicit scoring inputs, not values inferred from traffic. Before doors open,
organizers set the final roster, checked-in participant IDs, field size, UTC start, and UTC end, then switch
`LEADERBOARD_SCORING_MODE` from `staging` to `live`. Live ingest rejects participants outside that frozen field
and solve times outside the scoring window. At the event end, organizers switch to `recovery` for 30
minutes. Signed retries and authoritative completion recovery remain available during that period, but
only for solves whose completion time was inside the scoring window. After recovery closes, organizers
switch to `freezing` and call the organizer-only finalization endpoint. Finalization requires a fresh,
complete Reward Sniper source and seals the first final leaderboard snapshot in Redis. Organizers then
switch to `frozen`, which rejects new scores and serves the sealed snapshot. Public polling reads a
shared four-second snapshot rather than querying Reward Sniper once per browser.

### Why this model

- [CTFd scoring documentation](https://docs.ctfd.io/docs/scoring/overview/) and its archived
  [Dynamic Value Challenge implementation](https://github.com/CTFd/DynamicValueChallenge) support
  solve-count repricing and equal value for equal solvers.
- [OtterSec's Save CTFs Fund](https://osec.io/blog/save-ctfs-fund/) argues for granular performance
  scoring, repeated evaluation, and protections against pure early cumulative advantage. Reward
  Sniper keeps that granular path; the other challenges use rarity because their authoritative
  verifier is binary.
- The Digital SAT analogy was rejected after checking the
  [College Board scoring explanation](https://satsuite.collegeboard.org/scores/what-scores-mean/how-scores-calculated).
  The SAT uses pre-equated item characteristics and IRT; one student's score is not curved against
  the current room. It is not a model for this event's peer-relative board.
- The prize mapping is intentionally auditable: points establish every participant's base share and
  a single published 10% multiplier rewards the top ten. There are no fixed placement prizes or
  hidden weighting curves.

### Simulation suite

Run `npm run simulate:leaderboard`. The deterministic suite uses a 48-to-50 participant range and a
$4,000 example pool. These values test the formula; they do not set attendance or award policy.

| Scenario | Checked in | Scoring entrants | Lead score | First-place projection | What it checks |
|---|---:|---:|---:|---:|---|
| Opening hour | 48 | 7 | 6,950 | $1,602.00 | all nine binaries participate in early pool concentration |
| Balanced midpoint | 50 | 31 | 5,660 | $309.39 | retroactive values and exact score ties |
| One common route | 50 | 41 | 5,420 | $261.46 | a widely solved challenge settles near its floor |
| Rare-route specialist | 49 | 40 | 4,510 | $226.62 | well-selected rare solves can beat broader common solves |
| Market specialist | 50 | 31 | 5,210 | $287.43 | continuous market performance changes rank without a fake flag |
| Late full field | 50 | 42 | 4,780 | $183.94 | stable payout conservation near full turnout |

The suite also checks turnout sensitivity at 45 and 50. A challenge with 10 solves is worth 550 and
560 points respectively, so an honest attendance correction does not cause a large ranking
shock. Automated invariants verify monotonic challenge values, equal points for equal solves, no
late-solver penalty, cent-level tie fairness, zero prize for zero points, the published minimum for
every scoring participant, and exact conservation of the example pool.

## AI policy (stated stance)

Not banning AI. Asking ChatGPT a question is fine. What's disallowed is handing the whole problem to
an autonomous agent (Claude Code / Codex with full permissions to just solve it) — that defeats the
learning. The goal is not "AI can't understand the bug" (impossible); it is **"the autonomous loop
can't complete — a human must be in the loop"**
([`anti-ai.md` §1](anti-ai.md#1-the-honest-target-and-the-reframe-that-unlocked-everything)). We
enforce that with access/act gates (hardware-auth touch, wallet approve, venue-local params; see
[`anti-ai.md` §4](anti-ai.md#4-what-agents-are-bad-at--build-the-barrier-here)) **plus on-site proctoring**
(screen-share/replay for prize contention), not a hard technical ban.

---

## 4. The eleven-challenge slate

The event runs **eleven distinct challenges**, each Solana-specific, each replicating a different
real-CTF style, and each carrying a **different anti-AI mechanism** so they don't overlap. Full specs
live in [`../challenges/`](../challenges/).

| # | Challenge | Style | Real Solana bug | Unique anti-AI mechanism |
|---|---|---|---|---|
| 1 | **[Reward Sniper](../challenges/reward-sniper.md)** | dynamic DeFi KOTH / searcher game (Meteora) | DLMM-style JIT reward-accounting | dynamic env + relative scoring + scarce high-value attempts |
| 2 | **[IMPRINT](../challenges/imprint.md)** | hardware-auth / crypto | secp256r1/WebAuthn owner-binding bug | platform-passkey verification + wallet approval + integrity review |
| 3 | **[SIGNET](../challenges/signet.md)** | N-day / source archaeology | stale pre-fix CPI/PDA authority bug discovered via silent patch | messy repo history + per-participant target + live exploit, with canaries as telemetry |
| 4 | **[DRIFT](../challenges/drift.md)** | reverse-engineering / runtime | bytecode-only vault with adversarial local runtime assumptions | no-source RE + replay checker |
| 5 | **[LAST STOP](../challenges/last-stop.md)** | hosted SSH text adventure | variable-length PDA seed-boundary collision | one-use passage + live native replay + terminal-native discovery |
| 6 | **[AFTER HOURS](../challenges/after-hours.md)** | Discord-native checkout | token identity omitted from payment reconciliation | Discord-native flow, live ledger evidence, telemetry, and prize-contender proctoring |
| 7 | **[PLAYER TWO](../challenges/player-two.md)** | credential-lifecycle arcade | stale and current membership passes remain simultaneously valid | participant-bound live evidence, telemetry, and prize-contender proctoring |
| 8 | **[THE BROADCAST](../challenges/the-broadcast.md)** | hosted wallet cryptography | Ed25519 signature variants bypass byte-level uniqueness accounting | bounded proof of work, uniform receipts, telemetry, and prize-contender proctoring |
| 9 | **[EVIDENCE ROOM](../challenges/evidence-room.md)** | live account-lifecycle investigation | legacy token account created before initialization | participant-bound live state, telemetry, and prize-contender proctoring |
| 10 | **[SECOND KEY](../challenges/second-key.md)** | live collateral custody | Token-2022 permanent delegate bypasses lender custody assumption | mint-extension discovery + real delegated removal + live invariant checker |
| 11 | **[THE CHAMBER](../challenges/the-chamber.md)** | three-lock vault authorization | CPI-shape check mistaken for an authorization boundary | venue-issued physical co-signing key + unprompted deploy-your-own-program leap |

Together they cover distinct CTF skills without repeating the same trick: **dynamic DeFi extraction**
(1), **hardware-auth cryptographic authorization** (2), **N-day audit research** (3),
**bytecode/runtime reverse engineering** (4), terminal PDA reasoning (5), and payment reconciliation
(6), **credential lifecycle analysis** (7), **wallet-signature cryptography** (8), account lifecycle analysis (9), Token-2022 authority analysis (10), and cross-program invocation authority (11). Each ends in a
**live per-participant exploit or technical submission**, so there is no read-only or scrape-only solve in
any of them.

**Design rules honored by all eleven** ([`anti-ai.md`](anti-ai.md)): real Solana security core; one shared field-relative
scoring contract with no first-blood bonus; anti-AI in the access/act layer rather than hiding the
bug; on-site proctoring backstop; validation by all-human, AI-assisted, and autonomous-agent playtest.

---

## 5. Earlier brainstorm sketches (superseded by the slate)

Pre-slate ideas, kept only for idea reference — **not** the build targets. Vault Siege (contested-pool
heist), Exploit-vs-Patch tournament, and Graduated Heist were white-box relative-scoring concepts; their
useful parts (contested pool, matrix defense, graduated severity) were folded into the slate above or
into [`anti-ai.md`'s failure log](anti-ai.md#8-the-failure-log-so-we-dont-repeat-it). Retained below for provenance.

### A. The Vault Siege — live contested-pool heist *(relative-scoring component)*
One shared vulnerable "community vault" on a local devnet holds a **finite, slowly-refilling prize
pool**. Everyone attacks the *same* pool at once. **Score = your share of the pool you hauled into
your own escrow**, shown live.

- **Resources to hackers:** vault program source (Rust/Anchor); IDL + TS starter client that already
  does the *legit* actions; a funded wallet and watched escrow per participant; live scoreboard URL; an
  unlockable hint ladder.
- **Solve (player POV):** a three-bug ladder — shallow **rounding dust** in `withdraw` (beginners
  skim, get on the board); medium **missing owner check** in `claim_rewards` (bigger haul); deep
  **unpinned CPI / PDA authority** where the vault derives `strategy_authority` under a caller-supplied
  program id (deploy your own program, CPI in as the strategy, drain big). Pool refills slowly → live
  race; copying the technique is fine — the game is who extracts most, fastest.
- **Our setup:** deploy the vault once to a shared `solana-test-validator`/private devnet seeded with
  a big pool; a **faucet** refills every N seconds (the throttle); an **indexer** watches escrows →
  `haul_i / total_hauled` → websocket scoreboard; anti-cheat (rate-limit, detect self-transfers, only
  count tokens that left the vault into a registered escrow); **diminishing returns / segmented
  sub-pools** to fix rich-get-richer.
- **Anti-AI:** no static artifact — state changes every second and you race live humans; an agent can
  rediscover the bug but can't out-race an adapting room; relative scoring means "found a bug" ranks
  low unless you also win the live economic game. Honest: a human *driving* an agent does well (fine);
  agent-as-autonomous-solver does not win.

### B. Exploit-vs-Patch Tournament — the auditor's game *(future elite edition)*
Everyone gets the same vulnerable protocol; Phase 1 attack (weaponize bugs), Phase 2 defend (patch
your own deployment, must still pass functionality tests). Infra runs an **N×N matrix** of every
participant's exploits against every participant's patched build. **Score = rival instances you drained + your patch's
survival.**

- **Resources:** vulnerable protocol source (several planted bugs); one-command build+deploy toolkit;
  local functionality test suite; exploit submission format.
- **Solve (POV):** read source, weaponize as many bugs as possible, submit exploits; then patch under
  fire without breaking functionality; matrix decides the board (re-runs → comeback potential).
- **Our setup:** submission portal; **sandboxed builder** (Docker/nsjail) compiling + deploying each
  participant's Rust safely; a **functionality gate** (kills "defend by disabling everything"); an N×N
  tournament runner streaming to the board.
- **Anti-AI:** defense is agent-hard (fix subtly, preserve functionality, anticipate rivals' exploits).
  Honest weaknesses: agents can auto-exploit + auto-patch textbook bugs (bugs must be novel
  compositions); **high floor** — tough for learners.

### C. Graduated Heist — one rich target, severity-scored *(gentle companion)*
One big messy per-participant protocol suite (vault + oracle + rewards distributor CPI-ing into each other)
riddled with bugs of graduated severity. **Score = severity-weighted value extracted, normalized vs
the field.**

- **Resources:** multi-program suite source; IDLs + client; per-participant private instance; a checker
  endpoint that validates each exploit's state change and awards severity-weighted value.
- **Solve (POV):** no single flag — many bugs worth different amounts; work down the ladder at your
  level (beginner lands two easy ones; expert finds the deep cross-program composition bug).
- **Our setup:** per-participant deploy (fresh salts, randomized targets to prevent verbatim answer-sharing);
  checker recognizing each intended exploit by state transition; relative-normalization to the board.
- **Anti-AI:** graduated scoring makes human *depth* visible even when agents one-shot shallow bugs.
  Honest: weakest of the three on anti-agent (still "find bugs"), but most buildable and learner-friendly.

### Quick compare

| | Learner floor | Skill ceiling | Anti-agent | Live drama | Build effort | OtterSec wow |
|---|---|---|---|---|---|---|
| **A. Vault Siege** | Low (good) | High | Strongest | High | Medium-high | Highest |
| **B. Exploit-vs-Patch** | High (tough) | High | Strong | Medium | Highest | High |
| **C. Graduated Heist** | Low (good) | Medium-high | Weakest | Low | Lowest | Medium |

---

## 6. Open design decisions / next steps

1. **Lock the flagship** — confirm **IMPRINT** (§4) as the flagship; decide which binding bug variant.
2. **Design the hardware-auth gate concretely** — the passkey enrollment/assert flow, the on-chain
   secp256r1 verification + the planted binding bug + a correct-patch reference, and how we close the
   virtual-authenticator gap (on-site enrollment + attestation + proctoring). This is the load-bearing
   piece — spec it first. (→ writing-plans.)
3. **Decide the access-layer stack** — passkey + Solana wallet approval + optional venue-local parameter +
   proctoring rules (screen-share/replay for prize contention).
4. **Event-day scoring configuration** — lock actual check-in count, publish the final prize pool,
   verify all eleven signed solve reporters, and rehearse a scoreboard freeze plus integrity review.
5. Feed the flagship into the OtterSec one-pager (`../ops/sponsors.md`).

---

## Appendix — Umbra integration reference (for a possible sponsor challenge)

Umbra = privacy infra on Solana (confidential transfers, shielded balances), MPC-backed (Arcium).
SDK depth a challenge can use as a "must actually learn it" gate:
- Shielded accounts (Encrypted Token Accounts / ETAs), Stealth Pool Notes (receiver-/self-burnable,
  Groth16 proofs), viewing-key scanning of merkle trees, withdrawal/settlement, relayer/MPC burns.
- Path: pin `@umbra-privacy/sdk` + `snarkjs`; signer → client init → registration (ZK) → deposit
  ATA→ETA → withdraw → generate stealth note → scan → burn via relayer.
- Docs: https://sdk.umbraprivacy.com/quickstart


## Appendix — Meteora sponsor challenge: Reward Sniper

Sponsor-specific candidate for Meteora: participants compete as searchers or liquidators in a DLMM-style
liquidity-mining market on a private validator. It is **UI/simulator-first**, not source-first: participants
operate a market console, infer a composed JIT-liquidity reward-accounting issue from behavior, then
compete for live relative extraction with asymmetric telemetry, commit–reveal ticks, and scarce Sniper
Tickets.

**Full standalone spec (build / setup / solve / scoring / anti-AI / build plan):**
[`../challenges/reward-sniper.md`](../challenges/reward-sniper.md).

Key point from the anti-AI review: static source + one accounting bug is agent-solvable, so source-code
bug hunting is out as the primary solve path. The better claim is narrower: AI can help script after a
participant has a hypothesis, but ranking should depend on UI/simulator exploration, scarce-shot security
judgment, and incomplete information. The v1 hardening is: market-console gateway, asymmetric telemetry
cards, simple commit–reveal ticks, and 3 high-value Sniper Tickets per participant. High-value ticket claims
should require short-lived Market Console execution vouchers so the scoring path is not just raw RPC
calls against an exposed program.
