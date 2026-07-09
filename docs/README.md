# Docs — CTF26 Knowledge Graph

Design, research, and planning for the next Superteam Solana security CTF. Read in order for the full
story; jump by topic below.

| Doc | What it is |
|---|---|
| [`00-anti-ai-design-principles.md`](00-anti-ai-design-principles.md) | **Read first.** The authoritative doctrine: the reframed goal (kill autonomous pay-to-win, not make the bug agent-proof), the two-layer model (put anti-AI in the *access/act* layer, keep the bug deep), the lever menu (hardware-auth passkey/secp256r1 ★, wallet approve, venue-local, WebGL, on-site proctoring), the design laws, and the failure log. |
| [`01-past-ctf-learnings.md`](01-past-ctf-learnings.md) | What failed in the first CTF (11/14 flags captured with zero transactions), the non-negotiable architecture (checker-side HMAC flag, per-team instances, no flags in public artifacts), Solana bug-class themes, and an exploit ladder. |
| [`02-ai-resistance.md`](02-ai-resistance.md) | AI-resistance techniques and human-reasoning gates. §18 is the Settlement Room 73 red-team case study — agents beat every memo-forensics layer → build real exploits instead. |
| [`03-challenge-explorations.md`](03-challenge-explorations.md) | Two explored directions (merged): **Part A** OSINT/visual hybrids + the adversarial self-test showing passive-artifact puzzles lose to agents; **Part B** source-archaeology / patch-diffing (N-day) with Solana as the hard spine. Source of secondary/companion ideas. |
| [`04-flagship-design.md`](04-flagship-design.md) | **Current direction + flagship.** Event framing, relative-scoring decision, AI policy, and the flagship **IMPRINT** (a real secp256r1/WebAuthn Solana bug whose winning action requires a hardware **passkey touch** an autonomous agent can't produce). The earlier relative-scoring candidates are demoted to components. |
| [`05-sponsorship.md`](05-sponsorship.md) | Sponsor outreach: the OtterSec "Save CTFs Fund" anchor, the full target tracker + contacts, and an archive of every message sent. |
| [`06-knowledge-base.md`](06-knowledge-base.md) | **Working memory.** Current thesis, Meteora/OtterSec-style reviewer context, Dev Cave benchmark notes, final slate rationale, open-source Solana bug leads, and build implications. |
| [`07-build-review.md`](07-build-review.md) | Three-pass implementation review of the four challenge apps: doctrine fit, tests/builds, and remaining event-readiness gaps. |

**The final four-challenge slate** — each Solana-specific, each replicating a different real-CTF style, each carrying a *different* anti-AI mechanism so they don't overlap:

| [`challenges/reward-sniper.md`](challenges/reward-sniper.md) | **Challenge 1 — dynamic DeFi.** Operate a changing market and secure value under pressure. The player-facing catalog intentionally omits the accounting edge. |
| [`challenges/imprint.md`](challenges/imprint.md) | **Challenge 2 — authorization.** Investigate an unfamiliar vault withdrawal and prove what the protocol accepts. The player-facing catalog intentionally omits the verification flaw. |
| [`challenges/signet.md`](challenges/signet.md) | **SIGNET — deployment research.** A live program and its surrounding project materials do not agree; recover the reserve through a verified state transition. The detailed research narrative remains organizer-only. |
| [`challenges/overclock.md`](challenges/overclock.md) | **DRIFT — reverse-engineering + runtime.** Closed-source Solana program on a per-team localnet; reconstruct its behavior and exploit the runtime assumptions. The specific value path is intentionally omitted from the player-facing catalog. |

**New design draft, not part of the official slate yet:**
[`DRESS REHEARSAL`](challenges/dress-rehearsal.md) is a Loader-v3 release-governance pwn: a committee
reviews safe bytes in a team-controlled upgrade Buffer, execution later trusts the approved Buffer
address without rebinding its current payload, and the replacement inherits the trusted Program ID's
PDA namespace. Its real-loader feasibility spike is the go/no-go gate before implementation.

[`WAR ROOM`](challenges/war-room.md) is a second design draft for a defensive live-response finale.
It is not in the official slate; its real-time loop, guardian actions, and scenario correctness still
require a feasibility spike.

## Direction in one paragraph

Jeopardy is broken by agentic AI and fixed points. The arc landed here: **you cannot make a bug
agent-proof, so don't try.** Keep the Solana security bug **deep and real**, and put the anti-AI in the
**access/action layer** — anchored by a **hardware passkey touch (secp256r1/WebAuthn)** an autonomous
agent physically cannot produce, plus wallet-approve, relative scoring, live state, local RE, and **on-site
proctoring**. The goal is not "AI can't understand it" but **"the autonomous loop can't complete — a
human must be in the loop."** The flagship slate is in **`04` §4**; the doctrine is `00`; the sponsor
tracker is `05`; the consolidated working memory is `06`.

## Related

- The two Next.js apps (the old **Settlement Room 73** challenge prototype + the registration
  **portal**) live in [`../apps/`](../apps/). See the root [`README.md`](../README.md) to run them.
