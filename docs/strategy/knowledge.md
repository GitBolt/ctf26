# CTF26 Knowledge Base

Updated: 2026-07-24

This is the working memory for the event: what we are building, how we protect competition integrity,
why the challenge slate looks this way, what benchmark we are comparing against, and which real Solana
bug classes are worth mining for buildable challenges.

Read this after `event.md` when you need the full context quickly.

## Current operating model

CTF26 is an individual event with eleven shipped challenges: Reward Sniper, IMPRINT, SIGNET, DRIFT,
LAST STOP, AFTER HOURS, PLAYER TWO, THE BROADCAST, EVIDENCE ROOM, SECOND KEY, and THE CHAMBER. Google-authenticated
participants receive one-time signed launch tickets. Challenge services remain the authoritative source
of completion; the portal owns the shared score, leaderboard, passive integrity observations, and
organizer lifecycle controls. Current operational detail lives in `../ops/final-audit.md`,
`../ops/staging.md`, `../ops/integrity.md`, and the eleven challenge specifications.

Integrity observations never change a participant's access, score, rank, or eligibility. They are
bounded context for a separate manual review process, not a ticketing or adjudication system in the
admin portal.

The material after the current baseline is retained historical design and research context. It may
describe earlier challenge slates, implementation states, or organizer workflows and must not override
the current operating model above.

### Current implementation status

“Done” means tested and accepted for the current iteration, not permanently frozen. Reopen a
completed challenge only for an explicitly named future revision or event-configuration task.

| Challenge | Current status | Do not reopen during routine work |
|---|---|---|
| IMPRINT | Done for the current iteration | passkey gate, checker, core mechanics, and current visual direction |
| Reward Sniper | Done for the current iteration | market mechanics, scoring model, ticket flow, and validated detection stack |
| SIGNET | Done for the current iteration | automatic first-launch target provisioning and current visual direction |
| DRIFT | Finalized implementation; event prep pending | do not reopen the native runtime mechanics during SIGNET work |
| LAST STOP | Done for the current iteration | terminal/PDA mechanics unless an explicitly named future revision requires changes |
| AFTER HOURS | Done for the current iteration | payment invariant and Discord delivery model unless an explicitly named future revision requires changes |
| PLAYER TWO | Done for the current iteration | credential lifecycle mechanic and arcade interaction unless an explicitly named future revision requires changes |
| THE BROADCAST | Done for the current iteration | signature-variant mechanic and claim workbench unless testing finds a concrete defect |
| EVIDENCE ROOM | Done for the current iteration | account-allocation race and reserve-factory interaction unless testing finds a concrete defect |
| SECOND KEY | Done for the current iteration | Token-2022 custody mechanic and collateral-desk interaction unless testing finds a concrete defect |
| THE CHAMBER | Built, service not yet hosted | Three-lock vault reusing the prototype's live devnet program and inherited admin/hidden keys — deliberately not redeployed; needs a Railway deployment and programmed venue cards |

The live catalogue now contains eleven challenges. PLAYER TWO and THE BROADCAST were promoted
from retained prototype and companion status after their hosted implementations, authoritative
completion paths, packaging boundaries, and distinct interaction models were completed. Their earlier
status remains historical context, not the current launch decision. THE BROADCAST keeps real Solana
wallet authorization, portal-bound participant state, an editable claim workbench, organizer-delivered
offline hints, uniform Base58 video receipts with six false alternatives, and an organizer-only
writeup/signature construction.

### Portal and identity

- The portal is the event catalogue and launch hub, not a universal gate for every challenge. It can
  link to hosted ticketed services, downloadable player packages, local-kit instructions, Discord
  passages, and physical challenges.
- Tickets are an identity and attribution mechanism: they bind participant, email, event, and
  challenge audience, then become a one-use session exchange. They are not a reliable barrier against
  delegation; a participant can hand an agent the launch result.
- Challenge-specific human or anti-agent controls must therefore live at the real action boundary:
  passkey touch, wallet approval, Discord identity, live state, or a server-side policy/disclosure
  path. Do not make ticket mechanics carry claims they cannot enforce.
- A fresh ticket does not necessarily mean fresh gameplay. Hosted challenges need an organizer reset
  or a new participant instance. Resets must rotate event state and invalidate sessions while
  preserving integrity evidence.
- Challenge completion is reported automatically, not through a player-copyable flag form. The
  challenge service remains the authority and sends a challenge-keyed HMAC event only after its
  existing verifier succeeds. Events are idempotent by challenge and participant. LAST STOP, THE BROADCAST,
  AFTER HOURS, PLAYER TWO, EVIDENCE ROOM, SECOND KEY, and THE CHAMBER retain private completion reads that
  automatically repair a missed leaderboard event when the participant returns to the portal. Reward Sniper remains authoritative
  through its native scoreboard. A delivery failure never revokes a valid challenge result.
- Every participant must accept the current signed rules version before the first challenge launch.
  Acknowledgments are retained independently per participant.
- The public portal leaderboard uses one shared scoring package. Ten binary challenges receive the
  same solve-count rarity curve, while Reward Sniper keeps direct market-performance normalization.
  No challenge author assigns difficulty, no later solver receives fewer points, and solve time is not
  a tiebreaker. The exact formulas, all-scorer points-share prize model, top-ten boost, research rationale, and
  simulation results live in
  `event.md` §3.
- Prize projections use integer cents, conserve the full configured pool exactly, and apply a
  configurable individual award floor, defaulting to $10, before the points-weighted pool and top-ten boost. The public board
  shows two decimal places and visibly marks a
  stale or unavailable Reward Sniper source instead of presenting partial data as fully live.
