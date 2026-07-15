# Challenge Explorations (OSINT/Visual + Source-Archaeology)

Two earlier directions we explored for anti-AI, Solana-native challenges. Superseded as
the *primary* format by the non-Jeopardy flagship design (see `../strategy/event.md`),
but kept here: several ideas remain usable as secondary/companion challenges, and the
adversarial self-tests document *why* passive-artifact puzzles lose to agents.

---

# Part A — OSINT / Visual × Solana-Security Challenges

# Five OSINT/Visual × Solana-Security CTF Challenges

Compiled: 2026-07-01

Purpose: move beyond "scripty" Solana challenges (dump/RPC/brute/trial-error — agent home turf) toward real-CTF, BountyCon-style challenges that chain **agent-hostile human navigation and visual judgment** into a **genuine Solana security exploit**. Each challenge targets a *different* real agent weakness, ends in a checker-validated state transition, and never stores the flag anywhere public.

---

## 0. The design spine (reusable template)

Every challenge below is built from one shape:

> **On-chain anchor → agent-hostile human pivot → recovered secret/parameter → real Solana exploit → checker HMAC flag.**

- **On-chain anchor:** a Solana artifact (program config, NFT/cNFT, SNS domain, deployer wallet, memo) that *points outward* but does not contain the answer.
- **Agent-hostile pivot:** a step on a surface with no clean API, requiring visual perception, spatial reasoning, temporal video reading, handwriting, or multi-click navigation across consumer platforms (Maps, Street View, business photos, X/IG/TikTok video, Realms/Squads dApp UIs, jigsaw assembly). This is where agents pay a huge, brittle cost.
- **Recovered secret/parameter:** the pivot yields a datum — a seed, an operator code, a passphrase, a leaked key fragment, a beneficiary pubkey.
- **Real Solana exploit:** the datum unlocks an actual security action — recover a lost signer, invoke a backdoor, hijack an authority, claim an admin PDA. Not "read a value."
- **Checker HMAC flag:** the flag exists only after the checker validates the on-chain state transition in the team's instance. `ST_FLAG{hmac_sha256(secret, team||chal||solve)[..24]}`.

Why this beats the previous ideas: the *thinking-hard part* is relocated off Solana onto surfaces agents can't script, while the *win condition* stays a real exploit so it's still a security CTF.

---

## Why these block agents (honest mapping)

| Agent weakness (real, current) | Which challenge leans on it |
|---|---|
| Precise geolocation from subtle visual cues; Street View has no exploratory API | 1 Dead Man's Keys |
| Auth-walled social nav + scrubbing video + reading transient burned-in text | 2 The Operator's Cut |
| Driving multiple interactive dApp SPAs with wallet connect; intent judgment over disguised data | 3 Rubber Stamp |
| Cross-image spatial synthesis / jigsaw edge-matching at scale; over-trusting metadata ordering | 4 Mosaic |
| Google Maps/Reviews/business-photos (no clean API, manual API-key/dashboard) + handwriting OCR + attention allocation | 5 Cold Trail |

