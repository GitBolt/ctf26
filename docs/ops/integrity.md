# Event Integrity and Anti-Agent Enforcement

Updated: 2026-07-22

This is the operational companion to the challenge-design doctrine in
[`../strategy/anti-ai.md`](../strategy/anti-ai.md). It coordinates the three
things the event must accomplish:

1. build challenges that resist autonomous completion;
2. detect participants who still use prohibited autonomous agents;
3. run rules, telemetry, review, sanctions, appeals, and event operations as one fair system.

The goal is not automated AI detection. Reliable universal AI detection does not exist. The goal is a
defensible process based on clear notice, minimal necessary telemetry, corroborating evidence, technical
verification, consistent decisions, and appeal.

---

## 1. Threat model and policy

Choose the competition policy before designing enforcement. Recommended prize-track boundary:

> General conceptual assistance is allowed. An AI system may explain public concepts, but it may not
> receive challenge files, screenshots, source, binaries, account data, logs, endpoint output, derived
> artifacts, or a challenge-specific task; operate a browser, terminal, wallet, RPC, debugger, or HTTP
> client; construct or submit a scored exploit; or make challenge-solving decisions for a participant.

The final rules must explicitly classify search AI summaries, IDE completion versus agent mode,
translation/accessibility tools, concept questions, challenge-derived material, screenshot-to-AI flows,
AI-generated scripts, browser/terminal/wallet agents, model-API scripts, and outside human assistance.
Do not rely on “against the spirit” alone. Require every participant to acknowledge the exact rules version
at registration and before the first scored launch.

### Participant responsibility

Recommended rule: each participant is responsible for every submitted flag, proof, transaction, and
score under their identity. For a reviewed solve, the participant must identify any outside human
assistance and explain the provenance of every submitted artifact. Another person must never submit
work through the participant's account.

### Immediate submission

For flag challenges, prohibit flag hoarding: submit a recovered flag promptly. This improves leaderboard
accuracy and makes timing evidence interpretable. Allow short delays for connectivity or confirming the
correct session. Continuous/KOTH challenges already timestamp actions and reveals; delayed offline score
claims should not be accepted.

---

## 2. Pillar one — prevent autonomous completion

Use the doctrine in [`../strategy/anti-ai.md`](../strategy/anti-ai.md): real Solana security core;
per-participant state; randomized targets; strict state-transition/replay checkers; server-generated
flags; no answers in public artifacts; physical
passkey/wallet approval where authentic; live state, scarce attempts, relative scoring, and in-person
prize-contender review.

Turnstile, video, canvas, novelty, decoys, and prompt injection are not universal security boundaries.
Prompt injection may be omitted when it does not fit the challenge. Reward Sniper nevertheless validates
a useful hosted-challenge pattern when autonomous operation is explicitly prohibited: make the policy
discoverable on routes agents actually inspect, bind a disclosure marker to participant/event identity,
record disclosure first-party before mirroring it to Discord, and retain independent behavioral detection
for agents that ignore the policy. See `../research/reward-sniper.md`.

CTF26 operational default as of 2026-07-16: every browser-hosted scored challenge exposes the common
disclosure-first policy routes and reports participant-bound disclosures into the central organizer
feed. LAST STOP and AFTER HOURS publish the same stop policy on machine-discovery routes without adding
it to terminal help or Discord slash commands. Challenge-specific prevention and detection remains
separate from the exploit boundary.

---

## 3. Pillar two — detect and triage

Detection answers “which solve warrants human review?”, not “did a model write this?”

### Minimum event log

Record with synchronized server time:

- rules version and acknowledgement;
- participant, challenge, session, target, and artifact version or hash;
- launches, credential issuance, and hints viewed;
- flag/proof submissions exactly as entered and checker reason codes;
- accepted transactions, replays, commits/reveals, and high-value actions;
- rate-limit, replay, cross-participant, decoy, and safe-canary events;
- scoreboard and administrative changes;
- review trigger, evidence, decision, reviewers, and appeal result.

Do not collect private keys, cookies, local files, browser history, environment variables, unrelated
device contents, or covertly invasive telemetry. Restrict access and define retention before launch.

The shared challenge telemetry records only authenticated identity, challenge action name, category,
timestamp, outcome class, coarse client class, and UI correlation. It does not forward request bodies,
flags, transaction signatures, wallet addresses, command arguments, cookies, tokens, or full IP
addresses. Per-participant histories are bounded. A suspicion record never changes score, access, or
challenge state automatically.

