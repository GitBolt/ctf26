# [EVENT NAME] — Sponsorship Prospectus

**Superteam Solana Security CTF · [DATE] · [CITY / VENUE]**

> **Draft snapshot:** this sponsor-facing prospectus preserves the original four-challenge pitch for
> outreach history, including its superseded small-team format. The implemented event registers and
> scores individuals only, and the catalogue now contains ten challenges; use
> [`knowledge.md`](knowledge.md) and [`docs/README.md`](../README.md) for the
> current slate before sending this externally.

India's first-ever Solana *security* CTF, next edition. An on-site, learn-friendly competition built
around real Solana exploit work: DeFi accounting, passkey/WebAuthn verification, CPI/PDA authority,
runtime assumptions, and live on-chain state transitions.

The event is designed for 2026, so agentic-AI abuse is handled explicitly. But the core promise is
simple: these are proper Solana CTF challenges first. The anti-agent measures protect the competition;
they do not replace the security work.

---

## The event

- **Format:** on-site, synced, event-style — food, merch, and a **real-time big-screen leaderboard** for
  the competitive feel. Solo + small teams (up to 3).
- **Scale:** ~[N] hand-picked participants.
- **Audience:** not elite hackers — people getting into the Solana ecosystem who want to learn security.
  Challenges are **low-floor / high-ceiling**: beginners score and learn; experts fight for the top.
- **Track record:** last edition drew **50+ builders at Microsoft's Bangalore office**.

---

## Why it's different: Solana security first, AI-aware by design

The standard we are holding ourselves to is the same one serious Solana CTFs use: every challenge must
end in a real exploit or measurable technical result, not a clue hunt or a static answer. Participants
will write bots, exploit clients, transactions, or helper programs that change live challenge state.

Because agentic AI is now good at source review and exploit scripting, the competition also includes
**defense in depth, enforced in person**:

1. **In-person enforcement — the biggest lever.** The event is on-site and proctored. We require
   **screen-share / replay for anyone contending for prizes** and disallow autonomous agents in the
   room. This is enforcement you simply cannot do for an online CTF — and it's the solution OtterSec's
   own fund post highlights.
2. **A layered anti-agent arsenal (supporting the real challenges, not replacing them):**
   - **Physical / hardware gates** — a **passkey (secp256r1 / SIMD-0075) touch** + wallet human-approve
     to land one winning exploit; an autonomous agent cannot produce Face ID / a YubiKey tap.
   - **Browser-gated challenge surfaces** — Turnstile and session binding remove the cheap
     `WebFetch`/headless scraping path, while still allowing normal human browser use.
   - **Limited high-value attempts and live state** — brute-force/autonomous trial loops are expensive;
     teams must decide when an exploit window is actually worth using.
   - **Prompt-injection canaries and telemetry** — non-load-bearing signals for lazy autonomous-agent
     workflows, reviewed by organizers instead of used as automatic disqualification.
   - **Dynamic, rotating environments + relative scoring** — a one-shot solve isn't enough; you must
     adapt live as state shifts and others play.
3. **Honest, not hype.** We don't claim "AI-proof." We **validate by playtest** — all-human vs
   AI-assisted vs autonomous-agent teams — and share the data.

4. **An enforceable integrity program.** Challenge resistance is backed by precise participant rules,
   explicit acknowledgement, immediate flag submission, privacy-bounded solve telemetry, author-led
   technical verification for suspicious/prize-contending solves, consistent evidence thresholds, and
   an appeal process. Timing, canaries, and writing style are review signals—not automatic guilt.

The principle: keep the security bug **real and deep**, then put the anti-AI in the **access/action
layer**. Asking ChatGPT a question is fine; handing the whole problem to an autonomous agent should not
be enough to finish or win.

---

## The four challenges — each Solana-real, each a *different* anti-AI mechanism

| # | Challenge | Real-CTF style | Real Solana bug | Anti-AI mechanism |
|---|---|---|---|---|
| 1 | **Reward Sniper** | live DeFi KOTH / searcher game | DLMM-style JIT reward-accounting | dynamic rotating state + relative scoring + scarce high-value attempts |
| 2 | **IMPRINT** | passkey-wallet bug bounty | secp256r1/WebAuthn owner-binding bug | **physical passkey touch** (Face ID / YubiKey) + wallet human-approve |
| 3 | **SIGNET** | N-day / patch-diffing | stale pre-fix CPI/PDA authority bug discovered via silent patch | source archaeology + per-team exploit target + live on-chain drain |
| 4 | **DRIFT** | bytecode RE / runtime pwn | localnet vault with adversarial runtime assumptions | no-source RE + reproducible exploit replay |

**Backstop:** on-site proctoring — screen-share / replay for anyone contending for prizes.
**Common to all four:** a genuine Solana security bug + a **live per-team on-chain exploit or
technical submission**. No challenge is solved by reading a string, scraping metadata, or submitting a
static answer.

*(Grounded in current Solana: [SIMD-0075 secp256r1 passkey precompile](https://www.helius.dev/blog/solana-passkeys),
live on mainnet since June 2025.)*

---

## Who's running it

- **Superteam India** — the organizing backbone.
- **[Aabis]** — early Superteam member since 2021, 2x Solana/Colosseum global hackathon winner, ran
  India's first Solana security CTF.

---

## Sponsorship

**What a sponsor gets:**
- Brand in the room and on the **big-screen leaderboard** all day.
- **Recruiting access** to 50+ vetted, security-curious Solana developers.
- Optional: **co-design or judge a challenge** (your researchers), and a **co-tweet** to your audience.
- A short guest talk / office-hours slot during the event.

**Tiers (flexible — cash, credits, or in-kind):**
- **Title sponsor:** [$X]
- **Challenge sponsor:** [$Y] — your name on one challenge (e.g., IMPRINT / Reward Sniper).
- **Supporting sponsor:** [$Z]

**Ask of OtterSec:** [e.g., $____ / a challenge bounty / a researcher to co-design or judge IMPRINT].

**Current support:** Superteam. In conversation: [only list confirmed/active — e.g., Neodyme, Squads].

**Budget:** total ~[$____] ([$____] prizes / [$____] infra).

---

## Contact

[Name] · [email] · [Telegram] · aabis.dev