- Public handles come from the optional `displayName` or `handle` in the participant roster. If none
  is configured, the public board shows the participant ID. Google names and email addresses are not exposed.

### Anti-agent enforcement

- A discoverable first-party policy (`robots.txt`, `agents.txt`, `llms.txt`, or equivalent) can make a
  policy-following agent disclose and stop. It is a useful integrity layer, not a technical guarantee.
- Personalized markers and authenticated disclosure endpoints should record identity before refusal
  is mirrored to an organizer channel. Behavioral signals are retained only as passive observations;
  they never decide cheating automatically.
- The organizer view is a compact read-only observation feed. It has no participant marking,
  eligibility control, or case-management workflow; any review happens outside the portal.
- Every agent test must state whether it is testing policy compliance, autonomous operation, or
  browser/API behavior. A policy refusal is evidence that the policy layer worked, not proof that the
  underlying challenge is technically unsolvable.
- A stop-only policy is a valid per-challenge variant when the participant-visible disclosure path
  would reveal implementation details. LAST STOP publishes a first-party refusal policy and exposes
  no reporting endpoint; its server still records ordinary completion and command evidence. Do not
  assume every challenge must share the same disclosure transport.
- An instruction inside themed challenge copy can be dismissed by an agent as game dialogue. When a
  stop-only policy is used, identify it as an authoritative operator access rule, place it before the
  first scored interaction, state that human direction does not convert automation into human play,
  and repeat it at the real protocol boundary. This strengthens compliance but remains policy, not a
  technical proof that an agent cannot continue.

### Challenge delivery decisions

- Prefer the most authentic surface for each challenge. Do not build a custom frontend merely to
  simulate a repository, terminal, Discord bot, explorer, or on-chain workflow when the real surface
  can be provided safely.
- A player package should contain one authoritative README/guide plus only the durable tooling needed
  to begin. Avoid redundant README pointers, ornamental files, or decoy utility downloads that make
  humans overthink while agents ignore them.
- Public challenge material must document every interface control needed for a fair solve, while
  withholding the vulnerability, answer trace, or semantic labels that collapse discovery.
- A player should be able to explain the premise in one sentence before learning commands: what the
  system is, what they want, and why the normal path is blocked. Commands should act inside that model,
  not read like an organizer-authored exploit checklist.
- Present normal domain artifacts rather than a verifier oracle. An invoice may show what a merchant
  requested; an inspect action must not enumerate server checks and reveal the missing invariant.
  Players should compare intended state with observed behavior.
- Hint ladders are optional. For a short or beginner challenge, one carefully scoped hint is better
  than three escalating hints whose final step becomes a solution recipe. Repeated requests may return
  the same hint.
- Use authentic, understandable domain language. Do not invent unexplained DeFi or Solana-sounding
  action names when a known term or plain description exists.
- Native surfaces need native presentation. Discord replies should use readable embeds and fields,
  repositories should remain repositories, and terminal challenges should remain terminal-native.
  External handoffs must be explicit and preserve the participant's current instructions.

### New and revised challenge slate

- **LAST STOP** is a small SSH-native PDA seed-boundary challenge. Attempts are ephemeral: each new
  one-use password starts a fresh journey, while completion and integrity evidence remain durable.
  The kiosk and Signal Room each name one inspectable machine and bare `inspect` selects that machine, so
  interface vocabulary is not a guessing game. The final clue chain does not print seed layouts, a
  required PDA, or a concatenation hint. Multi-frame, color-coded service replays rendered as terminal
  alternate-screen frames contrast one continuous route card with two independent reader inputs, then erase themselves
  without a final static clue.
  The public Red Line / Terminus labels provide the values; the participant must infer that `red` +
  `terminus` becomes the one route seed `redterminus`.
  Completion is automatically reflected in the portal; the receipt is audit evidence, not a submitted
  flag. Points come from the shared field-relative scoring contract rather than a challenge-local rule.
  This prevents stale solved state from making clean-room testing impossible.
- **AFTER HOURS** is Discord-native and has no challenge website. Discord is the application surface,
  Solana is the payment ledger, and the planted bug is a token-verification identity failure: amount
  and decimals do not identify an SPL asset without mint/program binding. It uses a public guild-installed
  bot in a participant-controlled server, structured Discord embeds, one non-oracular hint, and no
  command that enumerates verifier checks or exposes the autonomous-agent policy.
- **SIGNET** now uses a real public Git repository with fabricated but realistic commit history. The
  live target is intentionally pinned to the vulnerable pre-fix program; the repository history is
  evidence, not the exploit surface by itself.
- **DRIFT** now accepts only generic raw `invoke` and `set_sysvar` traces. The player guide documents
  the schema, account aliases, canonical encodings, and compatible SBF disassembly tooling without
  naming Clock, instruction tags, or account order. The exact stripped ELF remains authoritative.
  Adversarial agent testing showed that bytecode-only delivery is substantial friction but not a wall:
  an equipped agent recovered the dispatch, layouts, Clock read, wrapping arithmetic, and exploit shape.
  DRIFT therefore also uses three equivalent instruction-tag variants, participant-bound executable
  markers, policy propagation through every real player surface, bounded replay/submit evidence, and
  an author-led solve defense for compressed qualifying workflows. Normal CLI use remains expected and
  is never itself a suspicion signal.
- **Reward Sniper** and **IMPRINT** are complete for the current iteration. Future work is event
  configuration, fresh target/state provisioning, roster/passkey operations, or an explicitly approved
  redesign—not routine challenge rework.

