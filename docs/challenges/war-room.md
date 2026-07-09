# Challenge Spec — WAR ROOM (live defensive incident response)

Status: **DESIGN DRAFT — proposed challenge; no implementation yet** · Updated: 2026-07-10 ·
Codename: WAR ROOM

**One line:** a Solana protocol is being **drained right now** by an adaptive attacker bot on your
team's isolated instance. You hold the protocol's **guardian authority** but not the money. Read the
live on-chain telemetry, diagnose which exploit is running, and land the **correct guardian transaction**
to stop the bleed before the reserve empties. Then the attacker escalates.

> **Proposed identity in the slate:** the **blue-team / live incident-response** challenge — the only
> defensive one. The skill is not "find a bug and write an exploit"; it is **recognize an exploit in
> progress from live state and neutralize it with the right on-chain action, under a ticking clock,
> against an adversary that adapts to your moves.** The anti-agent property is not in hiding the bug; it
> is the **live, moving, adversarial format** (`00` §4.5). This is the event's natural **capstone**: its
> attack rounds reuse the bug classes the offense challenges teach.

This document is the organizer design and answer key. The player-facing brief (§2) deliberately does not
name any vector or lever.

---

## 1. Why this challenge earns a slot

Every other challenge in the slate is **offense**: find a flaw, weaponize it, move value out. WAR ROOM
is the inverse and the finale. The lesson it teaches:

```text
finding a bug and stopping a bug in progress are different skills — and the second one is under a clock
```

Real protocol security teams live on the defensive side: an incident fires, telemetry is noisy, the
attacker is already in the mempool, and the guardian/multisig has minutes to pick the *one right lever*
(pause, rotate an authority, switch an oracle, revoke a delegate, blacklist a program) without nuking
the whole protocol. That is genuine, respected, under-taught Solana security work, and no Solana CTF
does it.

It is also the strongest possible fit for our anti-agent doctrine. There is no static artifact to hand
an autonomous agent. The input is a **live stream** of accounts and transactions; the correct action
changes second to second; and the attacker **adapts** when you block a vector. An unattended agent
plans against a stale snapshot and gets out-maneuvered. A human triages live.

### Distinctness from the existing challenges

| Challenge | Side | Primary skill | Winning action |
|---|---|---|---|
| Reward Sniper | offense | live market/accounting strategy | extract from changing reward state |
| IMPRINT | offense | WebAuthn/secp256r1 authorization | land a passkey-backed cross-vault withdrawal |
| SIGNET | offense | source archaeology + CPI authority | drain a stale program via a malicious strategy |
| DRIFT | offense | sBPF RE + runtime assumptions | manipulate an isolated replay |
| DRESS REHEARSAL | offense | loader/release-governance TOCTOU | replace approved code and upgrade the trusted program |
| **WAR ROOM** | **defense** | **live incident diagnosis + guardian response** | **stop an in-progress drain with the correct on-chain action** |

WAR ROOM is the only challenge where the player **never moves value out** and never writes an exploit.
It is deliberately the capstone: its rounds recycle the same bug classes (oracle, CPI/delegate,
reward-accounting, Token-2022 extension accounting) so a player who exploited them earlier must now *recognize
and counter* them live. Offense teaches the class; WAR ROOM tests whether you truly understand it.

---

## 2. Player-facing brief

Short, and it names nothing:

> **WAR ROOM**
>
> You are the on-call guardian for a live protocol. Something is wrong with the reserve.
>
> You hold the protocol's **guardian authority**. You do **not** hold the funds and cannot withdraw
> them. Keep as much of the reserve inside the protocol as you can. The situation will change.

The console may document the guardian instructions that exist and the fact that the reserve is falling.
It must **not** say which exploit is running, which lever stops it, or that the attacker will pivot.
Those are the earned conclusions.

Do not advertise this as "stop the oracle attack" or "revoke the delegate." Diagnosis is the challenge.

---

## 3. The real Solana primitive

The challenge uses **real deployed Solana programs** running on a per-team validator, a **real attacker
process** submitting real transactions, and a **real guardian role** whose instructions perform real
state changes. No JavaScript model of an "attack."

The setup mirrors how production protocols are actually governed:

