# Anti-AI Design Principles (read this first)

Updated: 2026-07-08

The authoritative doctrine for designing CTF challenges that survive agentic AI. Read before designing
any challenge. Every rule here was paid for by an idea that failed — the failure log at the end names
them. This doc was consolidated after a long design arc; it supersedes scattered anti-AI notes in the
challenge docs.

---

## 1. The honest target (and the reframe that unlocked everything)

Not "AI-proof." That is a mirage for software.

The mistake we made for a long time was trying to make the **bug itself** unsolvable by AI. That is
impossible without gutting the security (see §3). The reframe that fixed it:

> **The goal is to kill the autonomous "pay-to-win" mode — you cannot point Claude Code / Codex at the
> challenge, give it all permissions, and walk away. A human must be actively in the loop.**

That is a *different, achievable* goal. "Ask ChatGPT a question" stays fine (we allow it). "Give an
agent the keys and let it solve everything" must fail. Note what this reframe buys: the bug can be as
**deep and real** as we like — the anti-AI does not have to come from the bug at all (§2).

Never market a challenge as "anti-AI" or "human-only." Claim only: *an autonomous agent cannot complete
the loop; AI-assisted, human-driven play can.* And **prove it by playtest** (all-human vs AI-assisted vs
all-autonomous-agent; the leaderboard split is the evidence).

### The complete event-integrity model

Challenge design alone cannot protect a live competition. The program has three coordinated pillars:

1. **Prevent:** make autonomous completion expensive or structurally incomplete.
2. **Detect:** retain privacy-bounded, explainable evidence that identifies solves needing review.
3. **Adjudicate and operate:** publish precise rules, staff reviews, test technical understanding,
   preserve evidence, apply consistent sanctions, and provide appeals.

Do not collapse these into one mechanism. A passkey can prevent autonomous completion but does not
detect agent use elsewhere. A canary is a lead, not proof. A fast solve may be brilliant. Enforcement
is a documented decision over corroborating evidence, not an automatic classifier. The operational
system is specified in `10-event-integrity-enforcement.md`.

---

## 2. The key model: two layers

A challenge is: **access → perceive → understand → act.** AI dominates one layer and is weak in
another, and they are *orthogonal*:

- **Understand layer (reasoning/depth):** reading code, spotting bug classes, writing exploits,
  fuzzing, optimizing. **AI wins here. Do not fight it.** Let the security be genuinely deep and even
  white-box.
- **Access / perceive / act layer (the plumbing):** getting to the content, perceiving it, and
  performing the required actions. **This is where AI's tooling fails**, and it is where all our
  anti-AI pressure should live.

**This resolves the bind we kept hitting.** For a long time we thought "deep security" and
"agent-resistant" were in conflict — because at the *understand* layer they are. They are not in
conflict when the anti-AI lives at the *access/act* layer: **keep the bug deep and real, and gate the
access and the winning action behind things an autonomous agent cannot do.**

---

## 3. What agents are GOOD at → never rely on these as the barrier

- Reading/understanding source instantly (white-box code reasoning is their home turf).
- Writing exploit scripts; RPC/API/program calls; systematic fuzzing at machine speed.
- Inverting static artifacts — decoding, reversing transforms, frame-sampling video, OCR.
- Simple, one-way UI navigation (computer-use handles basic click flows).
- Planning/optimization given time — even a 10-second turn is ample.

Corollary: **any bug found by reading code, or by black-box fuzzing a clean API, is not the barrier.**
And "make the bug subtle" does not help — a subtle bug is *more* an AI advantage, not less.

## 4. What agents are BAD at → build the barrier here

Ranked by how genuinely they stop an *autonomous* agent (not just a scripting one):

1. **★ Hardware-auth actions — passkey / WebAuthn / secp256r1 / hardware wallet.** A WebAuthn assertion
   or Ledger confirm is rooted in a secure element and requires a *physical* biometric/button touch. An
   autonomous agent — even computer-use — **cannot produce Face ID.** Strongest gate available in pure
   software. **And it's Solana-native:** SIMD-0075 (live on mainnet June 2025) added the secp256r1
   precompile so passkey signatures verify on-chain; LazorKit-style passkey smart wallets make it a real
   2026 Solana security surface. This is the anchor lever.
2. **Wallet human-approve (Solana wallet extension / mobile wallet).** Agents struggle badly with wallet-popup
   approval flows. A second cheap human gate.
