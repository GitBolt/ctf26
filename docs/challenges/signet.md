# Challenge Spec — SIGNET (stale deployment + source archaeology)

Status: **EVENT BUILD — Challenge 3 of 10 (N-day / source archaeology)** · Updated: 2026-07-21 · Codename: SIGNET

**One line:** your per-participant Solana program is a fork **deployed from the vulnerable commit just before
a CPI/PDA authority bug was silently patched** — no advisory, the fix buried in an innocuous "strategy
refactor" PR. You do **not** exploit the latest fixed code. You use the patch to understand the bug,
then exploit the deliberately stale pre-fix live instance. Real N-day / patch-diffing security
research.

> **Identity in the ten-challenge slate:** the **N-day / audit research** challenge. The hard part is not
> generic OSINT; the hard part is mapping a silent source patch to a **stale pre-fix Solana
> deployment**. Navigation friction, Turnstile, and canaries are support layers only. No passkey
> (IMPRINT), no dynamic market (Reward Sniper). Real-CTF lineage: patch-diffing, source archaeology,
> and Solana pwn.

**Terminology rule:** never describe this as "exploiting a fixed bug." The fixed latest code is not the
target. The live target is intentionally old. The patch is the clue.

---

## 1. The security core (real N-day, found by archaeology)

A **fictional-but-realistic Solana project we control** has a genuine vulnerability that was **silently
fixed** in its history: no advisory and no CHANGELOG line, with the small fix carried by an ordinary
maintenance commit near the tip of `main`.

There are two versions in play:

```text
commit A  vulnerable code        <-- the per-participant live challenge program is deployed from here
commit B  ordinary maintenance   <-- this quietly fixes the bug
commit C  later cleanup          <-- latest repo state, fixed and not exploitable
```

The player exploits **commit A**, not commit C. The patch in commit B is the clue that explains what
was wrong in commit A. This is exactly the patch-gap / N-day pattern: a fix exists in source history,
but the target running in front of you is still the old vulnerable build.

Separate the two ideas:

- **Technical vulnerability:** unpinned CPI / missing program-id check while the vault forwards its
  own trusted PDA as a signer to a caller-supplied strategy program.
- **Challenge format:** players discover that vulnerability by noticing a quiet fix in repo history and
  proving the live program is still the older pre-fix deployment.

So the exploit is not "patch-diffing." Patch-diffing tells them **which Solana bug to exploit** on the
stale live program.

**Canonical planted bug: unpinned CPI with forwarded signer privilege.** The protocol has a vault that
can invoke an external strategy program. The pre-fix code lets the caller select that program and then
uses `invoke_signed` to forward the quarry vault's real SPL-token authority PDA as a signer. An
attacker deploys a program implementing the public strategy ABI; when the vault calls it, the malicious
program reuses the forwarded signer in a token-program CPI and drains the reserve. The silent patch
pins the allowed strategy program id before any signer privilege is forwarded.

This authority path is load-bearing: merely deriving a PDA under an attacker-owned program would not
let the vault or attacker sign for it. The built challenge therefore forwards a PDA derived under the
vulnerable quarry program itself, and the on-chain integration test proves the nested CPI drain.

Conceptually:

```rust
// vulnerable pre-fix code
let strategy_program = ctx.accounts.strategy_program.key(); // attacker controlled
invoke_signed(
    &strategy_execute_ix(strategy_program, reserve, destination, vault_authority),
    cpi_accounts,
    &[vault_authority_seeds], // trusted quarry PDA becomes a signer in the malicious program
)?;
```

Correct patch:

```rust
require_keys_eq!(strategy_program.key(), vault.pinned_strategy_program);
invoke_signed(
    &strategy_execute_ix(vault.pinned_strategy_program, reserve, destination, vault_authority),
    cpi_accounts,
    &[vault_authority_seeds],
)?;
```