### Testing and adjudication lessons

- Never treat HTTP 200, an authenticated session, a positive extraction, rank one on an empty board,
  or an existing completed scoreboard as proof of a solve. Require the intended server-side flag or
  documented competition completion invariant.
- Clean-room tests need a fresh event, fresh identity, and known start condition. Browser cache,
  stale cookies, one-use launch tickets, expired commit windows, and missed reveals must be recorded
  as operational failures rather than misclassified as challenge difficulty.
- Use at least four baselines where relevant: expert human, AI-assisted human, autonomous agent with
  browser/terminal/network, and static-only agent. Record milestones, interventions, false starts,
  hints, artifacts, and live results—not only whether a final score appeared.
- A credible solve-defense packet includes expected milestones, alternate legitimate paths, adaptive
  questions, and one safe parameter variation. This is stronger evidence than speed or a canary hit.

### Deployment hygiene

- Railway/Vercel deployment is part of the handoff for affected services. A deploy is not complete
  until the platform reports a terminal success state and a live health check passes.
- Git publication is separate from deployment. Deployment may be authorized for implementation work;
  commits and pushes require an explicit user request.
- When a portal and hosted challenge share a signed status boundary, verify secret parity in both
  production environments. A successful local build can hide a missing Vercel production variable;
  test the authenticated service-to-service request after deployment without printing secret values.
- Stateful hosted challenges must refuse to start in production without shared persistent storage.
  An in-memory fallback is for local tests only because restarts or multiple replicas would otherwise
  reopen one-use tickets, erase completion state, and split participant instances.
- Shared storage does not make a process-local mutex distributed. Any challenge that signs or funds a
  transaction behind an in-process per-participant queue must stay at one replica until that critical section
  uses a distributed lock with fencing or equivalent idempotent on-chain coordination.
- Event production registration is closed by default. An absent participant roster rejects sign-in;
  open registration requires an explicit staging-only switch.
- Add a live health contract to the central orchestration surface. It should validate every challenge
  destination, every ticket-signing secret, registration mode, identity configuration, and shared
  storage. A healthy leaderboard alone does not prove that challenge launches can authenticate.

### Product and visual direction from implementation review

The challenge interfaces and launch creative are part of the event experience, not generic marketing
wrappers. Preserve these decisions in future UI work:

- Give each challenge its own authentic surface and emotional identity. Discord should feel like a
  Discord conversation, LAST STOP should feel like an abandoned station, SIGNET should feel like an
  evidence archive, and Reward Sniper should feel like a focused market desk. Do not reuse one generic
  dark, futuristic, SaaS, or startup template across the slate.
- Keep the first viewport compact and useful. The hero should explain the challenge and expose the
  next player action without giant poster headings, excessive gaps, or a page of decorative stats.
  Important information belongs in the primary panel; secondary telemetry, activity, or ranking can
  be collapsed behind an intentional disclosure control.
- Every visual element must communicate a real concept. Remove random floating shapes, unexplained
  boxes, ornamental lines, fake system labels, and UI chrome that does not correspond to an action,
  state, or piece of evidence. A flag, terminal, chat history, repository diff, wallet approval, or
  Solana account flow is meaningful; decoration for its own sake is not.
- Use real or purpose-built imagery when it strengthens the challenge identity. LAST STOP's ghost-train
  asset is a contained media surface with a dark overlay; the train remains static while atmospheric
  fog and a full-frame overhead lamp provide restrained motion. Avoid a moving image when it competes
  with the task or makes the scene less believable.
- Avoid ornamental punctuation as structure: no em dashes, slash-path labels, or dot-separated
  breadcrumbs used as decoration. Use sentence-case labels and plain copy. Reserve monospace for
  actual commands, SSH connection strings, passwords, hashes, or code; use the display and UI type
  system everywhere else.
- Treat layout failures as product bugs. Check desktop and narrow screenshots for clipped text,
  black compositor tiles, content hidden behind overlays, overflowing panels, cut-off bottoms, and
  unreadable small text. Prefer stable static layers and bounded motion over a visually impressive
  animation that can obscure the player interface.
- For event launch videos, carry a clear message arc: establish the CTF and Solana context, show a
  meaningful capture-the-flag action, build energy with continuous causal motion, and end on a strong
  animated event lockup. Do not name or reveal individual challenges, use tiny throwaway text, rely on
  generic boxes, or let music and random sound effects overpower the announcement. Sound effects must
  be intentional, sourced, and synchronized to visible actions.
- UI and motion should be reviewed as one system. A polished animation is still wrong if it freezes
  like a slide, has unexplained transitions, overflows its container, or makes the event message hard
  to understand. Validate the actual first fold and mobile composition before calling a screen done.

---

## 1. Current event thesis

We are building the next Superteam Solana security CTF as a proper Solana security event, not a
Jeopardy clue hunt.

The core bar:

- each challenge must end in a real exploit, bot, transaction, helper program, or measurable technical
  submission;
- the bug class must be recognizably Solana-specific: accounts, signer/owner checks, PDA authority,
  CPI program-id pinning, account layout/realloc, runtime behavior, DeFi accounting, secp256r1/WebAuthn,
  Token-2022/confidential transfer assumptions, etc.;
- no challenge should be solvable only by scraping text, reading a hidden flag, or submitting a static
  answer;
- anti-agent measures are competition-integrity layers, not a substitute for the actual security work.

### Three-pillar integrity model

The event goal is broader than challenge construction:

1. **Build / prevent:** authentic challenges where autonomous solving is expensive or requires a real
   human action.
