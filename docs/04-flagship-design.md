# Flagship Design — Non-Jeopardy, Relatively-Scored, Solana-Native

Updated: 2026-07-08

The current design direction for the next Superteam Solana security CTF. This doc holds the event
framing, the scoring decision, the AI policy, and the **four-challenge slate** (§4). **Read
`00-anti-ai-design-principles.md` first** — it is the doctrine this builds on.

**Where the arc landed (important):** we spent a long time trying to make the *bug* agent-proof and
kept producing gimmicks. The resolution (see `00` §2) is to keep the security bug **deep and real**
and put the anti-AI in the **access/action layer**. The event runs **four distinct challenges** (§4),
each Solana-specific and each a different real-CTF style: Reward Sniper (dynamic DeFi KOTH), IMPRINT
(passkey hardware-auth), SIGNET (N-day source archaeology ending in a live Solana exploit), and
DRIFT (bytecode/runtime RE on a localnet).
Full specs in `challenges/`. Sponsorship (incl. the OtterSec fund) lives in `05-sponsorship.md`; deeper
history in `01`–`03`.

---

## 1. Event overview

- **What:** next edition of India's first-ever Solana *security* CTF, run by Superteam. Last edition:
  50+ builders at Microsoft's Bangalore office.
- **Format:** an on-site *event* — fixed synced window, break, food, merch, and a **live leaderboard
  on a big screen** for competitive feel.
- **Participants:** on-site, synced. **Individuals + small teams (up to 2–3).**
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

This mirrors OtterSec's "Save CTFs Fund" thesis (see `05-sponsorship.md` §OtterSec). Our own earlier
work (`03` Part A §self-test) had already concluded the only durable anti-AI property is *interaction
that can't be batched or relayed*. The two conclusions converge.

The most useful concrete precedent is `_mixy1`'s `minions-in-16k` for Project SEKAI CTF 2026: a
reverse-engineering/KOTH game where teams wrote cheats/bots for repeated matches, and scoring measured
performance quality rather than a binary flag. We should take the scoring philosophy, not the game
skin: in Solana terms, the exploit is the entry ticket, and the leaderboard should measure how well a
team weaponizes it across live state changes.

**The Solana-specific insight (also our sponsor pitch):** general CTFs must *manufacture* a
competitive arena. **Solana already is one** — blockspace, transaction ordering, MEV, liquidations,
liquidity are natively zero-sum, real-time, adversarial. Mastering that *is* the Solana security
skill, so a Solana-native relative-scoring format is novel and reusable.

---

## 3. Dynamic / relative scoring (decision)

- **No fixed points.** Challenge value is not pre-assigned by "difficulty."
- **Relative to the field.** A participant's score is a function of how everyone else performed
  (e.g., share of a contested pool, or normalized severity-weighted extraction).