3. **Venue-local / physically-delivered parameters.** A required input available only at the event —
   rotating big-screen QR, verbally announced, or served only on the venue network. A remote agent
   can't get it; an on-site human relays it in a second.
4. **WebGL/canvas-only perception** and **behavioral-biometric** anti-automation (mouse-movement
   checks). Content the agent must *see* in a render it can't easily parse.
5. **Complex, dynamic, real-time, multiplayer environments** (the minions/FPS insight) — too much
   happening at once to perceive→plan→act in time. Strong *for execution*, but note §6.
6. **Black-box behavioral discovery** (no source) — levels the field vs white-box. But note §6: keep it
   deterministic, and it is only a soft lever (fuzzing is agent-friendly).
7. **Unprompted investigative leaps (the "intent-gap").** Autonomous agents rarely *self-initiate*
   open-ended investigation — trawling repo/PR history, or realizing "I control this validator's clock."
   Handed a task they act locally and literally; the sideways realization that *unlocks* the challenge is
   a human instinct they don't default to. This stops the *autonomous* loop specifically (exactly the
   goal, §1) — but only while we **never signpost the leap** (§6 law 7). The moment the brief says "find
   the silent patch" or "warp the clock," we hand the agent the missing intent and the gap collapses. A
   human who forms the insight and then uses AI to execute is the allowed meta. This is what carries
   SIGNET (source archaeology) and DRIFT (the "you own the clock" realization).

## 5. On-site is a lever we already have

The event is **in a room, synced, proctored.** OtterSec's own post lists on-site proctoring as a real
solution ("AI bans… more freedom to enforce restrictions"). Chess/poker/esports do not use AI-proof
games — they use **proctoring + culture.** So: require **screen-share/replay for anyone contending for
prizes**, disallow autonomous agents socially, and let the technical gates (§4) make the autonomous
loop *structurally* incompletable. Technical gates + proctoring together, not either alone.

---

## 6. The design laws (each earned by a failure)

1. **Keep the security core real and deep.** A genuine bug class (for Solana: input/account validation,
   authority/CPI confusion, ordering, rounding, secp256r1/WebAuthn verification). Otherwise it's a game
   with a scoreboard, not a security CTF. White-box is fine — the anti-AI is not the bug (§2).
2. **Put the anti-AI in the access/act layer, not the bug.** Gate *reaching* the challenge and the
   *winning action* behind §4 levers. Do not try to make the bug agent-proof.
3. **No bolted-on skill gates *divorced from the content*.** A reflex mini-game unrelated to the
   security (our "mouse-drill" failure) is a gimmick. A gate is legitimate when it is a *real, in-band
   action* — signing the exploit tx with a passkey **is** the challenge's action; wiggling a mouse into
   a circle is not.
4. **Exploits must be deterministic and self-triggered, never random.** "Black-box" means no source —
   not "random behavior." The player must be able to run a controlled experiment: manipulate an input,
   see a reproducible effect, understand the cause, scale it. "Notice an oddity and click around" is not
   a CTF.
5. **Relative / dynamic scoring.** No fixed points; rank against the field, with anti-latecomer
   safeguards (share-of-total or best-of-N, not pure first-come cumulative). AI helps everyone roughly
   equally, so ranking reflects who understood + executed best.
6. **Validate, don't assert.** Playtest all-human vs AI-assisted vs all-autonomous; the split is the
   only defensible claim.