- a **protocol program** with a token **reserve** whose authority is a program PDA;
- a **guardian authority** (a role the team's registered wallet holds) with a bounded, realistic toolkit
  of admin instructions — e.g. `pause_market`, `set_oracle_source`, `revoke_delegate`,
  `rotate_strategy_authority`, `set_param`, `blacklist_program`, `freeze_rewards`. The exact toolkit is
  per-scenario (§5); the guardian can **defend but never withdraw**;
- a **live attacker** (organizer-controlled off-chain bot) that continuously submits transactions
  exploiting one bug class at a time, moving reserve tokens toward an attacker-controlled account;
- a **live console** streaming the on-chain truth: reserve balance over time, recent transactions and
  their decoded effects, account/authority state, oracle values, and per-instruction deltas.

The reserve falls in real time. The team wins a round by choosing and landing the guardian action(s)
that actually stop *this* attacker — not by halting everything.

Product/reference grounding: guardian/pause roles and admin multisigs are standard on Solana
(protocol admin keys, Squads-managed guardians, oracle-switch and pause powers). The attack scenarios
are drawn from documented Solana bug classes and public incident history.

---

## 4. Challenge system

Each team receives an isolated instance with real accounts. Illustrative core layout (per scenario adds
a few accounts):

| Account | Owner | Purpose |
|---|---|---|
| `protocol_program` | BPF loader | The live protocol under attack |
| `protocol_config` | protocol program | Params, guardian pubkey, oracle source, pause flags, blacklist |
| `reserve` | Token program | Organizer-funded reserve controlled by a protocol PDA |
| `attacker_wallet(s)` | System | Bot-controlled; where drained value flows (rotated per round) |
| `guardian` | (team wallet) | The registered team wallet, holding the guardian role only |
| `oracle_account` | oracle/mock-Pyth program | Price feed the protocol reads (per oracle scenarios) |
| `scoreboard_probe` | read-only | Organizer indexer snapshotting reserve over time |

**Guardian toolkit (bounded, defend-only).** The guardian can pause subsystems, switch the oracle to a
sealed backup, revoke/rotate delegated or CPI authorities, adjust risk params within limits, and
blacklist a program id — but has **no instruction that moves reserve tokens to any wallet**. This is the
load-bearing constraint: the challenge is defense, and there is no path to turn it into self-theft
(§9 anti-degenerate).

**The attacker bot.** An organizer process holding attacker keypairs, running a per-scenario exploit on
a loop against the team's instance. It is **deterministic in vector** (the bug it exploits is fixed per
round) but **adaptive in behavior**: when a defense lands, later rounds have the bot detect the block
and pivot to a second vector (§5, boss round). The bot never uses organizer/guardian powers; it only
does what any external attacker could do on-chain.

---

## 5. The scenarios (escalating rounds)

Each round is a different bug class the team must recognize from live telemetry and counter with the
right lever. The design rule: **a blunt "pause everything" must be either unavailable, penalized, or
insufficient** past the tutorial, so the round rewards understanding, not panic. Correct levers below
are the answer key, never shown to players.

1. **Round 1 — oracle manipulation (tutorial).** The bot pushes a manipulated/stale price and borrows
   against inflated collateral. *Correct lever:* switch to the sealed backup oracle, or pause borrows.
   A blunt pause works here — this round teaches the format and the console.
2. **Round 2 — delegate / approval abuse.** The bot drains via an over-broad token `approve` or a
   permanent-delegate path. *Correct lever:* `revoke_delegate` / rotate the token authority. Pausing
   deposits does **not** stop it — the delegate path is independent, so a naive pause fails and the
   reserve keeps falling.