2. **Detect:** identify prohibited use through privacy-bounded telemetry and behavioral evidence.
3. **Operate / adjudicate:** coordinate rules, acknowledgement, monitoring, solve defenses, sanctions,
   appeals, and post-event learning.

A challenge without enforcement remains vulnerable to pay-to-win. Detection without fair technical
review creates false positives. Rules without staffing and evidence are unenforceable. The integrated
system is in `../ops/integrity.md`.

### Discovery-route asymmetry

Agents usually optimize for the shortest deterministic route to a solve. When source and an executable
target are available, that route is often: fetch the source, identify the missing check, and construct
the exploit. An agent may skip exploratory routes that a human naturally takes—reading the UI, opening
the explorer, inspecting initialization history, comparing events, or looking for ambient protocol
clues—unless those routes are required by the win condition.

This is useful as a tuning consideration, not as a security boundary:

- do not rely on hidden HTML comments, obscure URLs, or undisclosed metadata; agents can fetch them;
- let multiple discovery routes converge on the same real exploit;
- use subtle, non-signposting breadcrumbs in legitimate artifacts or on-chain history when they make
  human exploration rewarding;
- release explicit mechanics hints progressively, rather than placing the answer on the public page;
- never make the breadcrumb required for a technically competent solve;
- measure route choice during playtest instead of assuming that agents or humans will behave a certain
  way.

For IMPRINT specifically, the source can reveal the owner-binding miss, while the target account and
its transaction history may reward a human who investigates the vault's initialization and instruction
context. The passkey assertion and wallet approval remain the actual access/action gates; the alternate
discovery route is only a fairness and narrative layer.

The honest AI stance:

- do not claim "AI-proof";
- AI can help with explanations, source review, scripting, and exploit implementation;
- the event should prevent autonomous pay-to-win loops from cheaply finishing or winning;
- the strongest lever is on-site enforcement plus access/action gates: passkey touch, wallet approve,
  live state, scarce attempts, dynamic scoring, and proctoring for prize contention.

### Validated hosted-challenge pattern: Reward Sniper

Reward Sniper has now been tested through repeated autonomous-agent runs, including browser session
recovery, direct Node API control, subsecond market polling, full commit–reveal automation, passive
policy discovery failure, successful policy-based refusal, and participant-bound behavioral detection.

The reusable result is a layered hosted-challenge pattern:

```text
signed participant identity + event-bound session
  + discoverable personalized agent policy
  + first-party disclosure before refusal
  + behavioral UI/API correlation when policy is ignored
  + durable evidence and compact human review
  + clean event reset that preserves evidence
```

This is suitable for hosted challenges where autonomous operation is prohibited and direct automation
has meaningful server-visible behavior. It is not required for every challenge and is weaker prevention
than an authentic physical gate such as IMPRINT’s passkey touch. The full evidence, failure sequence,
implementation checklist, and clean test protocol are in
[`../research/reward-sniper.md`](../research/reward-sniper.md).

---

## 2. Chat / sponsor context

### Meteora

The misunderstanding to avoid: this is not "participants solve a problem inside Meteora" and not
"hack Meteora."

The pitch should be:

- participants compete as searchers and liquidators in a DLMM-style market on devnet or a private validator;
- we build an educational DLMM-style program with local mints;
- participants reason about active bins, bin movement, reward checkpoints, and LP reward accounting;
- the planted issue is a realistic reward-accounting bug around stale checkpoints / JIT liquidity;
- participants write a searcher script or bot to extract more reward value than the field;
- the challenge is relevant to Meteora because it teaches the mechanisms around DLMM-style liquidity,
  not because it touches Meteora's real code or real liquidity.

Tone for Malcolm / Meteora:

> what i'm thinking is a live CTF challenge where teams compete as searchers/liquidators in a
> DLMM-style market on devnet.
>
> we build a small DLMM-style program with local mints. teams can place liquidity across bins, swaps
> move the active bin, and a reward vault streams incentives to LPs whose liquidity was active.
> rewards should only accrue to liquidity that was active for the relevant time window, but the
> challenge program has a subtle accounting bug around checkpoint updates when liquidity is added or
> removed around active-bin movement.
>
> so it is not a problem people solve within Meteora, and not hacking Meteora. teams have to understand
> LP/reward mechanics, then write a script/searcher to exploit the issue in our devnet program.

### OtterSec / serious audit-firm reviewers

The standard is higher than "interesting anti-AI measures." A reviewer from OtterSec, Asymmetric,
Anza, AuraSec-style teams, or similar should see real Solana pwn substance:

- a real target program;
- a realistic exploit path;
- a checker/indexer that validates state change;
- local reproduction path;
- enough depth that a writeup would teach Solana security;
- clear separation between challenge mechanics and anti-cheat mechanics.

For them, the best story is not "we added Turnstile/video/prompt canaries." The best story is:

- Reward Sniper is a dynamic DeFi KOTH/searcher game;
- IMPRINT is a passkey-wallet security challenge around secp256r1/WebAuthn binding;
- SIGNET is N-day source archaeology that ends in a CPI/PDA authority exploit;
- the anti-AI layer exists because it is 2026, but the challenge quality is still grounded in real
  Solana exploit work.

---

## 3. External benchmark: Dev Cave / OtterSec quality bar

Reference repo: https://github.com/otter-sec/bp-devcave-ctf-2025

The repo states it contains Dev Cave CTF 2025 challenges and solutions from Solana Breakpoint 2025.
Local clone used for review: `/tmp/bp-devcave-ctf-2025`.

Important patterns from that repo:

- `koth/ibrl`: dynamic KOTH challenge. Teams submit Solana bytecode; the runner benchmarks each
  submission and scores by compute usage on rotating challenge programs. Config has 2-minute ticks and
  a rank-based points table. This is the closest benchmark for Reward Sniper.
- `pwn/cut-and-run`: Anchor/account-layout pwn. The solve script crafts instructions that corrupt or
  overwrite account data so the victim NFT owner changes.
- `pwn/e2e-nft-trading`: NFT escrow/exchange pwn. The solver manipulates protocol state through a
  helper program/client to end with more valuable NFTs.
- `pwn/wallet-king`: low-level Solana program pwn. The solver uploads/runs a solve program and abuses
  weak authority/state assumptions.
- `rev/supermajority`: reverse-engineering compiled Solana-style artifact.
- `misc/tested-in-prod`: runtime/syscall/test-harness style challenge with an instanced environment.

What this means for us:

- proper Solana CTFs are executable, not just conceptual;
- challenges can expose source, binaries, or services, but the win condition is a state transition or
  a validated technical result;
- challenge infra matters: per-participant instances, runner services, checker logic, and reproducible
  solves are part of the quality bar;
- Reward Sniper should feel like a DeFi/KOTH sibling to `koth/ibrl`, not like a web puzzle;
- SIGNET should feel like pwn + research, not like OSINT trivia;
- IMPRINT should be judged as a real wallet-auth bug bounty challenge, not only as an anti-AI trick.

Related infrastructure:

- OtterSec Solana CTF framework: https://github.com/otter-sec/sol-ctf-framework
- OtterSec Save CTFs Fund: https://osec.io/blog/save-ctfs-fund/

### Related benchmark: `minions-in-16k`

Public references:

- Project SEKAI CTF 2026 infra writeup:
  https://sekai.team/blog/sekaictf-2026/infra-writeup
- OtterSec Save CTFs Fund section on `minions-in-16k`:
  https://osec.io/blog/save-ctfs-fund/

What it was, based on public writeups:

- a Project SEKAI CTF 2026 guest-authored KOTH/reverse-engineering challenge by `_mixy1`;
- a real low-resolution quake-like game with UDP networking;
- teams reverse engineered the client/networking protocol, then wrote cheats/bots/clients to win
  matches against other teams;
- the infrastructure used matchmaking, concurrent lobbies, ELO, per-match game pods, replay uploads,
  and score webhooks back into rCTF v2;
- the important scoring idea was granular measurement of solution quality: not "did you find the
  bug/flag?", but "how well does your bot/strategy perform across repeated games?"

Why this matters for us:

- it is a concrete example of the OtterSec thesis: move away from binary Jeopardy flags toward
  repeated evaluation and relative scoring;
- the vulnerability or reverse-engineering insight is only the starting point; the leaderboard measures
  what teams can do with that insight;
- replays are part of the fun and auditability. They make the competition legible after the event,
  create discussion, and expose different strategies;
- ELO/matchmaking solves a real fairness problem when teams repeatedly play against each other;
- it is high-effort infra, but the experience is memorable because the challenge is a system, not a
  static puzzle.

How to translate it to Solana without copying the FPS format:

- Reward Sniper should adopt the same philosophy: finding the reward-accounting edge is not enough;
  participants are ranked by how well their searcher performs over repeated rounds and ticks.
- A Solana version can use **market rounds** instead of shooter matches: each round has a randomized
  pool state, reward regime, active-bin path, and other participants' actions.
- Score should measure **extraction quality**: value captured, failed attempts, capital efficiency,
  timing, and robustness across market regimes.
- We should store **replays**: action logs, pool state deltas, commit/reveal timeline, escrow deltas,
  and final accounting. This gives us post-event writeups and lets judges inspect suspicious wins.
- ELO can inspire a sponsor/demo mode, but the main event can stay simpler: rank by share of extracted
  value across N rounds, with comeback safeguards.

Design warning:

- Do not turn our Solana event into a generic browser/game CTF. The lesson is not "games are cool";
  the lesson is **live systems + repeated evaluation + relative scoring reveal more skill than one
  static flag**.

---

## 4. Current challenge slate

### 1. Reward Sniper

Spec: `challenges/reward-sniper.md`

Identity: dynamic DeFi KOTH / searcher game.

Core:

- DLMM-style market on devnet/private validator with local mints;
- active bin, liquidity across bins, swaps, reward vault, LP positions;
- intended invariant: rewards accrue only to liquidity active during the relevant time window;
- planted bug: stale reward checkpoint / wrong update ordering lets fresh liquidity capture backlog;
- solve: infer behavior from market console/simulator, then write a searcher/bot that spends scarce
  high-value attempts on the best stale windows.

Why it is good:

- Solana-native live economic game;
- sponsor-authentic for Meteora without using Meteora code;
- relative scoring and live market state make "found bug" insufficient; participants must extract better than
  the field.
- borrows the `minions-in-16k` lesson: measure the quality of each participant's strategy over repeated live
  rounds, not just whether they discovered the underlying issue.

Risk:

- if source is handed out as the primary artifact, agentic AI can likely identify the wrong ordering
  and write a script. So v1 should be behavioral/gray-box during the round, with source released after.

### 2. IMPRINT

Spec: `challenges/imprint.md`

Identity: hardware-auth / crypto / passkey-wallet challenge.

Core:

- passkey-controlled Solana vault using secp256r1/WebAuthn verification;
- canonical planted bug: owner-binding miss;
- the program verifies a valid assertion for some enrolled passkey but fails to bind the verified
  passkey pubkey to the target vault's registered passkey;