All five also defeat **trial-and-error** (the agent's favorite fallback): the search space downstream of the pivot is huge without the human-recovered datum, and the checker/oracle is rate-limited.

**Reality check (do not oversell):** computer-use agents are improving at browser navigation. Treat these pivots as a **cost-and-brittleness multiplier**, not an absolute wall. The security core (real exploit + per-team checker) is what guarantees it's not a read-only solve; the pivots are what make AI assistance slow, brittle, and non-shortcutting.

---

## 1. Dead Man's Keys — geolocation → brain-wallet recovery → vault drain

**Security core (real):** access control via *recovered signer*. A vault's `withdraw` is gated to a hardcoded `founder` pubkey. You win by *becoming* the founder — recovering their lost key from a real-world-anchored brain wallet — then passing the owner check.

**Chain:**
1. **Anchor:** per-team devnet vault program; `withdraw` requires `signer == founder`. The founder wallet holds a Metaplex **Core** asset (self-hosted image + metadata, so nothing purges) titled *"where it started."*
2. **Pivot (geolocation):** the image is an un-EXIF'd street scene. A prominent storefront is an **attention sink** (decoy); the load-bearing clue is a half-occluded street sign + a landmark reflected in a window. The human uses Street View / Maps to fix the exact intersection and read a plaque year. *(No clean API for this exploratory visual search; agents latch onto the salient storefront and misgeolocate.)*
3. **Recover:** a founder memo on-chain: *"my key was always my first shop — lowercase street name, no spaces, then the plaque year."* → `seed = sha256("elmstreet1998")` → `Keypair.fromSeed` → founder key.
4. **Exploit:** sign the fresh, session-bound `withdraw` in your instance → vault drains to your escrow.
5. **Flag:** checker validates the vault delta + escrow owner → HMAC flag.

**Anti-AI layers:** visual geolocation, attention red herring (salient-but-wrong storefront), brain-wallet formula requiring the human-read plaque, huge key space (trial-error dead).
**Fairness/ethics:** use a clearly-geolocatable real place OR a fictional set you photograph; confirm a determined human can solve it via Street View in beta. Provide a hint ladder. Not screen-reader friendly — pair with an alt-track or reserve as an optional showpiece.
**Answer-sharing mitigation:** the founder key is global once geolocated, but the **drain is a fresh per-team tx** bound to the team session, and the flag is HMAC(team). First-blood + writeup review handle the rest. (Inherent to OSINT — see §6.)

---

## 2. The Operator's Cut — auth-walled social + temporal video → backdoor code

**Security core (real):** an undocumented privileged path (`emergency_operator`) — a genuine access-control anti-pattern. A hidden `emergency_withdraw(code)` bypasses normal checks if you present the operator code. Recover it, invoke it.

**Chain:**
1. **Anchor:** the program's config account references a `.sol` **SNS** domain; its records resolve to a project **X/Twitter** handle. (Solana-native identity pivot.)
2. **Pivot (social + video):** the account has dozens of posts (attention). One is a ~20s "ops walkthrough" screen-record. The operator code is **burned into the video, never in the caption**, and rendered with **persistence-of-vision interlacing**: no single frame shows the full code and frame-averaging yields mush — it's only legible **played, in motion**. *(X login wall + infinite scroll + "which post?" + transient in-video text + PoV that defeats frame-sampling/averaging.)*
3. **Per-team twist:** the on-screen token is a *word*; the real code = `HMAC-ish combine(word, your_session_nonce)` per the walkthrough's stated rule. So the shared-OSINT word yields a **per-team code**.
4. **Exploit:** call `emergency_withdraw(code)` on your instance.
5. **Flag:** checker validates the privileged withdrawal → HMAC flag.

**Anti-AI layers:** social auth wall, video scrubbing, PoV temporal encoding, attention (many posts), per-team code (no replay), rate-limited code attempts.
**Fairness/accessibility:** captioned *alt* description for hearing/vision needs must not leak the code — instead route accessibility solvers to a supervised alt-channel. Keep the video short and re-watchable.
**Durability:** self-host the video too (mirror off X) so the challenge survives account/API changes; strip metadata; test frame-sampling + averaging in QA (§15 of doc 02).

---

## 3. Rubber Stamp — dApp-UI navigation + disguised governance proposal

**Security core (real, high-tier):** a malicious **DAO/multisig proposal** whose friendly description hides a dangerous instruction — the classic "the UI says *pay vendor 100 USDC*, the encoded ix actually calls `SetAuthority`/`SetUpgradeAuthority` to an attacker." Real skill: decode proposal instructions, cross-reference accounts, and **judge intent** to pick the one truly-malicious proposal among plausible-looking ones.

**Chain:**
1. **Anchor:** a **Realms** DAO (or **Squads** multisig) devnet instance with several open proposals; a linked forum/description page frames each in friendly terms.
2. **Pivot (navigation + judgment):** the human drives the Realms/Squads SPA (wallet-connect, expand raw instruction, decode accounts) across multiple proposals. Every proposal has a *plausible* scary-looking element (bait), but only one **violates the DAO's actual invariant** — which you infer from the DAO's stated purpose vs. on-chain reality. The disguised ix moves upgrade authority / mint authority to an attacker beneficiary. *(Driving interactive dApp UIs is brittle for agents; and the giveaway is intent-judgment — "make blind trust of the friendly summary fail" — not a decodable constant.)*
3. **Exploit:** in your per-team sandbox, demonstrate it — approve+execute the malicious proposal and show the authority actually moved (state change), *or* submit the exact disguised ix + attacker beneficiary you fingered.
4. **Flag:** checker validates the state change / correct identification → HMAC flag.

**Anti-AI layers:** multi-UI navigation, intent-selection among many plausible proposals (agents over-trust the rendered description = the "trust structured data" weakness), attention/time sink.
**Honest note:** a strong agent *can* decode ix data by script if it fetches the proposal accounts directly — so harden the gate as **intent-selection** (which of N valid-looking proposals is the real exploit given context), not raw decoding. This one is more "navigation + business-logic judgment" than pure vision — deliberately, to diversify the set.

---

## 4. Mosaic — compressed-NFT recon + visual jigsaw synthesis → admin PDA

**Security core (real):** Solana-native data structures (**Bubblegum compressed NFTs**, DAS enumeration, Metaplex) as the recon layer, then a passphrase-derived **admin PDA takeover** on a per-team program.

**Chain:**
1. **Anchor:** a per-team **compressed NFT** collection (hundreds of leaves) — the agent enumerates via DAS `getAssetsByGroup` (this part is fair Solana skill).
2. **Pivot (visual synthesis):** each cNFT image is a **tile**. Only when arranged by a **visual rule** (jigsaw edge-matching / gradient continuity / a scene that only reads when assembled) does a hidden passphrase appear. The metadata contains a **decoy ordering** (a tidy `index`/`sort` attribute) that assembles into a plausible-but-wrong image showing a **false-flag passphrase** the agent will trust. *(Cross-image spatial jigsaw at scale is a genuine agent weakness; the decoy metadata weaponizes "trust the structured field.")*
3. **Recover:** the true assembly → passphrase → seed for the program's `admin` PDA.
4. **Exploit:** derive+claim the admin PDA, perform the privileged action on your instance.
5. **Flag:** checker validates the admin action → HMAC flag.

**Anti-AI layers:** visual jigsaw/synthesis, decoy metadata ordering (false flag AI adopts), per-team shuffled collection (per-team passphrase — cNFTs are cheap to mint per team, so **no answer-sharing**).
**Fairness/accessibility:** use jigsaw/scene assembly (solvable by most) rather than Magic-Eye/anaglyph as the default; keep tile count reasonable (dozens, not thousands) so it's judgment, not grind.

---

## 5. Cold Trail — multi-hop consumer OSINT + handwriting → leaked key

**Security core (real & realistic):** operational key leakage — the everyday disaster where a dev exposes seed material in a photo. Recover a leaked seed *fragment*, reconstruct the key, and use it to claim/forge. Real skill: key-material handling and understanding what a leak enables.

**Chain (BountyCon-style heterogeneous pivots):**
1. **Anchor:** a program deployer wallet → SNS/metadata → a project site's "team/about" page → a (fictional) founder persona.
2. **Pivot (consumer OSINT, agent-hostile):** persona → the project's **Google Maps business listing** → the **user-uploaded Photos tab** (no clean API; manual, visual) → among many photos, one desk shot has a **handwritten sticky note / whiteboard** in the background with a *partial* seed phrase. Decoys: a fake "password" on a monitor, a second business photo set. The phrase uses the **"drop the last word"** trick and must be combined with an on-chain hint to reconstruct. *(Google Maps/Reviews/business-photos have no clean API and require manual API-key/dashboard setup; handwriting OCR is weak; "which photo, which detail" is attention allocation — all where humans coast and agents stall.)*
3. **Recover:** reconstruct the seed → derive the key.
4. **Exploit:** use it to claim a per-team vault / forge the gated action.
5. **Flag:** checker validates the claim in the team instance → HMAC flag.

**Anti-AI layers:** consumer-platform navigation with no API, handwriting reading, heavy attention red herrings, huge key space (trial-error dead without the fragment).
**Ethics (mandatory):** use a **fictional persona and a business/listing you control** — never point solvers at a real person or real business. Canaries public-only.
**Answer-sharing:** as with all OSINT, the fragment leaks once found; the **claim is per-team + HMAC flag**, and you can bind the reconstruction to a per-team on-chain nonce so the final key differs per team.

---

## 6. Cross-cutting design rules (so we don't repeat past mistakes)

- **Flag only from the checker**, after a verified on-chain state transition. Never in image/metadata/memo/log/binary. (Doc 01 §4.)
- **Durability:** self-host every off-chain asset (image, video, metadata) — do **not** use ephemeral devnet Irys (killed challenges 10/13 last time). Mirror social media assets locally.
- **Fresh wallets per iteration:** dirty devnet history leaked answers last time (doc 02 §18). Rotate; publish only final neutral state.
- **Answer-sharing is inherent to OSINT.** Mitigate with: per-team final exploit tx, HMAC(team) flags, per-team-bound secrets where feasible (challenges 2 & 4 fully; 1 & 5 partially), first-blood scoring, and post-event writeup review. Be honest that the *datum* can be shared but the *doing* is per-team.
- **Anti-cheat done right:** canaries are **telemetry only**, public data only, evidence-tiered (doc 02 §16). Do **not** repeat the current taint bug (taint keyed on public wallet, settable via unauthenticated GET) — bind any taint to a verified session the caller proves they own.
- **Accessibility:** visual/audio/handwriting gates exclude some solvers. Provide alt tracks or ensure the security core is reachable another way; keep difficulty in **deception and navigation**, never eyesight strain or trivia only some people know.
- **Positioning:** these are showpiece hybrids. Run **1–3 of them**, not a whole event of them; most challenges stay the standard per-team exploit-checker model. (Doc 02 §17: ~70/20/10 split.)

## 7. Honest limitations

- None of these is "AI-impossible." A patient computer-use agent can drive a browser, and a human can relay observations. What they reliably achieve: **AI assistance stops being a shortcut** — it becomes slow, brittle, and error-prone on the pivot, while a human coasts, and the security core guarantees no read-only solve.
- Prompt-injection/canary layers remain *telemetry and weak-agent friction*, layered on top — never the gate.
- The strongest anti-answer-sharing property comes from per-team-bound secrets (2, 4). Prefer those constructions when a challenge must be robust to leak.

---

## 8. Adversarial self-test — could I / Codex / a computer-use agent solve v1?

I have browser automation (claude-in-chrome), RPC, scripting, and internet. Here is the honest attack I'd run on each **original** idea and where it breaks.

| # | The shortcut I'd actually try | Verdict on v1 |
|---|---|---|
| 1 Dead Man's Keys | Reverse-image search + a VLM geolocation pass. GeoGuessr-grade models are strong now; the brain-wallet formula is on-chain, so once I have street+year it's pure script. **Single visual gate on a skill agents are improving at fast.** | **Weak–medium.** One point of failure. |
| 2 The Operator's Cut | The PoV video is a *passive artifact*, and inverting transforms is an agent **strength**. I'd sample frames at high FPS and try max/OR-over-window, decay kernels, optical-flow accumulation — one of them reconstructs the glyph. "Video is not AI-proof" (your own doc 02 §14). | **Weak.** Obfuscation, not a gate. |
| 3 Rubber Stamp | Fetch proposal accounts by RPC, decode every instruction by script, diff each against its description. "Find the ix that contradicts its label" is **text comparison + data decoding** — squarely agent turf. UI friction bypassed by going direct to RPC. | **Weak.** It's a good *security* task but a bad *anti-AI* one. |
| 4 Mosaic | Enumerate via DAS (fine). Then `cv2.Stitcher` auto-assembles panoramas and published solvers handle edge-matched jigsaws/shredded docs; VLM OCRs the passphrase. **Geometric reassembly is tool-scriptable.** | **Medium.** Beatable with known CV tooling. |
| 5 Cold Trail | Google Maps *user-photos* tab genuinely has no clean API and computer-use on Maps is brittle; finding a background handwritten note across many photos + messy-handwriting OCR is where I actually stall. | **Medium–strong.** The real friction is here. |

**What the self-test reveals:** every gate that is a *passive artifact* (static photo, video, tile set, encoded proposal) is invertible, because inverting transforms and comparing text/data is the agent's core competence and trial-and-error is free. The gates that actually held were **(a) surfaces with no API + auth + attention** (Maps user-photos) and, by extension, **(b) anything interactive, timed, and un-batchable**. So the fix is to stop relying on passive perception as the sole gate.

## 9. The loop — what I changed

Rule I extracted: **passive artifacts are friction; the durable gates are (1) live/timed/coupled interaction that can't be batched or relayed, and (2) compounding no-API + auth + attention navigation. Static perception is only ever *one hop among several*, never the whole lock.** Also: bind the recovered secret to a per-team nonce so the answer can't be shared.

Rework: keep the two that held (1 hardened, 5 kept), fix 4, and **replace** 2 and 3 with interactive/compounding designs.

## 10. The final five (hardened)

### 1. Dead Man's Keys → *time-traveler* variant
- **Security core:** recover a lost signer (brain wallet) → pass an owner check → drain a per-team vault.
- **Robust gate:** not a static photo (reverse-image-searchable). The founder's memo says *"the sign that was there when I opened, not the one there now."* The solver must drive **Street View's historical time-slider** to a specific past capture and read a sign that **only exists in that panorama's 2019 state**. No API exposes historical panoramas; reverse-image search can't reach a specific past capture; a VLM can't geolocate *through time*. Plus an attention-decoy storefront.
- **Agent verdict:** medium. Operating the Maps time-machine UI is brittle for computer-use and there's nothing to reverse-search. Residual: a patient browser agent could grind it. Honest.
- **Sharing:** brain-wallet is global once found → **bind the drain to a per-team session nonce in the memo** so each team must still do the on-chain exploit; HMAC(team) flag.

### 2. Handshake *(replaces The Operator's Cut)* — the strongest anti-AI one
- **Security core:** a real undocumented privileged path (`emergency_operator`) on a per-team program. Invoking it needs a session-sealed operator token.
- **Robust gate:** the token is issued only after completing a **live coupled challenge-response** at an "ops console" — ~10 rounds, each round renders a fresh short-lived perceptual token and you must respond correctly within ~8s, and **round N's prompt is derived from your round N-1 answer + a fresh on-chain action**. No passive artifact exists to invert; you can't batch (N needs N-1's live state); a human→AI→human relay blows the per-round timeout. Finishing seals the token to your session → you call the privileged instruction → checker validates.
- **Agent verdict:** **strong.** My own tool-loop latency (seconds per round-trip) misses 8s windows across 10 coupled rounds; there is no artifact to download and transform. This is the Sealed-Cue property in pure software, **no hardware**.
- **Fairness:** it's a 90-second timed reflex/perception minigame with a calibration round — fun for humans, and re-runnable so a missed window isn't fatal. Provide an accessible timing tolerance.

### 3. Trailhead *(replaces Rubber Stamp)* — compounding heterogeneous navigation
- **Security core:** a real bug (e.g., an emergency-seed access-control path) whose per-team parameter is the payoff of a 4-hop hunt.
- **Robust gate:** a **BountyCon-style chain across maximally heterogeneous no-API surfaces**, where the wall is *compounding friction + next-step ambiguity* (no step says where to go next): on-chain validator/vote anchor → a stat visible **only in a dashboard chart** (validators.app/stakewiz UI, no clean API) that disambiguates which account matters → that project's **Discord (join + scroll history)** for an announcement → a linked gist/doc holding the per-team parameter. Each hop is a different auth wall / visual-only surface; agents stall on "where do I even look next," Discord join, and chart-reading.
- **Agent verdict:** medium, **strong via compounding** — any single hop is beatable, but chaining 4 brittle no-API hops with no explicit next-step wears agents down and breaks their trial-and-error loop. Joining a Discord (OAuth/verification) is a genuine agent stall.
- **Ethics/durability:** fictional project you control; self-host the doc; the Discord is your event server.

### 4. Mosaic → *semantic* variant
- **Security core:** cNFT/DAS recon (real Solana skill) → passphrase → **admin PDA takeover** on a per-team program.
- **Robust gate:** replace geometric jigsaw (auto-stitch beats it) with **semantic ordering** — tiles are frames of a tiny stop-motion/story with no edge cues, so the correct order requires *understanding the narrative*, not matching edges — and make the final reveal a **low-contrast gestalt** that VLM OCR misreads while a human reads instantly. Metadata carries a **decoy `sort` order** that assembles a plausible wrong image showing a **false-flag passphrase** the agent will trust.
- **Agent verdict:** medium. Semantic ordering defeats `cv2.Stitcher`; the gestalt reveal + decoy-metadata trap catch the reflexive path. Residual: a careful multimodal agent could brute orderings against the checker — so **rate-limit** passphrase attempts. **Per-team shuffled collection = no answer-sharing.**
- **Accessibility:** gestalt, not Magic-Eye/anaglyph; keep tile count in the dozens (judgment, not grind).

### 5. Cold Trail — kept, hardened
- **Security core:** operational **key-leak recovery** → per-team vault claim.
- **Robust gate:** Google Maps **user-photos** tab (no API) → a background **handwritten** partial seed on a sticky note among many photos (attention + messy-handwriting OCR failure), photo **hosted only on Maps** (not reverse-searchable), "drop the last word" reconstruction combined with a **per-team on-chain nonce**.
- **Agent verdict:** medium–strong — this held in the self-test; the no-API + background-detail + handwriting stack is where agents genuinely stall.
- **Ethics:** fictional persona + a listing you control; never a real person.

## 11. Robustness ranking + bottom line

Honest ordering, most-to-least agent-resistant:

1. **Handshake** — interactive/timed/coupled; nothing to invert, relay-latency kills assist. *Strongest, no hardware.*
2. **Cold Trail** — no-API consumer surface + handwriting + attention; held in self-test.
3. **Trailhead** — compounding 4-hop no-API navigation; strong via friction stacking.
4. **Dead Man's Keys (time-traveler)** — interactive historical Street View; medium, one gate.
5. **Mosaic (semantic)** — perceptual synthesis; medium, needs rate-limit backstop.

**Bottom line:** none is "AI-impossible" — that goal is a mirage for software. What this set achieves is the real target from your own docs: **AI assistance stops being a shortcut and becomes slow, brittle, and error-prone, while a skilled human coasts — and the Solana exploit core guarantees there is no read-only solve.** The single most durable property across all five is *interaction that can't be batched or relayed*; lean on it (Handshake) for anything that must truly hold, and use per-team-bound secrets everywhere to defeat answer-sharing.


---

# Part B — Source-Archaeology (Patch-Diffing / N-Day)

# Source-Archaeology Solana CTF Challenges (Repo / PR / Issue / Advisory Navigation)

Compiled: 2026-07-02

Core idea: use **real Solana source-control archaeology** — commit history, closed/unmerged PRs, review threads, buried issues, security advisories, dependency locks — as the challenge surface. This is the best angle found so far because the *human-hard part is genuine Solana security work* (patch-diffing, N-day analysis, supply-chain review), not a generic OSINT puzzle bolted onto a trivial Solana call. It directly satisfies the prior principle: **make Solana the hard spine, not a wrapper.**

---

## 1. Why this angle is different (and better)

Previous ideas made the anti-AI gate off-chain and generic (geolocation, video, handshake) with Solana as a one-call payload. Here, the thing an agent is bad at — **finding the security-relevant needle in a huge, messy, real repository history and understanding *why* it matters** — *is itself the Solana security skill*. There is no wrapper. The latest repo is fixed; the live challenge target is an older pre-fix deployment. Finding the quiet refactor that fixed the issue, then exploiting the stale deployed program, is exactly what a real Solana auditor / N-day researcher does.

This is also the truest to the BountyCon feel the event wants: "go through different source codes, PRs, issues, figure out what actually matters."

---

## 2. Research grounding (real, verified)

### Real Solana vulns that make good, *subtle*, exploitable CTF models
- **Jet Protocol** — misuse of a `break` statement caused unintended control flow, allowing free borrowing of protocol TVL. Subtle one-keyword bug; PoC exists (OtterSec `jet-governance-pocs`). *Ideal silent-fix material: `break` → `return`/`continue` is a tiny, easy-to-miss diff.*
- **Cashio** — failure to validate input accounts (broken "root of trust" / account-substitution). PoC in PwnedNoMore `cashio-exploit-workshop`. *Access-control archaeology.*
- **Solend rounding** — `round` instead of `floor`; "innocent-looking rounding error" (Neodyme). *A one-line diff with huge impact — perfect for patch-diffing.*
- **Wormhole ($325M)** — insufficient delegation of signature verification; unvalidated reference-only accounts in the `SignatureSet`. *Signature/authority archaeology.*
- **SPL token-lending** — arithmetic overflow/underflow; checked-math omissions (Neodyme PoC).
- **GHSA-h6xm-c6r4-vmwf** — `spl-token-swap` unsound `u8`→type casts (misaligned deref / illegal `bool` bit patterns), affects ≤ 3.0.0. *Supply-chain / advisory archaeology.*
- **Candy Machine** — missing `#[account(zero)]`; single-line Anchor fix. *Small-diff account-init bug.*

### Agents genuinely struggle to navigate GitHub at scale (verified)
- GitHub **Search API is 30 req/min**; **secondary rate limits** trip on large result sets.
- AI agents pushed ~17M PRs in a month and caused **five outages / 8.7h of code-search downtime** — GitHub is actively rate-limiting and pushing bot identification.
- Code search has **poor recall** and doesn't index everything (old commits, all branches, forks, closed-PR diffs, review comments).

Implication: broad "search the repo for the bug" hits walls; the useful content often lives **outside a clean `git clone`** (closed/unmerged PRs, force-pushed commits, review threads, issue comments), which is exactly where agents stall and humans click.

---

## 3. The flagship: "Signet" (patch-diffing / N-day, Solana-native)

**Premise:** a per-team devnet program is a fork of a realistic Solana library, **deployed from the vulnerable commit right before a *silent* security fix** — no advisory, no changelog, the fix hidden inside an innocuous-looking "cleanup/refactor" PR. The latest repo is fixed; the live target is stale. The solver must do real N-day work.

**Intended solve (all Solana security skill):**
1. **Fingerprint the deployed program** → determine which source era it corresponds to using behavioral
   probing, account/instruction compatibility, and an opaque build fingerprint. Do not embed a plaintext
   version string or leak exact commit metadata. *Real supply-chain/version-pinning forensic.*
2. **Locate the silent fix** by reading commit history / PR diffs / review threads — no advisory to grep; the fix is a tiny diff (`break`→`return`, `round`→`floor`, a re-added owner check) buried in a larger refactor, with a reviewer comment that hints at the real reason.
3. **Understand the vuln** from the diff + discussion (intent, not pattern-match).
4. **Exploit the stale deployed pre-fix instance** (the real bug, e.g., Jet-style control-flow or Solend-style rounding) for a per-team randomized target.
5. **Flag** from the checker after the validated state transition.

**Why it resists agents (honest):**
- **Silent** = no advisory/CHANGELOG shortcut; you must diff-read and infer intent.
- **Attention over volume** — the needle is one small diff among many commits/PRs; GitHub search recall + rate limits punish broad automated scanning.
- **Fingerprint-to-commit** — you can't skip to "the vuln" without first matching the binary to a version.
- **Intent in the PR thread** — the giveaway is human discussion, not a decodable constant.

**Where an agent could still win (be honest):** a patient agent that clones, builds, and `git bisect`s on a behavioral test could find the fix commit. **Hardening:** make bisect-on-behavior ambiguous (the silent fix is bundled with unrelated behavior changes so a naive behavioral bisect points at the wrong commit), require the fingerprint step first, and keep the exploit itself genuinely multi-step. Verdict: **medium-strong**, and it degrades to "the agent had to do real N-day analysis" — which is the accepted bar.

---

## 4. Variants (same spine, different archaeology weakness)

### A. "Orphaned" — the bug lives in a *closed, unmerged* PR
The deployed program runs code from a PR that was opened, pushed back on in review, and **closed without merging** — so it is **not on any branch of a clean clone**. Main looks benign. The solver must enumerate **closed/unmerged PRs** (rate-limited GitHub API/UI, attention over many), recognize the deployed binary matches the abandoned PR, and exploit it.
- *Anti-AI:* closed-PR diffs + review comments aren't in `git clone`; enumerating them is rate-limited and UI-heavy; "which of many closed PRs" is attention. **Genuinely agent-hostile navigation.** Verdict: medium-strong.

### B. "Blame Chain" — supply-chain / advisory archaeology
The deployed program pins a dependency version with a **real RUSTSEC/GHSA advisory** (model on `spl-token-swap` unsound `u8` cast). The solver navigates: deployed program → `Cargo.lock`/manifest → the vulnerable dep version → the advisory → the exact call path in the deployed program that reaches the unsound code → craft the triggering input.
- *Anti-AI:* cross-repo correlation + mapping an advisory to a concrete reachable call path. Weaker (advisories are grep-able) unless the reachability is non-obvious. Verdict: medium. *Good as an intermediate rung.*

### C. "Wontfix" — the vuln is a buried, forgotten issue
A security concern was filed as an issue years ago, discussed, labeled `wontfix`/`good first issue`, and forgotten; the deployed program still has it. Solver must find the issue among thousands (issue-search recall is poor), understand it, and exploit.
- *Anti-AI:* issue-search recall + attention + semantic understanding. Verdict: medium.

---

## 5. Design rules specific to this angle

- **Use a fictional-but-realistic repo you control** (modeled on Jet/Solend/Cashio patterns), not a real project's real history — so you can (a) plant the silent fix and PR thread deliberately, (b) vary it per cohort, (c) avoid pointing solvers at real people, and (d) survive real-repo changes. Populate it with realistic commit/PR/issue volume so the attention tax is real.
- **Per-team + anti-sharing:** deploy each team's instance at a randomized pre-fix SHA and/or randomized exploit target; the *archaeology answer* ("which PR") may leak between teams, so lean on the **per-team exploit + checker HMAC flag + first-blood**, and optionally rotate the silent fix across cohorts.
- **Keep the flag checker-only** (no flag in repo, binary, logs, advisory). Real state transition on the per-team instance → HMAC flag.
- **Fairness:** the silent fix must be *findable by a skilled human in reasonable time* — a suspicious "cleanup" diff a careful reviewer would flag, not an invisible needle. Provide a scoped repo (not the whole Agave monorepo) so it's judgment, not endless grind. Give a hint ladder ("the fix wasn't announced; look at refactors near the vulnerable module").
- **Ethics:** if you reference real advisories (Blame Chain), use them as *learning material*; never weaponize a live unpatched real project.

---

## 6. Why this is the strongest fit for the event

- **Solana is the hard spine:** finding + understanding + exploiting a real Solana bug class *is* the challenge. No generic wrapper.
- **Real-CTF / BountyCon feel:** navigating messy real-world source history, PRs, issues, advisories — exactly the exploratory "figure out what actually matters" experience requested.
- **Authentic anti-AI:** the friction (attention over huge silent history, no-advisory shortcut, not-in-clone content, GitHub rate limits, intent-in-thread) is intrinsic to the task, and it's *verified* that agents stall on GitHub at scale — not bolted-on theater.
- **Honest ceiling:** not AI-proof (a patient agent can bisect/build/test), but it forces genuine N-day security work and the exploit guarantees no read-only solve.

---

## 7. Sources

- sannykim/solsec (Solana exploit/vuln collection): https://github.com/sannykim/solsec
- RUSTSEC advisory DB: https://github.com/rustsec/advisory-db
- GHSA-h6xm-c6r4-vmwf (spl-token-swap unsound casts): https://www.wiz.io/vulnerability-database/cve/ghsa-h6xm-c6r4-vmwf
- SPL security advisories: https://github.com/solana-labs/solana-program-library/security
- Helius, "A Hitchhiker's Guide to Solana Program Security": https://www.helius.dev/blog/a-hitchhikers-guide-to-solana-program-security
- Zealynx Solana security checklist: https://www.zealynx.io/blogs/solana-security-checklist
- GitHub AI-agent PR strain / outages: https://www.danilchenko.dev/posts/2026-04-11-github-ai-agents-pull-requests/
- GitHub Search API rate limits (community): https://github.com/orgs/community/discussions/179480
