# CTF26 documentation

The documentation is organized by purpose. The current event material is separate from retained
research and historical design context so handoff readers can distinguish the shipped system from
earlier exploration.

## Current event

CTF26 is an individual event with ten shipped challenges: Reward Sniper, IMPRINT, SIGNET, DRIFT,
LAST STOP, AFTER HOURS, PLAYER TWO, THE BROADCAST, EVIDENCE ROOM, and SECOND KEY. The shared
event systems are Google authentication, participant tickets, scoring, the leaderboard, passive
integrity observations, and the organizer portal. Start with `strategy/event.md`, then use the
operations documents for the live configuration and runbook.

## Strategy

- [`strategy/anti-ai.md`](strategy/anti-ai.md): the design doctrine. Read this first.
- [`strategy/event.md`](strategy/event.md): current event direction and the official challenge slate.
- [`strategy/knowledge.md`](strategy/knowledge.md): current operating model plus retained historical reasoning.
- [`strategy/prospectus.md`](strategy/prospectus.md): historical sponsor-facing prospectus.

## Research

- [`research/past-ctf.md`](research/past-ctf.md): historical previous-event learnings and Solana themes.
- [`research/ai-resistance.md`](research/ai-resistance.md): retained AI-resistance research and human gates.
- [`research/challenge-ideas.md`](research/challenge-ideas.md): retained exploration and rejected-format evidence.
- [`research/reward-sniper.md`](research/reward-sniper.md): historical Reward Sniper agent-resistance case study.

## Operations

- [`ops/final-audit.md`](ops/final-audit.md): final system audit, fixes, scoring, and launch gates.
- [`ops/staging.md`](ops/staging.md): internal deployments, verification, and historical build review.
- [`ops/playtest.md`](ops/playtest.md): clean-room launch criteria and required evidence.
- [`ops/integrity.md`](ops/integrity.md): prevention, detection, adjudication, and event-day operations.
- [`ops/sponsors.md`](ops/sponsors.md): historical sponsor pipeline and outreach archive.

## Challenge specs

The official slate has ten individual specifications:

- [`challenges/reward-sniper.md`](challenges/reward-sniper.md): dynamic DeFi.
- [`challenges/imprint.md`](challenges/imprint.md): passkey-gated authorization.
- [`challenges/signet.md`](challenges/signet.md): deployment research.
- [`challenges/drift.md`](challenges/drift.md): reverse engineering and runtime.
- [`challenges/last-stop.md`](challenges/last-stop.md): terminal PDA journey.
- [`challenges/after-hours.md`](challenges/after-hours.md): Discord checkout.
- [`challenges/player-two.md`](challenges/player-two.md): credential-lifecycle arcade.
- [`challenges/the-broadcast.md`](challenges/the-broadcast.md): THE BROADCAST, wallet-signature cryptography.
- [`challenges/evidence-room.md`](challenges/evidence-room.md): EVIDENCE ROOM live account-lifecycle challenge.
- [`challenges/second-key.md`](challenges/second-key.md): Token-2022 collateral custody.

## Feedback and source material

- [`feedback.md`](feedback.md): all organizer-requested human feedback, grouped by challenge.
- [`source/anti-agent-measures.docx`](source/anti-agent-measures.docx): original external source material.

The root [`README.md`](../README.md) covers application setup and local verification.
