# Event Integrity and Anti-Agent Enforcement

Updated: 2026-07-12

This is the operational companion to the challenge-design doctrine in `00`. It coordinates the three
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
Do not rely on “against the spirit” alone. Require every member to acknowledge the exact rules version
at registration and before the first scored launch.

### Team responsibility

Recommended rule: the team is responsible for every submitted flag, proof, transaction, and score. One
member's prohibited use can affect the team result. For a reviewed solve, name the primary contributor
and everyone who materially participated. Teammates should not submit work whose provenance they cannot
explain.

### Immediate submission

For flag challenges, prohibit flag hoarding: submit a recovered flag promptly. This improves leaderboard
accuracy and makes timing evidence interpretable. Allow short delays for connectivity or confirming the
correct session. Continuous/KOTH challenges already timestamp actions and reveals; delayed offline score
claims should not be accepted.

---

## 2. Pillar one — prevent autonomous completion

Use the doctrine in `00`: real Solana security core; per-team state; randomized targets; strict
state-transition/replay checkers; server-generated flags; no answers in public artifacts; physical
passkey/wallet approval where authentic; live state, scarce attempts, relative scoring, and in-person
prize-contender review.

Turnstile, video, canvas, novelty, decoys, and prompt injection are not universal security boundaries.
Prompt injection may be omitted when it does not fit the challenge. Reward Sniper nevertheless validates
a useful hosted-challenge pattern when autonomous operation is explicitly prohibited: make the policy
discoverable on routes agents actually inspect, bind a disclosure marker to participant/event identity,
record disclosure first-party before mirroring it to Discord, and retain independent behavioral detection
for agents that ignore the policy. See `../research/reward-sniper.md`.

CTF26 operational default as of 2026-07-12: every hosted scored challenge exposes the common
disclosure-first policy routes and reports participant-bound disclosures into the central organizer
feed. Challenge-specific prevention/detection remains separate: IMPRINT uses its passkey gate, Reward
Sniper adds behavioral UI/API correlation, and SIGNET/DRIFT retain their own exploit boundaries.

---

## 3. Pillar two — detect and triage

Detection answers “which solve warrants human review?”, not “did a model write this?”

### Minimum event log

Record with synchronized server time:

- rules version and acknowledgement;
- participant, team, challenge, session, target, and artifact version/hash;
- launches, credential issuance, and hints viewed;
- flag/proof submissions exactly as entered and checker reason codes;
- accepted transactions, replays, commits/reveals, and high-value actions;
- rate-limit, replay, cross-team, decoy, and safe-canary events;
- scoreboard and administrative changes;
- review trigger, evidence, decision, reviewers, and appeal result.

Do not collect private keys, cookies, local files, browser history, environment variables, unrelated
device contents, or covertly invasive telemetry. Restrict access and define retention before launch.

### Human workflow baselines

Clean-room human tests must measure the sequence:

```text
launch → first hypothesis → first valid interaction → mechanism discovery
       → exploit construction → successful transition → submission
```

Record ranges, false starts, and legitimate alternate paths. These are review baselines, not minimum
legal times. Prior knowledge, team parallelism, or exceptional skill may explain an outlier.

### Wrong-submission analysis

Classify wrong flags/proofs as typo/encoding error, wrong team/session, public example, known decoy or
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
automated-looking trace with normal human milestones absent.

**High confidence — contain, then adjudicate:** admission or participant-provided transcript; an agent
directly operating the scored service under team credentials; challenge-specific output demonstrably
produced through a prohibited workflow; repeated agent-only actions plus failed technical defense and
corroborating telemetry; an outside operator or AI-lab submission competing contrary to explicit rules.

No prose classifier, timing threshold, IP address, or canary hit is independently conclusive.

### Triage cadence

- Alert continuously only on cross-team reuse, replay, credential abuse, or high-confidence actions.
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
3. If necessary, hold the solve/prize without publicly accusing the team.
4. Notify the team of the rule and solve under review.
5. Request raw working artifacts and a short explanation; never demand hidden chain-of-thought.
6. Conduct author-led questions and one safe variation/reproduction.
7. Require two organizers for a disqualification recommendation.
8. Record facts, alternatives considered, decision, sanction, and rules version.
9. Notify privately and provide the appeal route.

### Sanctions and appeals

Publish the ladder before the event. A reasonable model is warning/reset for accidental boundary contact
without advantage; solve invalidation and related review when prohibited assistance affected one solve;
team prize/event disqualification for deliberate autonomous solving or repeated violations; and immediate
containment for credential sharing, outside operation, or evidence tampering.

Apply the same standard to prominent teams, sponsors, researchers, and AI labs. Appeals should go to
someone other than the sole initial decision-maker where possible. Preserve evidence, accept new
reproducible evidence, and make scoreboard corrections reversible.

---

## 5. Roles and coordination

Assign an integrity lead, challenge author/reviewer for every challenge, telemetry operator, incident
scribe, floor proctors, appeal owner/panel, and scoreboard operator. Create a private incident channel
and case template; never debate active cases in public chat.

**Before:** freeze rules; collect acknowledgement; run baselines; test logs; prepare reviewer packets;
rehearse a false positive, mixed-compliance team, high-confidence case, and appeal.

**During:** keep synchronized clocks; monitor service integrity; review on schedule; preserve evidence;
conduct private solve defenses; avoid public accusations.

**After:** freeze the scoreboard; review prize positions; resolve appeals; rotate secrets; publish an
aggregated integrity report; feed observed capabilities and false positives back into `00`, `02`, and
`09`.

---

## 6. Tooling backlog

The platform should support append-only structured integrity events; exact wrong-submission retention;
synchronized launch/hint/action/solve timelines; anomaly views for bursts, impossible ordering,
cross-team reuse, and known decoys; reviewer cases with immutable evidence references; temporary holds;
author question/variant packets; two-reviewer decisions; appeals and reversible scoreboard corrections;
retention expiry; and access auditing.

Avoid a black-box “AI cheating score.” Show underlying events and reasons so reviewers can challenge the
inference.

---

## 7. Launch gates

- Allowed/prohibited matrix and team-liability rule are frozen.
- Every member acknowledges the exact rules version.
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