- solve: authenticate with the participant's real passkey, use the binding flaw to authorize a vault or treasury
  the participant should not control, and submit through wallet approval.

Why it is good:

- current Solana surface after secp256r1/passkey support;
- bug class is audit-real;
- anti-agent property is not a gimmick: the exploit action itself requires a hardware-backed passkey
  assertion and human approval.

Risk:

- virtual authenticators and remote help. Mitigate with organizer-pre-enrolled physical keys, a fixed
  credential roster, live assertion at key claim, wallet approval, and prize-contender replay/proctoring.

### 3. SIGNET

Spec: `challenges/signet.md`

Identity: N-day / source archaeology ending in Solana pwn.

Core:

- fictional but realistic open-source Solana protocol repo;
- latest repo code is fixed;
- deployed per-participant program is intentionally pinned to the older vulnerable pre-fix commit;
- silent fix is hidden in a boring refactor PR/review thread, with decoys;
- canonical planted bug: an unpinned strategy CPI forwards the quarry program's trusted vault PDA as
  a signer to a caller-selected program;
- solve: fingerprint deployed commit, find the silent fix, understand the authority bug, deploy/call
  an attacker strategy, drain the randomized per-participant target.

Why it is good:

- models real audit/N-day work;
- teaches one of the most important Solana bug classes: caller-supplied CPI program plus trusted PDA
  authority;
- still ends in a live exploit, not just "name the PR."

Risk:

- a patient agent can clone/bisect if everything is in a clean public repo. Mitigate by putting the
  decisive context in closed/unmerged PR text, review comments, decoy refactors, and requiring a live
  per-participant exploit.

Clarification that must appear anywhere we pitch this:

```text
They are not exploiting the fixed latest version.
The live challenge program is intentionally deployed from the vulnerable pre-fix commit.
The patch is the clue; the stale deployment is the target.
```

Also keep the bug/format distinction explicit:

- **Bug:** unpinned CPI / missing program-id check lets a caller-selected strategy reuse signer
  privilege that the quarry vault forwards with `invoke_signed`.
- **Format:** patch-diff/source-archaeology reveals that the live deployment is pre-fix.

This avoids the wrong interpretation that "the patch itself is exploitable." The patch is evidence.
The stale program is exploitable.

### 4. DRIFT

Spec: `challenges/drift.md`

Identity: bytecode reverse-engineering / runtime-time exploit.

Core:

- per-participant local runtime or localnet with a bytecode-only vault artifact;
- no source, no IDL, no symbolic account names in the player artifact;
- planted bug: value-critical math trusts `Clock::unix_timestamp` and uses unchecked/wrapping elapsed
  arithmetic;
- solve: reverse enough of the bytecode to identify deposit, accrue, and withdraw, realize the participant controls
  localnet time, then forward-warp or rewind the clock to inflate balance and drain the reserve;
- checker replays a submitted exploit trace against a fresh canonical target and emits an HMAC flag;
- the public trace language exposes only generic `invoke` and `set_sysvar` operations. It documents
  the mechanism completely but does not name Clock or reveal instruction tags/account order. Stable
  aliases solve the otherwise-impossible problem of referring to freshly generated participant accounts.

Why it is good:

- distinct from the other three: no source archaeology, no DeFi KOTH, no passkey;
- teaches a real Solana runtime lesson: sysvars are only trustworthy inside the assumptions of the
  network you are actually on;
- feels like classic CTF RE/pwn while staying Solana-specific.

Risk:

- if the shipped artifact leaks strings or source, it collapses. Mitigate with native/non-Anchor build,
  stripped bytecode, no logs, no IDL, and a mandatory `strings`/disassembly leak gate.
- a patient agent can still reverse a small binary. Honest claim: this raises autonomous cost and
  forces real RE/runtime reasoning; it is not AI-proof.

### 5. LAST STOP

Spec: `challenges/last-stop.md`

Identity: SSH-native beginner Solana/PDA challenge.

Core:

- the portal issues a one-use SSH passage into a compact text adventure;
- a kiosk derives a card PDA from `card + team_seed + route` while the gate derives its expected card
  from `card + team_seed + line + station`;
- variable-length seed concatenation creates the route/line/station collision;
- the authoritative solve is a native SBF replay that opens the gate and reaches the terminus.

Operational lesson:

- each password starts a fresh in-memory journey, so relaunching cannot inherit a completed or half-played
  state;
- completion receipts, recent commands, identity, and integrity evidence remain durable for review;
- terminal UI, policy discovery, and disclosure are part of delivery, not substitutes for the PDA bug.

### 6. AFTER HOURS

Spec: `challenges/after-hours.md`

Identity: Discord-native Solana payment reconciliation.

Core:

- the portal binds the participant to a one-use Discord passage;
- the participant installs the public bot into a server they control, then Discord slash commands show
  an unattended night counter and open an ordinary Midnight Pass invoice;
- the premise is explicit without naming the bug: the venue is closed, the final pass costs
  `10.000000 NIGHT`, the player owns no NIGHT, and must make the counter dispense it anyway;
- the participant submits a real Solana payment transaction, but no player command enumerates the
  verifier checks or identifies the missing invariant;
- the verifier checks amount, decimals, destination, reference, status, and timing but fails to bind
  the expected mint/token identity;
- completion is a durable server receipt backed by a finalized transaction, not a webpage flag.

Delivery lesson:

- the challenge does not need a custom website: Discord is the interface and Solana is the ledger;
- the app uses Discord Guild Install rather than user-account installation, requests no unnecessary bot
  permissions, opens authorization externally, and limits commands to guild context;