- **Anti-latecomer safeguards** (OtterSec's named pitfall): prefer share-of-total or best-of-N-tick
  over pure first-come cumulative; keep comeback potential; consider end-weighting.
- **Measure solution quality, not just discovery.** The `minions-in-16k` lesson: once the core issue is
  known, ranking should still separate teams by bot quality, timing, robustness, and adaptation across
  repeated evaluations.
- Live big-screen leaderboard is both UX and scoring surface.

## AI policy (stated stance)

Not banning AI. Asking ChatGPT a question is fine. What's disallowed is handing the whole problem to
an autonomous agent (Claude Code / Codex with full permissions to just solve it) — that defeats the
learning. The goal is not "AI can't understand the bug" (impossible); it is **"the autonomous loop
can't complete — a human must be in the loop"** (`00` §1). We enforce that with access/act gates
(hardware-auth touch, wallet approve, venue-local params — `00` §4) **plus on-site proctoring**
(screen-share/replay for prize contention), not a hard technical ban.

---

## 4. The four-challenge slate

The event runs **four distinct challenges**, each Solana-specific, each replicating a different
real-CTF style, and each carrying a **different anti-AI mechanism** so they don't overlap. Full specs
live in `challenges/`.

| # | Challenge | Style | Real Solana bug | Unique anti-AI mechanism |
|---|---|---|---|---|
| 1 | **[Reward Sniper](challenges/reward-sniper.md)** | dynamic DeFi KOTH / searcher game (Meteora) | DLMM-style JIT reward-accounting | dynamic env + relative scoring + scarce high-value attempts |
| 2 | **[IMPRINT](challenges/imprint.md)** | hardware-auth / crypto | secp256r1/WebAuthn owner-binding bug | **passkey biometric touch** + Solana wallet approval + on-site enrollment |
| 3 | **[SIGNET](challenges/signet.md)** | N-day / source archaeology | stale pre-fix CPI/PDA authority bug discovered via silent patch | messy repo history + per-team target + live exploit, with canaries as telemetry |
| 4 | **[DRIFT](challenges/overclock.md)** | reverse-engineering / runtime | bytecode-only vault with adversarial local runtime assumptions | no-source RE + replay checker |

Together they cover distinct CTF skills without repeating the same trick: **dynamic DeFi extraction**
(1), **hardware-auth cryptographic authorization** (2), **N-day audit research** (3), and
**bytecode/runtime reverse engineering** (4). Each ends in a **live per-team exploit or technical
submission**, so there is no read-only/scrape solve in any of them.

**Design rules honored by all four** (`00`): real Solana security core; relative/first-blood scoring;
the anti-AI lives in the access/act layer, not by hiding the bug; on-site proctoring backstop; validate
by playtest (all-human vs AI-assisted vs autonomous-agent).

---

## 5. Earlier brainstorm sketches (superseded by the slate)

Pre-slate ideas, kept only for idea reference — **not** the build targets. Vault Siege (contested-pool
heist), Exploit-vs-Patch tournament, and Graduated Heist were white-box relative-scoring concepts; their
useful parts (contested pool, matrix defense, graduated severity) were folded into the slate above or
into `00`'s failure log. Retained below for provenance.

### A. The Vault Siege — live contested-pool heist *(relative-scoring component)*
One shared vulnerable "community vault" on a local devnet holds a **finite, slowly-refilling prize
pool**. Everyone attacks the *same* pool at once. **Score = your share of the pool you hauled into
your own escrow**, shown live.

- **Resources to hackers:** vault program source (Rust/Anchor); IDL + TS starter client that already
  does the *legit* actions; a funded wallet + watched escrow per team; live scoreboard URL; an
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
team's exploits vs every team's patched build. **Score = rival instances you drained + your patch's
survival.**

- **Resources:** vulnerable protocol source (several planted bugs); one-command build+deploy toolkit;
  local functionality test suite; exploit submission format.
- **Solve (POV):** read source, weaponize as many bugs as possible, submit exploits; then patch under
  fire without breaking functionality; matrix decides the board (re-runs → comeback potential).
- **Our setup:** submission portal; **sandboxed builder** (Docker/nsjail) compiling + deploying each
  team's Rust safely; a **functionality gate** (kills "defend by disabling everything"); an N×N
  tournament runner streaming to the board.
- **Anti-AI:** defense is agent-hard (fix subtly, preserve functionality, anticipate rivals' exploits).
  Honest weaknesses: agents can auto-exploit + auto-patch textbook bugs (bugs must be novel
  compositions); **high floor** — tough for learners.

### C. Graduated Heist — one rich target, severity-scored *(gentle companion)*
One big messy per-team protocol suite (vault + oracle + rewards distributor CPI-ing into each other)
riddled with bugs of graduated severity. **Score = severity-weighted value extracted, normalized vs
the field.**

- **Resources:** multi-program suite source; IDLs + client; per-team private instance; a checker
  endpoint that validates each exploit's state change and awards severity-weighted value.
- **Solve (POV):** no single flag — many bugs worth different amounts; work down the ladder at your
  level (beginner lands two easy ones; expert finds the deep cross-program composition bug).
- **Our setup:** per-team deploy (fresh salts, randomized targets → no verbatim answer-sharing);
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
4. **Relative scoring + companions** — whether to run an Earlier-candidate (§5) alongside IMPRINT for
   variety, and the scoring formula.
5. Feed the flagship into the OtterSec one-pager (`05-sponsorship.md`).

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

Sponsor-specific candidate for Meteora: teams compete as searchers/liquidators in a DLMM-style
liquidity-mining market on a private validator. It is **UI/simulator-first**, not source-first: teams
operate a market console, infer a composed JIT-liquidity reward-accounting issue from behavior, then
compete for live relative extraction with asymmetric telemetry, commit–reveal ticks, and scarce Sniper
Tickets.

**Full standalone spec (build / setup / solve / scoring / anti-AI / build plan):**
[`challenges/reward-sniper.md`](challenges/reward-sniper.md).

Key point from the anti-AI review: static source + one accounting bug is agent-solvable, so source-code
bug hunting is out as the primary solve path. The better claim is narrower: AI can help script after a
team has a hypothesis, but ranking should depend on UI/simulator exploration, scarce-shot security
judgment, and incomplete information. The v1 hardening is: market-console gateway, asymmetric telemetry
cards, simple commit–reveal ticks, and 3 high-value Sniper Tickets per team. High-value ticket claims
should require short-lived Market Console execution vouchers so the scoring path is not just raw RPC
calls against an exposed program.
