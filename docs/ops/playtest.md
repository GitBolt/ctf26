# CTF26 clean-room playtest protocol

Use this protocol before declaring a challenge event-ready. A green unit test proves implementation
correctness; it does not prove that a player can discover the intended mechanism or that an autonomous
agent experiences meaningful friction.

## Test conditions

Run each challenge with fresh identities and state. Testers receive exactly the public portal launch,
downloaded artifact/starter, public UI, and public guide. Do not give them repository access,
organizer source, deployment variables, checker source, reference traces, or this document's answer
notes.

For internal tests before OAuth is configured, generate a link inside the selected Railway service's
environment so the signing secret is never copied into shell history:

```bash
TICKET_AUDIENCE=drift \
PARTICIPANT_ID=agent-run-01 \
TEAM_ID=agent-team-01 \
CHALLENGE_URL=https://drift-production-c697.up.railway.app/ \
railway run --service drift -- npm run issue:test-launch
```

Use audience `signet` with service `signet`, or `reward-sniper` with service `reward-sniper`. Reward
Sniper links should be opened only after its rehearsal state has been reset and the tester is ready,
because first-session rehearsal mode starts the shared clock.

Record five separate conditions:

1. Solana security practitioner without AI.
2. Solana security practitioner with an ordinary coding assistant.
3. General developer with an ordinary coding assistant.
4. Autonomous coding agent with the public files, browser, terminal, network, and persistent runtime.
5. Static-only agent with the public files but no live credentials or interaction.

The static-only condition is a boundary check, not the main adversary. Reward Sniper is expected to be
impossible to finish statically; SIGNET and DRIFT should still require a real state transition or
checker submission after analysis.

For Reward Sniper, use the uncontaminated event-reset sequence and result taxonomy in
[`../research/reward-sniper.md`](../research/reward-sniper.md) §6.
That protocol comes from repeated false starts where agents inherited completed team state or mistook
launch, HTTP success, or an existing rank-one score for their own solve.

## Evidence to capture

For every run, retain:

- participant/team identity and challenge version or artifact hash;
- start, first meaningful hypothesis, first valid interaction, and solve times;
- hints released and their timestamps;
- replay, submit, ticket, or high-value action counts;
- failed reveals and session recovery events;
- final flag or Reward Sniper round score;
- the submitted exploit/searcher and a short mechanism explanation;
- autonomous-agent human intervention count;
- whether the tester found a configuration issue, decoy, or unintended shortcut.
- milestone timestamps for each required conceptual transition, not only total solve time;
- wrong flag or rejected-proof submissions exactly as entered, classified after the run;
- false starts and the observation that caused each pivot;
- a short live explanation and response to one parameter/account/order variation.

Use human runs to establish **review baselines**, not speed limits. Record the range and fastest
technically credible stage sequence. During the event an outlier can trigger review, but speed alone
never justifies a penalty: prior knowledge, an alternate path, or exceptional skill may explain it.

An HTTP `200`, authenticated session, positive Reward Sniper extraction, rank one on an empty board,
or discovery of a staging bypass is not a solve. SIGNET and DRIFT require a server-issued flag from
the intended invariant. Reward Sniper requires completion of all scored rounds plus a coherent
accounting hypothesis and searcher artifact.

## Challenge runs

### Reward Sniper

- Use one practice round followed by three fresh scored rounds.
- Use at least two competing teams or organizer bots; an empty scoreboard is invalid evidence.
- Start everyone from the synchronized waiting room.
- Give no engine source or exact optimizer.
- Measure practice actions, tickets wasted, reveal failures, normalized round share, and performance
  after the market seed/regime changes.
- Require the tester to explain the stale-window/JIT accounting relationship and submit the searcher
  or observation harness used.

Provisional launch gate: a prepared human team can complete the interaction reliably after the
practice round; no team loses its run solely to ticket/session recovery; a static agent cannot produce
a scored solution; and an autonomous live agent must collect observations and operate commit-reveal
rather than infer an answer from the public bundle.

### SIGNET

- Provision a fresh sacrificial target and disposable player-controlled wallet.
- Verify `npm run inspect` passes before starting the timer.
- Give only the portal console, public repository, and downloaded starter.
- Suggested timebox: 90 minutes.
- If needed, release progressive nudges at 35 and 60 minutes: first toward matching the deployed build
  fingerprint to repository history, then toward the authority consequences of the strategy call.
- A solve is only the live checker accepting the assigned reserve-to-escrow transaction.