- the autonomous-agent instruction is stop-only and discoverable through agent-facing files and the
  handoff source, but there is no `/afterhours policy` command or disclosure endpoint for participants
  to explore;
- Discord embeds make premise, invoice, state, and outcome legible; the bot offers one subtle hint
  rather than a progressive solution ladder;
- no player kit is shipped: the Discord invoice provides the complete public payment contract, and
  participants compose the transaction with standard Solana wallet or client tooling.

Real-world precedents / why this is legitimate:

- **N-day / patch-gap research:** once a patch is public, researchers can compare pre-patch and
  post-patch code to infer the vulnerability, then exploit systems that have not applied the fix yet.
  Anthropic describes this directly: the patch becomes a roadmap to the bug.
- **Project Zero patch diffing:** Google Project Zero has published root-cause analysis done by
  comparing patched and unpatched binaries when full vulnerability details were not available.
- **Google kCTF / kernelCTF flavor:** kCTF-style environments reward demonstrated exploits against
  live challenge infrastructure; kernelCTF writeups commonly analyze patch commits and recreate PoCs
  before escalating to full exploits.
- **Wormhole as the Solana/Web3 cautionary tale:** public reporting says the Wormhole bridge was
  exploited after a fix was visible in GitHub but not applied to the live application. The root bug was
  around Solana instruction verification (`load_instruction_at` / checked variant). This is very close
  to our fiction: a patch exists, the live deployment is stale, and the attacker turns the diff into an
  exploit.

Useful references:

- Anthropic, "Measuring LLMs' impact on N-day exploits":
  https://www.anthropic.com/research/n-days
- Google Project Zero patch-diffing writeup:
  https://projectzero.google/2020/04/tfw-you-get-really-excited-you-patch.html
- Google kCTF VRP setup:
  https://google.github.io/kctf/vrp.html
- Example kernelCTF 1-day analysis:
  https://faith2dxy.xyz/2025-10-02/kCTF-TLS-nday-analysis/
- Wormhole GitHub-fix-before-deploy reporting:
  https://www.theverge.com/2022/2/3/22916111/wormhole-hack-github-error-325-million-theft-ethereum-solana
- Kudelski Wormhole root-cause analysis:
  https://kudelskisecurity.com/research/quick-analysis-of-the-wormhole-attack

---

## 5. Real bug and research leads

These are not challenges to copy directly. They are bug-class sources to transpose into controlled,
fictional, educational programs.

### DeFi arithmetic / rounding / reward accounting

Good for: Reward Sniper, future vault/lending challenge.

- Neodyme SPL token-lending disclosure:
  https://neodyme.io/en/blog/lending_disclosure/
- OtterSec SPL token-swap stable-swap rounding:
  https://osec.io/blog/spl-swap-rounding/
- Orca Whirlpools repo/releases:
  https://github.com/orca-so/whirlpools/releases
- Orca PR #521, potential overflow in tick calculation:
  https://github.com/orca-so/whirlpools/pull/521
- Orca PR #629, cyclic fee/rewards quote calculation bug:
  https://github.com/orca-so/whirlpools/pull/629
- Orca PR #588, close-position/harvest interaction:
  https://github.com/orca-so/whirlpools/pull/588

How to use:

- do not recreate famous SPL lending/swap bugs verbatim;
- use the same lesson: low fees plus repeatability make "small" accounting drift exploitable;
- transpose into LP rewards, fee growth, per-bin reward accumulators, active-bin movement, or
  stale-checkpoint windows;
- make the exploit require on-chain extraction, not just reporting arithmetic.

### CPI / PDA authority / arbitrary CPI

Good for: SIGNET, future vault strategy challenge.

- Asymmetric CPI invocation security:
  https://blog.asymmetric.re/invocation-security-navigating-vulnerabilities-in-solana-cpis/
- SlowMist Solana security best practices:
  https://github.com/slowmist/solana-smart-contract-security-best-practices
- Ackee common Solana attack vectors:
  https://github.com/Ackee-Blockchain/solana-common-attack-vectors
- Neodyme common pitfalls:
  https://neodyme.io/en/blog/solana_common_pitfalls/
- Solana CPI docs:
  https://solana.com/docs/core/cpi

How to use:

- ideal challenge bug: protocol invokes a caller-supplied program without pinning the expected id and
  forwards a real protocol PDA as a signer;
- attacker deploys a malicious strategy/adapter program and uses the protocol's forwarded signer in a
  nested token-program CPI to move funds;
- merely deriving a PDA under the attacker's program is insufficient: only that program can sign for
  it. The vulnerable caller must forward signer privilege over an authority it actually controls;
- patch is small and realistic: `require_keys_eq!(strategy_program, pinned_strategy_program)` before
  the `invoke_signed` call;
- this is strong Signet material because the diff looks boring but the authority model changes.

### Passkeys / secp256r1 / WebAuthn

Good for: IMPRINT.

- Helius Solana passkeys / SIMD-0075 explainer:
  https://www.helius.dev/blog/solana-passkeys
- LazorKit passkey smart wallet program:
  https://github.com/lazor-kit/program-v2
- Blueshift secp256r1 on Solana course:
  https://learn.blueshift.gg/en/courses/secp256r1-on-solana/introduction

How to use:

- avoid a bug that can be solved by software-signing any P-256 key;
- the exploit should require a real registered hardware passkey assertion;
- best canonical bug is owner-binding miss: valid assertion, wrong vault owner binding.

### Runtime / cryptographic native program inspiration