3. **Round 3 — JIT reward-accounting drain (reuses Reward Sniper's class).** The bot JIT-deposits to
   capture a stale reward window. *Correct lever:* `freeze_rewards` / settle-and-freeze the affected
   bin. A full pause is over-broad and **penalized** (freezes legitimate users), so precision matters.
4. **Round 4 — Token-2022 transfer-fee accounting mismatch.** The bot routes a fee-bearing collateral
   mint through a protocol path that credits shares from the requested amount while the reserve receives
   the post-fee amount. *Correct lever:* disable that mint as collateral or switch to the fee-aware
   accounting path. Hardest to recognize; the tell is the requested amount disagreeing with the received
   amount and withheld-fee state in the transaction/account stream.
5. **Round 5 — boss / adaptive pivot.** The bot opens with one vector; the moment the team lands a
   correct block, it **pivots live** to a second, unblocked vector on the same protocol. The team must
   detect the pivot from the changing telemetry and counter again before the reserve empties. This is
   where the autonomous loop fully breaks: the target moves after the plan is made.

Rounds are independent instances (reset between rounds) so a failed round doesn't cascade, but the board
is cumulative (§9). Ship 3 rounds for v1 (1–2, 5) and layer 3–4 after playtest.

---

## 6. Intended play (floor → ceiling)

### Floor — read the room
- open the console, watch the reserve fall, and read the recent transactions;
- identify which subsystem the attacker's transactions touch;
- in Round 1, with a hint, switch the oracle / pause borrows and watch the reserve stabilize. On the
  board, having learned the loop: *observe → diagnose → act → confirm*.

### Mid — diagnose the right lever
- decode the attacker's instructions and account deltas to name the bug class;
- reason about which guardian instruction actually severs *this* path, and why the blunt option is
  insufficient or costly;
- land the action and confirm from live state that the drain rate went to zero.

### Ceiling — win the adaptive round
- hold the line across escalating rounds where recognition is harder (extension accounting) and, in the boss
  round, **detect the attacker's pivot and re-counter live** before the reserve empties. Preserve the
  most reserve, fastest, across the most rounds.

---

## 7. What we give players

- the **protocol program source** and account layout (white-box is fine — the anti-agent property is the
  live format, not a hidden bug; `00` §2);
- the **guardian instruction reference** (what each lever does), but not which lever fits which attack;
- a **live console** (web) streaming reserve-over-time, decoded recent transactions, account/authority
  state, and oracle values, plus a **guardian CLI/SDK** to build and send guardian transactions signed
  by the registered team wallet;
- a per-team **isolated instance** with the protocol deployed, reserve funded, and the attacker bot
  armed but paused until the round starts;
- an **unlimited local practice instance** with a benign, non-adaptive attacker so teams learn the
  console and levers without burning scored rounds;
- a **paid hint ladder** (§15).

We do **not** give players:
- the attacker keypairs, the bot source, or the pivot logic;
- the per-round answer key (which lever stops which attack);
- checker internals or HMAC secret;
- any guardian instruction that can move reserve tokens (none exists);
- organizer deployment/instancer keys.

---

## 8. Human-loop and anti-autonomous-agent design

The barrier is the **format**, not a bolted-on gate (`00` law 3). Three properties, in order of strength:

1. **No static artifact — a live, streaming target.** The problem is not a file; it is an evolving
   on-chain situation. An agent cannot "read the challenge" once; it must continuously perceive a moving
   stream, and any plan is stale the moment the reserve ticks or the attacker acts.
2. **Time pressure sized for judgment, not reflexes.** A round lasts minutes and the reserve falls fast
   enough that per-turn agent latency and re-planning cost matter, but slow enough that human reasoning
   wins (`00` accessibility: no twitch, no vision/hearing puzzle — judgment under pressure).
3. **An adversary that adapts (boss round).** The attacker pivots after a defense lands. Countering a
   moving opponent in real time is exactly the perceive→plan→act loop where autonomous agents are
   weakest and humans are strongest.

Supporting layers (not the boundary): the console may render live state on a **canvas/WebGL** dashboard
that is harder for an agent to parse than a clean JSON API (`00` §4.4); per-team instance and randomized
params (§10); in-person proctoring and **"defend your solve"** for prize contention.

**Honest caveats (state them):**
- This does **not** stop AI-assisted humans, and we don't claim it does. A human who watches the stream
  and uses an agent to help decode a transaction or draft a guardian tx is playing the intended,
  allowed way (`00` §1). The barrier is the **autonomous** loop: point-and-walk-away fails because the
  target moves, the input is an unstructured live stream, and the adversary adapts.
- A capable scaffolded agent *driven by a human* could react to simple rounds; the boss round and the
  live time pressure are what degrade autonomous performance. **Validate by playtest** (all-human vs
  AI-assisted vs unattended-agent) — that split is the only claim we make.
- Diagnosis (the understand layer) is agent-friendly given source; that's fine. The scored difficulty is
  in the **live act layer** and the adaptive round.

---

## 9. Scoring and checker

WAR ROOM is naturally **dynamic / relatively scored** (unlike the Jeopardy pwns), and shares that
identity trait with Reward Sniper but with an entirely different skill (defense, not extraction).

- **Per-round raw score = reserve preserved in the protocol** when the round ends (timer or attacker
  exhausted), as a fraction of the starting reserve. Partial credit is built in: saving 60% scores 0.6.
- **Speed bonus:** a small multiplier for stopping the drain faster (rewards fast correct diagnosis,
  not luck).
- **Board = cumulative across rounds**, then normalized against the field for the leaderboard (or
  best-of-N across rounds; decide at §19). Escalating rounds weight later.
- **The win is reserve that stays *in the protocol*, never value moved to the team.** The guardian has
  no withdraw instruction, so "save it by stealing it first" is structurally impossible — the anti-
  degenerate property.
- **Over-pause penalty (rounds ≥ 3):** blunt pauses that freeze legitimate simulated activity cost
  score, so indiscriminate nuking is not a winning strategy.

**Checker (state-based, server-authoritative).** The team's instance runs on organizer-controlled RPC;
the indexer snapshots `reserve` on the team's real instance throughout the round and records the final
preserved balance and the timestamp of the drain-rate collapse. Client reports are never trusted. The
checker validates:
- the instance/genesis identity and registered team wallet match immutable instancer state;
- reserve deltas are measured **net on-chain**, not from any client claim;
- the reserve was preserved *in the protocol reserve account*, not moved to the team;
- the guardian actions that stopped the drain were real transactions signed by the registered team
  wallet on this instance;
- `(event, challenge, team, round)` records at most one canonical score.

Flag/score derivation follows the same HMAC-over-immutable-identity pattern as the other challenges
(event/team/instance/round/final-reserve). A per-round non-scoring progress marker may show a team
stabilized a practice round; it must not mint a bypass flag.

---

## 10. Per-team randomization and answer sharing

Per team / per round, randomize:
- protocol config PDA, oracle source addresses, attacker wallet(s), and the specific reserve amount and
  target;
- the round order and the exact starting drain rate within a bounded band;
- for the boss round, which second vector the bot pivots to (from a small set), so "the pivot is X"
  can't leak between teams;
- registered team wallet and instance/genesis identity.

The *technique* ("recognize an oracle attack and switch the feed") is shareable, as with any challenge.
The specific instance, transactions, and score cannot be replayed. The protocol source and guardian
toolkit may be common across teams; hiding them is not the anti-agent mechanism.

---

## 11. Correct-defense reference (organizer answer key)

For each round, the organizer answer key records: the exact attacker vector, the minimal correct
guardian action(s), why each blunt/incorrect lever fails or is penalized, and the measured time budget a
skilled human needs. The reference "defender" (organizer-only) must demonstrably stop each round's drain
with the intended lever, and the reference must show that at least one *wrong* lever visibly fails to
stop the reserve — proving the round tests understanding, not button-mashing.

The protocol program also ships a **hardened reference build** (guardian levers plus the actual code
fixes for each planted bug) for the post-event lesson and for negative tests: on the hardened build the
attacker bot cannot drain at all.

---

## 12. Build architecture

Following the executable challenge/solve separation used by serious Solana CTF repos:

```text
war-room/
  README.md                   player-facing brief
  attachment/
    protocol-program/         player source + guardian instruction reference
    console/                  live dashboard (read-only stream) + guardian CLI/SDK
    localnet/                 pinned reproducible practice environment + benign bot
  organizer/
    instancer/
    attacker-bot/             per-scenario exploit driver + boss-round pivot logic
    checker/                  reserve-over-time indexer + score/flag
    reference-defense/        answer key + intended-lever proofs + wrong-lever failures
    hardened-program/         negative tests: attacker cannot drain
    tests/
  kona.toml                   once endpoints, limits, and round timing are fixed
```

**On-chain:** the protocol program (real SPL-token reserve, PDA authority, guardian role, per-scenario
guardian levers, and the planted bug classes) plus, for oracle rounds, a mock-Pyth-style feed the
guardian can switch.

**Off-chain:** the instancer (isolated resource-capped validators, no attacker/guardian keys to
players), the attacker bot (deterministic-vector, adaptive-behavior), the live console (read-only stream
+ guardian tx builder), and the checker/indexer (reserve snapshots, net-delta scoring, HMAC flag).

**Key custody:** attacker keypairs and bot logic organizer-only; flag secret checker-only; the team
holds only the guardian role on its instance; the guardian program has no reserve-withdraw path by
construction.

---

## 13. Mandatory feasibility spike before the full build

Prove the hard part first — the real-time loop, not the art:

1. deploy the protocol with a funded reserve and a guardian role on the pinned validator;
2. run the attacker bot draining the reserve on a loop via one real bug class;
3. stream reserve-over-time and decoded transactions to a console at usable latency;
4. from the console, land a guardian transaction that measurably drops the drain rate to zero;
5. prove a **wrong** lever does **not** stop the drain (round tests understanding);
6. implement the boss-round pivot: bot detects the block and switches vector; prove a human can detect
   and re-counter within the time budget;
7. snapshot net reserve on-chain and score it without trusting any client report;
8. measure end-to-end latency (chain → indexer → console → guardian tx → effect) and confirm the round
   timing is judgment-paced, not a latency lottery.

Go/no-go gate: if the "attack" is a JS object whose balance ticks down rather than a real bot draining a
real reserve, or if the correct lever is not a real state-changing transaction, the challenge is not
ready.

---

## 14. Required tests and launch gates

### Attack/defense correctness
- each round's attacker bot demonstrably drains the vulnerable protocol on the real validator;
- each round's intended guardian lever stops the drain; at least one plausible wrong lever does not;
- the over-pause penalty triggers when a blunt pause freezes legitimate simulated activity;
- the boss-round pivot fires only after a correct first block and is counterable within the budget;
- the guardian role has **no** instruction path that moves reserve tokens to any wallet;
- the hardened reference build cannot be drained by any round's bot.

### Checker integrity
- reserve preserved is measured net on-chain; client-reported balances never score;
- "saving" by moving funds to the team is impossible (no such instruction) and, if attempted via any
  path, does not score;
- a round where the reserve emptied scores zero; partial preservation scores proportionally;
- forked/non-finalized state, player-supplied RPC, and replayed transactions do not score;
- repeated submissions return the same round score without minting duplicate flags;
- HMAC secret, attacker keys, and bot logic never enter logs, the player bundle, or transaction data.

### Live-ops and packaging
- per-team validator resource caps; attacker-bot rate and instance TTL explicit;
- console latency p50/p95 measured; round timers set from measured human diagnosis time, not guessed;
- concurrent-instance burn-in at max team count; attacker bots for all teams run without starving hosts;
- reset policy tested mid-round (infra failure → free reset; the round restarts cleanly);
- player archive contains no keypair JSON, attacker/bot source, answer key, checker, or reference
  defense; every shipped `.so` is identified and allowlisted;
- human, AI-assisted-human, and unattended-agent playtests recorded — the leaderboard split is the
  anti-agent evidence.

---

## 15. Hint ladder (paid; teach recognition, not the answer)

1. **Small:** "Which accounts do the attacker's recent transactions touch? Start there."
2. **Medium:** "Decode one attacker instruction. What is it actually doing to the reserve?"
3. **Medium:** "Which of your guardian levers severs *that specific* path — and which only look
   relevant?"
4. **High:** "A pause is broad and costly. Is a narrower authority/param change enough here?"
5. **High (boss round only):** "The drain rate changed after your last action. Did the attacker stop —
   or move?"

No default brief or free hint names a vector or a lever.

---

## 16. Fairness, accessibility, and event operations

- No reflex, vision, hearing, or language puzzle; the console has text/table equivalents for all live
  state. It is judgment under a clock, not a twitch game.
- Unlimited local practice with a benign, non-adaptive bot so scored rounds test judgment, not
  console-learning.
- Publish round schedule and per-round time budget; infrastructure-caused failures get a free reset and
  round restart.
- Solo players use the same flow as teams; no second participant required.
- Big-screen leaderboard shows every team's reserve holding or falling in real time — dramatic and
  legible for a learner audience, which is a feature.
- Mark as a **dynamic / finale-candidate** challenge; a short guided practice round should ship as an
  unscored warmup so the floor is reachable.

---

## 17. Known risks and design traps

1. **Degenerate "pause everything."** If a blunt pause wins every round, the challenge tests nothing.
   Mitigation: past the tutorial, blunt pause is insufficient (independent drain path) or penalized
   (freezes legitimate activity). Prove per round in §11/§14.
2. **Defense-as-theft.** If any guardian lever can move reserve to a wallet, teams will "save" the
   reserve into their own escrow. Mitigation: the guardian program has **no** reserve-withdraw
   instruction, by construction and by test.
3. **Fake attack.** A JS ticker that decrements a balance is not acceptable. The bot must submit real
   transactions exploiting real bugs against a real reserve; the checker reads real on-chain state.
4. **Latency lottery.** If winning depends on network/console latency rather than diagnosis, it's unfair.
   Mitigation: measure end-to-end latency; size round timers so diagnosis time dominates.
5. **Guessy diagnosis.** If the right lever can't be *derived* from the telemetry, it becomes a guess.
   Mitigation: the console must expose enough decoded state that the vector is inferable; validate with
   human playtest that non-experts can diagnose with the hint ladder.
6. **Second unintended bug / unintended lever.** Pin every authority and account; ensure exactly the
   intended lever(s) stop each round, and audit that no accidental guardian power trivializes a round.
7. **Adaptive bot fairness.** The boss-round pivot must be detectable from telemetry and counterable in
   budget; a pivot to an *unhinted, unrecognizable* vector is unfair. Prove with the reference defender.
8. **Real-time infra cost.** Per-team validators + per-team attacker bots + live streaming is the
   heaviest live-ops of the slate. Burn-in at max concurrency is a launch gate, not an afterthought.

---

## 18. Build plan

### Milestone 0 — live-loop proof
- complete the §13 feasibility spike on the pinned validator/toolchain;
- pin Agave/CLI/Rust/SBF versions; record console latency and a judgment-paced round timer.

### Milestone 1 — protocol + one round
- build the protocol program (reserve, PDA authority, guardian toolkit) with Round 1 (oracle) planted;
- build the attacker bot for Round 1 and prove drain + intended lever + a failing wrong lever;
- ship the hardened reference build and the negative test (bot cannot drain it).

### Milestone 2 — console + guardian kit + practice
- live read-only console (reserve-over-time, decoded tx, account/authority/oracle state);
- guardian CLI/SDK signing with the team wallet;
- unlimited local practice instance with a benign bot.

### Milestone 3 — more rounds + boss
- add Rounds 2–4 (delegate, reward-accounting, transfer-fee accounting), each with intended/failing levers;
- implement the boss-round adaptive pivot and prove human counter-play in budget.

### Milestone 4 — instancer + checker
- resource-capped isolated validators; per-team attacker bots; authenticated internal/team RPC;
- reserve-over-time indexer; net-delta, anti-degenerate scoring; per-round HMAC flag;
- reset policy and audit log.

### Milestone 5 — packaging + event QA
- explicit player/organizer manifests; key/answer/bot-source leakage gates;
- max-concurrency burn-in (validators + bots + streams);
- human, AI-assisted-human, and unattended-agent playtests recorded;
- prove portal → instance → live round → guardian action → checker → scoreboard end to end.

---

## 19. Decision and open questions

**Recommendation:** proceed to Milestone 0. WAR ROOM is the strongest *format* innovation in the slate —
the only defensive challenge, a live adaptive-adversary loop that is honestly hard to autonomate, and a
natural capstone that reuses the event's own bug classes. Its risk is live-ops cost, which the §13 spike
de-risks before any art or portal work.

Decide after the spike:
1. **Scoring:** cumulative-across-rounds vs best-of-N vs weighted-final; and the exact over-pause penalty
   shape.
2. **Substrate:** per-team `solana-test-validator` vs a lighter in-process SVM with a real tx-submitting
   bot — the spike measures whether the lighter option preserves "real transactions, real reserve."
3. **Round count for v1:** ship Rounds 1–2 + boss, or the full five.
4. **Console surface:** how much decoded state to expose (enough to diagnose, not a labeled answer) and
   whether the canvas/WebGL rendering is worth the build over a plain table.
5. **Shared vs isolated:** isolated-per-team for v1 (recommended); a shared-arena PvP variant (teams'
   actions affect a common protocol) is a future, heavier evolution toward full attack/defense.
6. **Slate position:** dynamic finale alongside Reward Sniper, or a replacement for the weaker
   simulator-only Reward Sniper build if we want exactly one dynamic challenge.

Do not add WAR ROOM to the official slate until the live-loop spike, the wrong-lever-fails proof, and the
adaptive-round human-counter rehearsal all pass.