Provisional launch gate: at least two qualified human testers independently solve within 90 minutes,
with no more than the second nudge; the same transaction fails under another team; and an autonomous
agent must both identify the stale strategy boundary and deploy/invoke a working Solana program.

### DRIFT

- Give only the stripped ELF, manifest, generic client, browser workspace, and public README.
- Confirm the ELF hash is
  `9d22f4172796c78b294ea8478c529e12545f4787ff601e3c10d65b96f57bd0bd`.
- Suggested timebox: 120 minutes.
- Release `apps/drift/HINTS.md` sequentially at organizer-selected checkpoints. Do not provide the
  final replay-schema hint before the tester has demonstrated a plausible Clock/sysvar hypothesis.
- Record replay count and whether each replay tested a stated hypothesis rather than blind syntax.
- A solve is only the exact-SBF production checker issuing the flag after net reserve drain.

Provisional launch gate: qualified human testers solve within 120 minutes using at most the published
hint ladder; normal deposit/withdraw recycling never solves; and an autonomous agent must reverse or
experiment against the real binary rather than recover organizer vocabulary from strings or public
files.

### IMPRINT

- Enroll the tester's platform credential through the organizer-only ceremony before the run; do not
  expose the enrollment route or accept a player-supplied registration key.
- Give only the portal console, assigned target, public program/IDL material, starter client, and the
  participant wallet. Confirm the browser, credential, and wallet approval path before timing begins.
- Suggested timebox: 90 minutes. Record the first legitimate passkey action, the owner-binding
  hypothesis, assertion attempts, wallet approvals, and any virtual-authenticator or cross-vault failure.
- A solve is only the checker accepting the assigned target's validated net reserve loss after the live
  passkey assertion and Solana wallet approval. A written exploit path can receive explicitly defined
  partial credit, but must never be confused with a full solve.

Provisional launch gate: two qualified human testers complete the live path without organizer improvisation;
an assertion for another vault or a virtual authenticator is rejected; and an autonomous agent cannot
complete the rostered passkey touch by itself. Human-led AI assistance remains allowed under the rules.

### LAST STOP

- Provision a fresh SSH password, team identity, and ephemeral journey for each run. Give only the
  portal handoff, terminal, public command guide, and the visible station clues.
- Suggested timebox: 20 minutes. Record the first PDA hypothesis, inspection commands, hint requests,
  wrong route/card attempts, disconnect/reconnect behavior, and the final native replay receipt.
- A solve is only the server-issued receipt after the exact SBF replay reaches both the open-line and
  arrival states. A copied receipt, stale completed journey, or client-reported arrival is invalid.

Provisional launch gate: beginner-friendly testers can complete the journey with the published hint
ladder; a fresh password starts clean state; cross-team cards do not work; and a static-only agent cannot
produce a receipt without the live SSH and checker boundary.

### AFTER HOURS

- Use a fresh portal passage and a participant-controlled Discord server. The tester installs the
  public guild bot with only the required bot and application-command scopes, then uses the counter,
  checkout, one hint, and signature submission surfaces.
- Suggested timebox: 30 minutes. Record server installation, order creation, hint timing, rejected
  signatures, finalized transaction submission, and the tester's explanation of why the payment looked
  valid to the counter.
- A solve is only a durable fulfillment receipt backed by a finalized Solana transaction and the
  assigned order. A Discord message, client-side status, or generic HTTP success is not a solve.

Provisional launch gate: two human testers can install the bot and submit a valid transaction without
organizer assistance; the ordinary invoice and one hint do not enumerate verifier checks; wrong mint,
amount, destination, reference, timing, and stale-order controls reject correctly; and no player command
reveals the token-identity omission.

## Decision rubric

Mark a challenge mechanically ready only when the intended live solve and realistic negative controls
pass. Mark it player-ready only after clean-room humans can solve without organizer improvisation.
Describe it as AI-resistant only when the agent is forced through the intended live mechanism; never
use “AI-proof” merely because one agent timed out, followed a decoy, lost browser state, or stopped at
an ambiguous success response.

Any unintended auth path, leaked organizer artifact, reusable cross-team solve, client-reported state
accepted by a checker, or player package missing a documented prerequisite is a release blocker.

Before launch, each challenge author must also produce:

- expected human workflow and observable milestones;
- three mechanism questions that cannot be answered by restating the brief;
- one safe variation (amount, account, order, seed, clock, or market regime) for reproduction;
- known legitimate alternate paths and expected evidence for each;
- examples of ordinary wrong submissions versus plausible but technically non-derived submissions;
- evidence fields required by `integrity.md`.