Normal CTF behavior is explicitly non-evidence by itself. This includes curl and custom clients,
Playwright, direct API use, endpoint enumeration, fuzzing, brute force, repeated failures, fast polling,
few UI events, missing policy reads, and minimal use of supplied replay tools. Those patterns may remain
in the activity history, but they cannot establish prohibited AI use without corroboration.

The portal records the first challenge launch durably for each participant and event generation. A
signed completion received less than `FAST_SOLVE_REVIEW_SECONDS` later, 300 seconds by default, opens a
passive observation. This timing signal never changes score, access, rank, or finalization. A missing
launch record creates no observation, reloads do not reset the first-launch clock, and failed delivery
to the telemetry service remains a bounded Redis record and never blocks a valid solve.

Participant-authenticated interface navigation is also non-evidence by itself. Script identifiers,
headless-browser identifiers, missing UI events, and interface-asset requests remain in the activity
profile but never create a suspicion or send a webhook.

The activity profile retains only categorical
Fetch Metadata, same-origin referrer/origin relationships, broad `Accept` class, and client-hint
presence. It never stores raw referrers, origins, headers, URLs, or device fingerprints. Missing or
contradictory request context never opens a case because ordinary redirects, privacy settings,
referrer policies, browsers, and hosting proxies can all change these headers.

Browser challenges silently record an authenticated application-boot event through their existing UI
telemetry channel. Missing application boot is timeline context only and never creates a suspicion or
webhook. The beacon is fail-open: failure never blocks loading, changes the challenge, delays an action,
alters a score, or displays participant-facing integrity copy. It is evidence that the shipped
interface executed, not proof that a human controlled it. Browser agents can execute the application
and satisfy the beacon.

### Human workflow baselines

Clean-room human tests must measure the sequence:

```text
launch → first hypothesis → first valid interaction → mechanism discovery
       → exploit construction → successful transition → submission
```

Record ranges, false starts, and legitimate alternate paths. These are review baselines, not minimum
legal times. Prior knowledge or exceptional skill may explain an outlier.

### Wrong-submission analysis

Classify wrong flags or proofs as typo or encoding error, wrong participant or session, public example, known decoy or
stale value, random-format guess, semantically plausible value with no derivation, or repeated exact
agent-only marker. A thematic but non-derived flag was RITSEC's strongest reported indicator. It should
trigger rapid review and possibly a temporary scoreboard hold, not bypass adjudication.

### Evidence tiers

**Low confidence — log or prioritize:** fast solve/burst; unusual user agent; fetching agent-policy
resources; polished or generic writeup; stereotyped script formatting; one canary event; one unexplained
wrong submission.

**Medium confidence — open review:** several independent low signals; timing inconsistent with the
interaction trace and no credible alternate path; repeated decoy/canary actions; plausible invented
flags; exact hidden agent-only phrases; inability to explain artifact provenance or exploit mechanics;
automated-looking trace with normal human milestones absent; or a known AI client identifier attached
to an authenticated challenge action. User-agent evidence is spoofable and remains review evidence, not
a finding.

**High confidence — contain, then adjudicate:** admission or participant-provided transcript; an agent
directly operating the scored service under participant credentials; challenge-specific output demonstrably
produced through a prohibited workflow; repeated agent-only actions plus failed technical defense and
corroborating telemetry; an outside operator or AI-lab submission competing contrary to explicit rules.

No prose classifier, timing threshold, IP address, or canary hit is independently conclusive.

### Triage cadence

- Alert continuously only on cross-participant reuse, replay, credential abuse, or high-confidence actions.
- Review prize positions and anomalies at scheduled intervals.
- After scoreboard freeze, review all prize contenders and category winners.
- State honestly if enforcement covers only the competitive top of the board.

---

## 4. Pillar three — adjudicate fairly

### Author-led solve defense

The challenge author or a reviewer who knows every legitimate path leads the review. Ask for an informal
explanation, not polished Markdown:

- What was your first hypothesis, and what disproved it?
- Which observation identified the vulnerable invariant?
- Why must this account/program/signature be accepted?
- What changes if this instruction or account is reordered?
- Which script sections are boilerplate and which implement the exploit?
- Reproduce it with this changed amount, seed, account, clock, or market regime.

