# CTF26 clean-room playtest protocol

Use this protocol before declaring a challenge event-ready. A green unit test proves implementation
correctness; it does not prove that a player can discover the intended mechanism or that an autonomous
agent experiences meaningful friction.

## Test conditions

Run each challenge with fresh identities and state. Testers receive exactly the public portal launch,
downloaded artifact/starter, public UI, and public guide. Do not give them repository access,
organizer source, deployment variables, checker source, reference traces, or this document's answer
notes.

For the current public-practice deployment, start from the portal so the anonymous launch identity and
challenge session are created through the same path a player uses:

```bash
open https://superteamctf.vercel.app
```

The retired scored event used signed, audience-bound launch tickets. Reward Sniper should be opened
only when the tester is ready because its participant state begins with the first session.

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
That protocol comes from repeated false starts where agents inherited completed participant state or mistook
launch, HTTP success, or an existing rank-one score for their own solve.

## Evidence to capture

For every run, retain:

- participant identity and challenge version or artifact hash;
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
- Use at least two competing participants or organizer bots; an empty scoreboard is invalid evidence.
- Start everyone from the synchronized waiting room.
- Give no engine source or exact optimizer.
- Measure practice actions, tickets wasted, reveal failures, normalized round share, and performance
  after the market seed/regime changes.
- Require the tester to explain the stale-window/JIT accounting relationship and submit the searcher
  or observation harness used.

Provisional launch gate: a prepared human participant can complete the interaction reliably after the
practice round; nobody loses a run solely to ticket or session recovery; a static agent cannot produce
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
with no more than the second nudge; the same transaction fails under another participant; and an autonomous
agent must both identify the stale strategy boundary and deploy/invoke a working Solana program.

### DRIFT

- Give only the stripped ELF, manifest, generic client, browser workspace, and public README.
- Confirm the ELF hash is
  `b508a98d849a33f760a22889241f7356c034d956cf79be376b2260344a60b0f5`.
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

- Start with a fresh participant ID and no stored passkey or target. Confirm first launch creates one
  deterministic target and self-enrolls one platform passkey.
- Give only the portal console, assigned target, public program and IDL material, and a
  participant-selected wallet. Confirm the browser, passkey, and wallet approval path before timing.
- Suggested timebox: 90 minutes. Record the first legitimate passkey action, the owner-binding
  hypothesis, assertion attempts, wallet approvals, and any virtual-authenticator or cross-vault failure.
- A solve is only the checker accepting the assigned target's validated net reserve loss after the live
  passkey assertion and Solana wallet approval. A written exploit path can receive explicitly defined
  partial credit, but must never be confused with a full solve.

Provisional launch gate: two qualified human testers complete the live path without organizer
intervention; refreshes preserve the same target and credential; and an assertion for another vault is
rejected. Virtual authenticators are an accepted limitation of self-enrollment and must be evaluated
through the autonomous-agent arm rather than described as structurally blocked.

### LAST STOP

- Provision a fresh SSH password, participant identity, and ephemeral journey for each run. Give only the
  portal handoff, terminal, public command guide, and the visible station clues.
- Suggested timebox: 20 minutes. Record the first PDA hypothesis, inspection commands, hint requests,
  wrong route/card attempts, disconnect/reconnect behavior, and the final native replay receipt.
- Ask the tester what the two service replays communicated before giving a hint. Confirm a human can
  compare the motion without a persistent final frame, and confirm the terminal transcript never
  prints the seed schemas, required card address, or concatenated route.
- Confirm the tester discovers both replays from the room's `Inspect:` line or bare `inspect`; failure
  to guess an undocumented object name is an interface defect, not legitimate challenge difficulty.
- A solve is only the server-issued receipt after the exact SBF replay reaches both the open-line and
  arrival states. A copied receipt, stale completed journey, or client-reported arrival is invalid.

Provisional launch gate: beginner-friendly testers can complete the journey with the published hint
ladder; a fresh password starts clean state; cross-participant cards do not work; and a static-only agent cannot
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

### PLAYER TWO

- Start from a fresh participant cabinet and give only the arcade, its receipt printer, scanner, and public
  chain links. Do not explain the credential generation bug.
- Suggested timebox: 30 minutes. Record receipt inspection, pass scans, duplicate-pass attempts,
  foreign-holder attempts, and the two distinct passes finally seated in the readers.
- Relaunch after provisioning and after completion. The same cabinet must return, and a missed score
  delivery must recover from authoritative completion state.
- A solve is only the native verifier opening the jackpot for two different active generations held by
  the same assigned participant holder.

Provisional launch gate: two human testers can discover the stale credential from ordinary migration
evidence; duplicate, unknown, and foreign credentials fail; concurrent jackpot requests produce one
completion; restart and relaunch preserve the cabinet and result.

### THE BROADCAST

- Give only the hosted workbench and the ordinary wallet authorization flow. Do not expose the winning
  receipt index, scalar relationship, or organizer construction notes.
- Suggested timebox: 45 minutes. Record proof-of-work issuance, authorization variants, decoded receipt
  alternatives, rejected messages, replayed proof attempts, and the completed claim count.
- Exercise the same claim body concurrently and reuse its proof. Only one request may consume that proof,
  and wallet rate limits must be shared across replicas through Redis.
- A solve is only the service completing the required distinct accepted signatures and persisting the
  final receipt for the assigned participant.

Provisional launch gate: accepted variants come from one real wallet authorization; ordinary duplicate
bytes do not progress; proof-of-work is body-bound and single-use; session restart preserves progress;
and a missed solve event is repaired by the private completion read.

