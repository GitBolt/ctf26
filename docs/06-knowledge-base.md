# CTF26 Knowledge Base

Updated: 2026-07-12

This is the working memory for the event: what we are building, how we protect competition integrity,
why the challenge slate looks this way, what benchmark we are comparing against, and which real Solana
bug classes are worth mining for buildable challenges.

Read this after `04-flagship-design.md` when you need the full context quickly.

> **IMPRINT is COMPLETE and LOCKED.** Its mechanics, hardened Anchor verifier, passkey gate, checker,
> UI, deployment, and AI/autonomous-agent evaluation are finished. Do not redesign or reopen IMPRINT.
> Future work on it is limited to event operations: final passkey enrollment, target capacity, and
> clean-room human QA.

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
system is in `10-event-integrity-enforcement.md`.

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
[`11-reward-sniper-agent-resistance-case-study.md`](11-reward-sniper-agent-resistance-case-study.md).

---

## 2. Chat / sponsor context

### Meteora

The misunderstanding to avoid: this is not "participants solve a problem inside Meteora" and not
"hack Meteora."

The pitch should be:

- teams compete as searchers/liquidators in a DLMM-style market on devnet/private validator;
- we build an educational DLMM-style program with local mints;
- participants reason about active bins, bin movement, reward checkpoints, and LP reward accounting;
- the planted issue is a realistic reward-accounting bug around stale checkpoints / JIT liquidity;
- teams write a searcher script or bot to extract more reward value than the field;
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
- challenge infra matters: per-team instances, runner services, checker logic, and reproducible
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
  teams are ranked by how well their searcher performs over repeated rounds/ticks.
- A Solana version can use **market rounds** instead of shooter matches: each round has a randomized
  pool state, reward regime, active-bin path, and other teams' actions.
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

## 4. Current four-challenge slate

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
- relative scoring and live market state make "found bug" insufficient; teams must extract better than
  the field.
- borrows the `minions-in-16k` lesson: measure the quality of each team's strategy over repeated live
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
- solve: authenticate with the team's real passkey, use the binding flaw to authorize a vault/treasury
  the team should not control, and submit through wallet approval.

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
- deployed per-team program is intentionally pinned to the older vulnerable pre-fix commit;
- silent fix is hidden in a boring refactor PR/review thread, with decoys;
- canonical planted bug: an unpinned strategy CPI forwards the quarry program's trusted vault PDA as
  a signer to a caller-selected program;
- solve: fingerprint deployed commit, find the silent fix, understand the authority bug, deploy/call
  an attacker strategy, drain the randomized per-team target.

Why it is good:

- models real audit/N-day work;
- teaches one of the most important Solana bug classes: caller-supplied CPI program plus trusted PDA
  authority;
- still ends in a live exploit, not just "name the PR."

Risk:

- a patient agent can clone/bisect if everything is in a clean public repo. Mitigate by putting the
  decisive context in closed/unmerged PR text, review comments, decoy refactors, and requiring a live
  per-team exploit.

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

Spec: `challenges/overclock.md`

Identity: bytecode reverse-engineering / runtime-time exploit.

Core:

- per-team local runtime/localnet with a bytecode-only vault artifact;
- no source, no IDL, no symbolic account names in the player artifact;
- planted bug: value-critical math trusts `Clock::unix_timestamp` and uses unchecked/wrapping elapsed
  arithmetic;
- solve: reverse enough of the bytecode to identify deposit/accrue/withdraw, realize the team controls
  localnet time, then forward-warp or rewind the clock to inflate balance and drain the reserve;
- checker replays a submitted exploit trace against a fresh canonical target and emits an HMAC flag;
- the public trace language exposes only generic `invoke` and `set_sysvar` operations. It documents
  the mechanism completely but does not name Clock or reveal instruction tags/account order. Stable
  aliases solve the otherwise-impossible problem of referring to freshly generated team accounts.

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
2. The bug must be reproducible locally and exploitable in a live per-team instance.
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

- per-team registration and escrow identity;
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
- SIGNET: fictional GitHub-style repo/history, per-team pinned deploy, decoy PR/issues,
  target randomization, exploit checker.
- DRIFT: finalized stripped native SBF artifact, forbidden-string gate, deterministic per-team
  LiteSVM replay, authenticated submission service, player-only kit, and strict net-drain checker.

Playtest requirement before launch:

- human-driven, no-autonomous-agent team;
- AI-assisted human team;
- autonomous-agent attempt with browser/computer-use permissions;
- compare solve time, bottlenecks, and whether the leaderboard still reflects security judgment.
- establish a human workflow baseline: milestone times, false starts, hint use, action count, and
  technically plausible alternate paths;
- prewrite the author's solve-defense questions and one safe parameter/variant change.

Event-integrity infrastructure before launch:

- append-only team-bound logs for launches, hints, submissions, rejected values, checker results,
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
- For Reward Sniper, how much source/IDL do we expose during the scored round without collapsing into
  source-review?
- For IMPRINT, what exact attestation policy blocks virtual authenticators without making onboarding
  painful?
- For SIGNET, how large should the fictional repo be so it feels realistic but not grindy?
- Do we build all four in-house, or ask one sponsor/researcher to co-author one challenge?
- What exact assistance is allowed, and may challenge files, screenshots, outputs, or derived artifacts
  be shown to an LLM?
- Is liability team-wide when one member violates the rule, and who must defend each solve?
- Which leaderboard positions are routinely reviewed, and how many reviewer shifts are funded?
- Do we offer a non-prize, self-declared low-AI board alongside the enforced prize track?