Judge adaptive mechanism understanding and provenance—not accent, fluency, confidence, formatting, or
whether notes look professional. Provide translation and accessibility accommodations.

### Review workflow

1. Preserve relevant logs, submission, artifact, and scoreboard state.
2. Record the trigger and evidence tier without embellishment.
3. If necessary, hold the solve or award without publicly accusing the participant.
4. Notify the participant of the rule and solve under review.
5. Request raw working artifacts and a short explanation; never demand hidden chain-of-thought.
6. Conduct author-led questions and one safe variation/reproduction.
7. Require two organizers for a disqualification recommendation.
8. Record facts, alternatives considered, decision, sanction, and rules version.
9. Notify privately and provide the appeal route.

### Sanctions and appeals

Publish the ladder before the event. A reasonable model is warning/reset for accidental boundary contact
without advantage; solve invalidation and related review when prohibited assistance affected one solve;
award or event disqualification for deliberate autonomous solving or repeated violations; and immediate
containment for credential sharing, outside operation, or evidence tampering.

Apply the same standard to prominent participants, sponsors, researchers, and AI labs. Appeals should go to
someone other than the sole initial decision-maker where possible. Preserve evidence, accept new
reproducible evidence, and make scoreboard corrections reversible.

---

## 5. Roles and coordination

Assign an integrity lead, challenge author/reviewer for every challenge, telemetry operator, incident
scribe, floor proctors, appeal owner/panel, and scoreboard operator. Create a private incident channel
and case template; never debate active cases in public chat.

**Before:** freeze rules; collect acknowledgement; run baselines; test logs; prepare reviewer packets;
rehearse a false positive, mixed-compliance participant, high-confidence case, and appeal.

**During:** keep synchronized clocks; monitor service integrity; review on schedule; preserve evidence;
conduct private solve defenses; avoid public accusations.

**After:** freeze the scoreboard; review prize positions; resolve appeals; rotate secrets; publish an
aggregated integrity report; feed observed capabilities and false positives back into
[`../strategy/anti-ai.md`](../strategy/anti-ai.md),
[`../research/ai-resistance.md`](../research/ai-resistance.md), and
[`playtest.md`](playtest.md).

---

## 6. Tooling backlog

The platform supports append-only structured integrity events and synchronized participant timelines.
Any event-day investigation, author questions, participant contact, sanction, appeal, or later scoreboard
correction happens through the organizers' separate manual process, not through the live leaderboard.

Avoid a black-box “AI cheating score.” Show underlying events and reasons so reviewers can challenge the
inference.

The canonical organizer surface is `/admin`. It combines readiness, the config-driven scoring lifecycle,
Reward Sniper state, leaderboard finalization, passive integrity observations, and the staging-only reset.
It does not mark participants, adjudicate cases, or alter leaderboard eligibility. Start and end timestamps
remain deployment configuration and cannot be mutated from the dashboard.

---

## 7. Launch gates

- Allowed and prohibited matrix and participant-responsibility rule are frozen.
- Every participant acknowledges the exact rules version.
- Immediate submission behavior is defined per challenge format.
- Every challenge has a workflow baseline, alternate-path list, defense questions, safe variation, and
  named reviewer.
- Telemetry captures required events and excludes prohibited private data.
- Review staffing covers the publicly stated enforcement scope.
- Sanctions and appeals are published.
- False-positive and high-confidence-case rehearsals pass.
- All prize contenders can be reviewed before payout.
- Public claims distinguish prevention, detection, and adjudication evidence.

---

## 8. Sources

- Sylvie, “Lessons Learned From RITSEC CTF” (2026-04-07):
  https://sylvie.fyi/posts/ritsec-2026/
- OtterSec, “Announcing the Save CTFs Fund”: https://osec.io/blog/save-ctfs-fund/
- National Cyber League Rules of Conduct: https://nationalcyberleague.org/competition/rules
- US Cyber Open Rules: https://ctf.uscybergames.com/rules
- OWASP LLM Prompt Injection Prevention Cheat Sheet:
  https://cheatsheetseries.owasp.org/cheatsheets/LLM_Prompt_Injection_Prevention_Cheat_Sheet.html
- Supporting research and enforcement references in `../research/ai-resistance.md` §16 and §21.