7. **Never signpost the earned realization.** When a challenge's anti-autonomous property rests on an
   unprompted investigative leap (§4.7), the brief must not name it. State the *objective* ("drain this
   vault"), never the *method* ("read the PR history" / "you control the clock"). Signposting converts an
   agent's intent-gap into a to-do list it can execute. Learner orientation goes through a **paid hint
   ladder**, not the default framing.
8. **Instrument for review, not surveillance theater.** Record team-bound launches, hints, submissions,
   checker outcomes, and safe canary events. Define access and retention before the event; never collect
   secrets or invasive device data.
9. **No single heuristic proves agent use.** Timing, prose style, user agents, canary hits, and plausible
   wrong flags are review triggers. Corroborate them and allow a technical solve defense and appeal.
10. **Design adjudication before launch.** Every challenge needs an expected human workflow, known
    alternate paths, author-owned defense questions, a safe reproduction variant, and a reviewer.

---

## 7. The core tension — and how it's resolved

Pushing anti-AI at the *understand* layer (black-box poking, twitch execution) tends to (a) raise the
beginner floor, (b) drain Solana-security authenticity, (c) balloon build cost. That tension is real
**only when you fight AI at the wrong layer.**

**Resolution:** fight it at the access/act layer (§2, §4). A deep, real, even white-box Solana bug whose
*winning action requires a hardware-auth touch* is simultaneously (a) authentic security, (b) reachable
by learners, (c) buildable, and (d) uncompletable by an autonomous agent. That is the target shape.

Still weigh the tension per challenge: the strongest design is not the *most* agent-hostile one — it is
the one that keeps the bug real, the floor reachable, and the build feasible while making the autonomous
loop impossible.

---

## 8. The failure log (so we don't repeat it)

- **Memo forensics (Settlement Room 73):** answer readable in artifacts → agents beat every layer
  (`02` §18). But its *access-layer* instincts (Turnstile, blocked fetch, video) were right — they were
  just single, individually-beatable barriers, not a stacked hardware-auth gate.
- **White-box exploit ladders (Vault Siege, Reward Sniper, VAULTBREAK, DESYNC as first drafted):** real
  bugs, but agent-solvable at the *understand* layer. Salvageable only by wrapping them in access/act
  gates (§2) + relative scoring — not by hiding the bug.
- **The mouse-drill / piloted console (VAULTBREAK):** an anti-AI gate *divorced from the security
  content* → gimmick (law #3). Abandoned.
- **DESYNC black-box arena:** "find an oddity, poke around" is shallow — it does not test security skill
  (law #4), and its agent-hostility was an un-validated tuning claim at a huge build cost.
- **OSINT/visual passive artifacts (`03`):** static photo/video/jigsaw are invertible by agents. Only
  no-API + auth + attention navigation, and live/timed interaction, held up.

**The synthesis that survived all of this:** a real, deep Solana bug (e.g., a secp256r1/WebAuthn
verification flaw) whose exploitation *requires a hardware-auth touch (passkey) + wallet approve*,
delivered with a WebGL/venue-local parameter, relatively scored, on-site and proctored. Depth and
anti-AI in the same real primitive — see `04-flagship-design.md`.

---

## 9. Key custody: no personal wallet in a challenge, ever

Every challenge that deploys/administers real on-chain programs (registrar, upgrade authority, vault
deployer, instancer, checker signer, etc.) must run on a **dedicated, challenge-scoped keypair** —
generated fresh for that challenge, gitignored, never a personal or main dev wallet.

- **Why:** a personal wallet baked into a program (as upgrade authority, a hardcoded registrar constant,
  a vault-deployer authority, ...) mixes real-world identity/funds with challenge infrastructure. It's a
  security smell (the wallet that can rug the challenge is also the operator's personal wallet), an ops
  risk (can't hand off or rotate independently), and it leaks personal on-chain identity into what should
  be disposable event infra.
- **How to apply:** for every new challenge, before the first devnet deploy, generate one dedicated
  operator keypair (`.keys/<challenge>-operator.json`, gitignored — add both `.keys` and `*-keypair.json`
  to that app's `.gitignore`). Use it as the program's upgrade authority, any hardcoded
  registrar/admin/instancer constant, and the deployer/authority for any seeded accounts. If it needs
  funding, send a plain SOL transfer from wherever — never reuse a personal wallet as the operator key
  itself, and never let a personal wallet sign, own, or appear as an authority anywhere in a challenge's
  on-chain state.
- **Verify before shipping:** grep the repo (source, `Anchor.toml`, IDLs, env files, docs) for any
  personal wallet pubkey and confirm zero hits outside plain funding-transfer records. This is a launch
  gate alongside the string-leak/answer-key checks in each challenge's build-review pass.
- **Precedent:** IMPRINT's `B3Bh...44ai` (personal wallet) was originally the compiled `REGISTRAR_ID`,
  the vault authority, and the program upgrade authority all at once. Fixed by generating
  `.keys/imprint-operator.json`, redeploying the program fresh under it (new program ID, since a clean
  operator-only deploy is simpler and more certain than transferring authority off a personal wallet),
  and reseeding the target vault under the operator. The personal wallet's only remaining role is the
  plain SOL transfer that funded the operator.