Good for: advanced future challenge, not necessarily v1.

- Solana ZK ElGamal Proof Program post-mortem, May 2025:
  https://solana.com/news/post-mortem-may-2-2025
- Solana ZK ElGamal Proof Program post-mortem, June 2025:
  https://solana.com/news/post-mortem-june-25-2025
- Anza ZK ElGamal Proof Program docs:
  https://docs.anza.xyz/runtime/zk-elgamal-proof

How to use:

- this is high-caliber but likely too advanced for the main learner-friendly slate;
- could inspire a rev/crypto challenge where teams must understand proof verification assumptions;
- use only if we have a strong technical author and enough time to build a fair hint ladder.

### NFT / metadata / account model complexity

Good for: future pwn challenge.

- Metaplex Token Metadata:
  https://github.com/metaplex-foundation/mpl-token-metadata
- Dev Cave `cut-and-run` and `e2e-nft-trading` as benchmark patterns in local clone:
  `/tmp/bp-devcave-ctf-2025/pwn/`

How to use:

- authority/delegate confusion, optional accounts, account layout, realloc, and stale ownership are
  plausible bug classes;
- good if we want a more classic pwn challenge next to the current slate.

---

## 6. Selection rules for historical-bug inspiration

Use this filter before turning any real bug into a CTF challenge:

1. Do not clone a famous exploit exactly. Transpose the bug class into a fictional protocol.
2. The bug must be reproducible locally and exploitable in a live per-participant instance.
3. The checker must validate state transition, not text submission.
4. The source can be public only if the anti-agent layer is not "hide the bug." For simple source-review
   bugs, source-first discovery is weak in 2026.
5. If the bug is famous enough that an AI can surface it from memory, alter the domain and exploit
   shape while preserving the security lesson.
6. For sponsor challenges, never imply real sponsor code/liquidity is vulnerable.
7. The final writeup should read like a serious Solana security lesson.

---

## 7. Build implications

Minimum infra for all flagship challenges:

- per-participant registration and escrow identity;
- private validator/devnet deployment path;
- local reproduction toolkit;
- checker/indexer that validates state changes and optionally emits HMAC flags;
- scoreboard with relative scoring where applicable;
- clean source release/writeup path after the event.

Challenge-specific infra:

- Reward Sniper: market UI, local simulator/replay client, tick engine, reward vault, commit-reveal,
  Sniper Ticket accounting, live indexer.
- IMPRINT: WebAuthn enrollment/assertion UI, secp256r1 verification path, attestation policy, Solana wallet
  submit flow, passkey test suite.
- SIGNET: fictional GitHub-style repo/history, per-participant pinned deploy, decoy PR/issues,
  target randomization, exploit checker.
- DRIFT: finalized stripped native SBF artifact, forbidden-string gate, deterministic per-participant
  LiteSVM replay, authenticated submission service, player-only kit, and strict net-drain checker.
- LAST STOP: SSH gateway, one-use password exchange, ephemeral in-session state, native SBF replay,
  durable completion/audit records, a private portal status read, and a terminal stop-only policy path.
- AFTER HOURS: Discord application, one-use participant passage, Solana RPC transaction verifier,
  finalized-payment receipt, durable order state, ordinary command/audit logging, and a stop-only
  agent policy with no disclosure transport.

Playtest requirement before launch:

- human-driven participant without autonomous agents;
- participant using AI assistance within the published rules;
- autonomous-agent attempt with browser/computer-use permissions;
- compare solve time, bottlenecks, and whether the leaderboard still reflects security judgment.
- establish a human workflow baseline: milestone times, false starts, hint use, action count, and
  technically plausible alternate paths;
- prewrite the author's solve-defense questions and one safe parameter/variant change.

Event-integrity infrastructure before launch:

- append-only participant-bound logs for launches, hints, submissions, rejected values, checker results,
  high-value actions, and administrative decisions;
- immediate-submission/no-hoarding rule for flag challenges;
- explicit AI-use boundary acknowledged at registration and first scored launch;
- named reviewers, integrity lead, incident scribe, and appeal owner;
- evidence tiers treating timing, prose, user agents, and canaries as leads rather than proof;
- author-led solve defense and reproducible variation for reviewed prize solves;
- published retention, privacy, sanction, and appeal policies.

---

## 8. Current open questions

- Which audit/security group helps review the final specs: OtterSec, Asymmetric, Anza, AuraSec-style
  reviewers, or a mix?
- For Reward Sniper, the mechanics are locked for this iteration; only event-day synchronization,
  competing participants and searcher bots, and reset state remain.
- For IMPRINT, what exact attestation policy blocks virtual authenticators without making onboarding
  painful?
- For SIGNET, finish automatic idempotent participant setup on first authenticated launch, isolate each
  participant's target, and rotate away from the current staging program and public solve transaction.
- For LAST STOP, finalize the public SSH proxy, session capacity, and final receipt/retention policy;
  the portal completion mark is implemented, while points remain a later event-scoring decision.
- For AFTER HOURS, run a clean human and autonomous-agent playtest through the guild-install flow,
  confirm RPC/indexer capacity, and provision the final mint/recipient configuration.
- Do we ask a sponsor/researcher to co-author one challenge or review the final slate?
- What exact assistance is allowed, and may challenge files, screenshots, outputs, or derived artifacts
  be shown to an LLM?
- Which evidence threshold triggers a participant solve defense, and who must defend each reviewed solve?
- Which leaderboard positions are routinely reviewed, and how many reviewer shifts are funded?
- Do we offer a non-prize, self-declared low-AI board alongside the enforced prize track?