### EVIDENCE ROOM

- Give only the evidence desk, disposable participant wallet, visible chain records, and the public challenge
  brief. The service permits up to four treasury-funded cases per participant before operator review.
- Suggested timebox: 45 minutes. Record each allocated case, factory failure, target capture, decoy
  activity, expiry, and funded attempt.
- Force one RPC outage, one failed factory batch, a page close during resolution, and concurrent batch
  requests. The participant must recover without gaining extra funded attempts or becoming permanently stuck.
- A solve is one uncontaminated capture verified from live chain state.

Provisional launch gate: the attempt budget cannot be exceeded; failed batches expire; decoy activity
invalidates the batch; restart preserves instances and attempts; concurrent requests do not duplicate
funding; and portal recovery restores a missed completion event.

### SECOND KEY

- Start with a fresh collateral desk instance and give only the lender note, chain drawer, pledge action,
  and disposable participant key. Do not name Token-2022 or the permanent delegate extension.
- Suggested timebox: 45 minutes. Record pledge, account inspection, custody movement, wrong destination or
  authority attempts, and the finalized removal transaction.
- Close the browser immediately after the successful chain transaction, then return to the portal. The
  private completion check must reconcile chain state without a final browser poll.
- A solve is only an outstanding advance with the exact receipt removed from lender custody and returned
  to the assigned participant source account.

Provisional launch gate: another participant wallet or mint cannot satisfy the checker; repeated pledge and
provision requests are idempotent; restart preserves the loan; the health check fails when chain access
fails; and portal recovery discovers a completed on-chain state.

### THE CHAMBER

- Give only the hosted surface and the program interface. Hand the participant the venue card exactly as
  a real attendee receives it: a blank PVC card, with no verbal explanation that it is readable.
- Use a card from the production batch. Confirm the participant can read its NDEF Text record with NFC
  Tools or another NDEF reader, decode the Base64 value into exactly 64 bytes, and derive
  `BVR7YbDQiQB25nZmbAUFtLAQpQKapoaY9zMaJMTP1KC2` before attempting lock two.
- Do not name cross-program invocation, `get_stack_height`, or "deploy a program" anywhere in the brief
  or the room. The vague `ThirdLockResists` message is the only feedback lock three gives.
- Suggested timebox: 60 minutes. Record wallet registration, the first-lock transaction, how long the card
  discovery takes, every direct third-lock attempt, and the deployed caller program ID.
- Close the browser immediately after the successful CPI, then return to the portal. The private
  completion check must reconcile chain state without a final browser poll.
- A solve is only all three locks standing open on the participant's own PDA. The service
  derives that from the locks; the account's `chamber_open` byte is never written by the
  deployed program and must not be treated as the signal.

Provisional launch gate: a second wallet cannot be bound to a registered participant and a registered
wallet cannot be claimed by a second participant; `create_user` is idempotent across repeated
registrations and a restart; a direct (non-CPI) third-lock call always fails; the health check fails when
the RPC or the admin payer reserve cannot cover the field; and portal recovery discovers a completed
on-chain state.

Because one shared hidden key serves the whole field, run the card-discovery observation with the
*first* cohort. Once any playtester has seen the key, later runs no longer measure lock two honestly.

## Event-wide system run

Run at least one full rehearsal with the final roster, production-like Redis, final field size, and all
eleven services. Include a small concurrent human cohort, then run the repository's 50-participant HTTP
load simulation with the documented spam bursts and service concurrency bounds.

- Confirm every participant must acknowledge the same current rules version before launch.
- Confirm each launch ticket is one-use, audience-bound, and cannot open another challenge.
- Restart each stateful service during active play and verify participant state, replay protection, attempt
  budgets, and completed results survive.
- Drop the leaderboard ingest endpoint during one valid solve per challenge. Restore it, revisit the
  portal, and verify every authoritative completion path repairs the board or can be safely re-submitted.
- Attempt cross-participant signatures, receipts, accounts, wallets, and launch cookies. None may progress or
  reveal another participant's private material.
- Set a stale configured field size below the actual scoring participant count. The leaderboard must stay live,
  preserve point bounds, and report the effective field size.
- Exercise desktop, narrow mobile, keyboard-only, reduced-motion, slow-RPC, expired-session, and service
  outage states. No primary action or error message may be clipped, obscured, or falsely report success.
- Confirm production refuses missing Redis, weak secrets, insecure origins, development launch modes,
  and an absent participant roster unless open staging was explicitly enabled.

## Decision rubric

Mark a challenge mechanically ready only when the intended live solve and realistic negative controls
pass. Mark it player-ready only after clean-room humans can solve without organizer improvisation.
Describe it as AI-resistant only when the agent is forced through the intended live mechanism; never
use “AI-proof” merely because one agent timed out, followed a decoy, lost browser state, or stopped at
an ambiguous success response.

Any unintended auth path, leaked organizer artifact, reusable cross-participant solve, client-reported state
accepted by a checker, or player package missing a documented prerequisite is a release blocker.

Before launch, each challenge author must also produce:

- expected human workflow and observable milestones;
- three mechanism questions that cannot be answered by restating the brief;
- one safe variation (amount, account, order, seed, clock, or market regime) for reproduction;
- known legitimate alternate paths and expected evidence for each;
- examples of ordinary wrong submissions versus plausible but technically non-derived submissions;
- evidence fields required by `integrity.md`.