The intended solve is real security research:
1. **Fingerprint** the deployed per-participant program to determine which source era it uses. Use behavioral probing and
   instruction/account compatibility, not a leaked version string. The portal may expose an opaque
   build fingerprint for confirmation, but not the exact commit.
2. **Find the silent fix** by reading the recent commit history — there is no advisory to grep; the
   meaningful check is a tiny part of an otherwise ordinary maintenance diff.
3. **Understand** the bug from the diff + discussion (intent, not pattern-match).
4. **Exploit** the pre-fix bug on your live per-participant instance by deploying or calling an attacker strategy
   and draining the randomized target into your registered escrow.
5. **Flag** from the checker after the validated on-chain state transition (no flag in any artifact).

**No confusion rule:** the latest repo is fixed by design. If a participant tries to exploit the latest code,
it should fail. The challenge target is intentionally stale.

---

## 2. What we give the players

- The **challenge portal** (browser/session-gated) with the per-participant program id, an opaque build
  fingerprint, the public GitHub repository URL, and the exploit target.
- The **controlled public project repository** at `https://github.com/GitBolt/signet` — 24 realistic
  Anchor development commits, current latest code that is already fixed, and the quiet fix among the
  most recent maintenance commits.
- **No version signpost (deliberate; see the design laws in
  [`anti-ai.md` §6](../strategy/anti-ai.md#6-the-design-laws-each-earned-by-a-failure)).** We do **not** tell players the deployment is stale or
  that a patch exists — that realization is the challenge (§4). The portal states only the objective and
  the program id / build fingerprint to reverse. (Internally the latest `main` is non-exploitable, so a
  participant who only reads the fixed head and attacks it fails, but we never announce that up front.)
- A per-participant **live devnet instance** with a funded wallet and starter client.
- A logged hint ladder is the only orientation for stuck participants, for example "compare your target's
  behaviour to the latest code." No hint names the strategy module or the patch. Hints do not alter
  points because the event does not have a consistent cross-challenge penalty instrument.

---

## 3. Solve (floor → ceiling)

- **Floor:** read the portal, run the starter client, identify the vault/strategy integration, and land
  on *a* suspicious strategy refactor (via the **paid** hint ladder if stuck — never a free signpost).
- **Mid:** fingerprint the deployed program to the pre-fix commit; diff-read to isolate the actual
  silent fix among decoys; understand *why* it's a fix.
- **Ceiling:** exploit the stale pre-fix deployment: deploy or call an attacker strategy, reuse the
  signer privilege forwarded by the vault, drain the randomized target, and pass the checker. The
  verified target drain is the scored capture.

---

## 4. Anti-AI mechanisms (unique mix) + honest caveats

**The core property — the investigative intent-gap
([`anti-ai.md` §4](../strategy/anti-ai.md#4-what-agents-are-bad-at--build-the-barrier-here)).** Autonomous agents almost never
*self-initiate* source archaeology. Handed "here is a live program, drain it," an agent does not
spontaneously decide "the bug might be buried in a closed PR and a reviewer comment from months ago" —
that leap of investigative intent is a human instinct, not default agent behaviour. Since the goal is to
break the *autonomous* loop (not to beat a human using AI), this gap is on-target: the autonomous solver
stalls because it never thinks to look at the history. Two rules protect it:

- **Never signpost the archaeology.** The brief states only the objective — "here is a live vault, drain
  it." The moment we say "find the silent patch in the PR history," we hand the autonomous agent the one
  instruction it was missing and the gap collapses. Discovering that history matters is the earned
  insight; any nudge is a *paid* hint (§2), never the default framing.
- **Human-forms-insight + AI-navigates is fine.** If a human thinks "check the git history" and then
  uses an agent to enumerate PRs and diff them, that is the allowed human-in-the-loop meta. We do not
  claim this stops AI-assisted humans; it stops the autonomous loop.

Supporting layers (friction, not the boundary):

1. **Live per-participant exploit.** The win is a **real state transition on a running program**, not a
   readable value. The archaeology answer alone is insufficient; participants must weaponize it.
2. **Messy source archaeology as work.** Once a human has *decided* to look, closed PRs, review
   comments, and commit diffs are not agent-proof — REST/GraphQL enumeration may even favor agents. So
   the strength is the un-prompted intent-gap above, not the browsing being hard. Treat this layer as
   realism and attention cost.
3. **Browser/session-gated portal.** The challenge portal and per-participant target sit behind normal
   browser/session checks, which slow cheap scraping. This is friction, not the security boundary.
4. **Prompt-injection canaries** (unreliable, layered — telemetry only). Decoy READMEs/PR descriptions
   carry non-harmful injected instructions and canary markers; an autonomous agent following them
   discloses itself. It is never load-bearing and never requests private data; see
   [`ai-resistance.md`](../research/ai-resistance.md).
5. **Optional live/event hint.** A video or in-room clue can speed humans toward the right module, but
   it should not be required for correctness. The intended path remains source archaeology + exploit.

**Honest caveats (state them):** a patient agent *that a human has pointed at the history* can enumerate
repo history, PRs, issues, and review comments — the gap is that it won't self-start, not that browsing
is hard. Hardening is not "humans browse better"; hardening is: (a) we never signpost the archaeology
(§4); (b) the live target is randomized per participant; (c) the exploit requires deploying or calling an attacker
strategy, not just naming the bug; (d) the checker validates the drain; (e) in-person "defend your solve"
makes blind agent output risky for prize contention. Honest bar: *the answer is not enough; the exploit
must work*, not "archaeology beats AI."

**Ethics:** fictional project + people we control; never point solvers at a real repo/person. Canaries
public-only, non-harmful.

---

## 5. Scoring

- The verified per-participant target drain is one binary capture under the shared rarity curve in
  [`event.md` §3](../strategy/event.md#3-dynamic--relative-scoring-decision). The correct commit and
  authority explanation are not separately scored, so the challenge author does not assign subjective
  partial values.
- Earlier drafts proposed first-blood and written-research partial credit. Commit identification and
  explanation remain solve-defense evidence and teaching feedback, while all successful drains receive
  the same current leaderboard value.

---

## 6. How we build it

- **The fictional repo:** a scoped Solana vault/strategy protocol (not a whole monorepo) with realistic
  history; the unpinned CPI/PDA authority bug; the silent fix inside a decoy strategy-refactor PR + a
  reviewer-comment hint; several plausible decoy security commits/PRs; a buried related issue.
- **No version labeling (deliberate; see
  [`anti-ai.md` §6](../strategy/anti-ai.md#6-the-design-laws-each-earned-by-a-failure)).** The portal states the objective ("drain your vault")
  and gives the program id / opaque build fingerprint — nothing about the target being stale or a patch
  existing. That realization is the challenge. Do **not** embed a plaintext version string in the
  program; expose at most an opaque build fingerprint and require behavioral probing. Internally the
  latest head is non-exploitable, so attacking it fails — but we never say so up front.
- **No free hint artifact.** Orientation for stuck participants comes only through the **paid hint ladder**; no
  free clip/office-hours note names the strategy module or the patch.
- **Portal** behind Turnstile; per-participant program deploy at a randomized pre-fix SHA and randomized target;
  checker validating the on-chain state transition → HMAC flag.
- **Canary routes** for the shared disclosure-first integrity layer documented in
  [`integrity.md`](../ops/integrity.md); never gate the solve on them.

---

## 7. Open decisions

1. Exact shape of the **attacker strategy** and drain target for the unpinned CPI/PDA authority bug.
2. **Repo size / decoy density** — enough attention tax to matter, not endless grind.
3. Whether the optional event hint is a video, office-hours note, or hint-ladder unlock.
4. **Rotation** across cohorts (rotate the silent fix so the "which PR" answer can't fully leak).
