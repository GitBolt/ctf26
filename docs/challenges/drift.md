# Challenge Spec — DRIFT (no-source RE + runtime/time exploit in a per-participant sandbox)

Status: **FINALIZED FOR EVENT HOSTING — Challenge 4 of 10 (RE + runtime)** · Updated: 2026-07-21 · Codename: DRIFT

**One line:** you get a per-participant **local Solana network** and a **closed-source (bytecode-only) program**
running on it. Reverse-engineer the program, realize it trusts the `Clock` sysvar for value-critical
math, then — because it's *your* validator, so *you* own time — manipulate the clock to mint unbacked
balance and drain the vault.

> **Why it's a proper Solana challenge (passes the "where does the hard part live?" test):** the hard
> work is (1) reverse-engineering a **Solana sBPF program with no source**, and (2) understanding a real
> **Solana runtime bug — trusting `Clock` as an honest oracle**. Both are genuine, respected Solana
> security skills. Nothing generic is doing the heavy lifting.
>
> **Identity in the slate:** the **reverse-engineering + runtime** challenge. Distinct from Reward Sniper
> (live DeFi market), IMPRINT (crypto-auth passkey), and SIGNET (N-day with source *given*). Here
> **no source is given at all** — the inverse of SIGNET — and the medium is an isolated localnet,
> not a shared/contested one, so there is **no race, no leak, no MEV**.

---

## 1. Why this challenge exists / what it proves

- **Teaches the layer nobody understands.** Solana's `Clock` sysvar, `unix_timestamp`, slots, and epochs
  are the most-misunderstood part of the runtime. "Don't trust time as an oracle in an adversarial
  setting" is a real, under-taught lesson. (It echoes this event's own lineage — the first CTF had
  `ST_FLAG{ep0ch_0}` and "The Lamport Clock".)
- **Real RE skill.** Reversing closed-source Solana programs is a live discipline with real tooling
  ([sol-azy](https://github.com/FuzzingLabs/sol-azy), Ghidra eBPF, Binary Ninja eBPF, Radare2). Auditors
  do this when there's no source.
- **The localnet unlock.** On mainnet you cannot control time. On *your own* localnet you can — which is
  the whole point, and something no shared-network challenge can do. The "aha" is: *it's my validator, so
  I own the clock the program trusts.*

---

## 2. The security core (real Solana runtime bug)

### The program (a time-accruing "yield vault") — what a player reconstructs by RE
A native (non-Anchor) program that lets a user deposit a principal and accrue interest over time:

- `deposit(amount)` — credit `position.principal`, set `position.last_ts = Clock::unix_timestamp`.
- `accrue()` / on every interaction — credit interest for elapsed time, then update `last_ts`.
- `withdraw(amount)` — pay out from the vault's **finite reserve** against `position.balance`.

### The invariant it should hold
> A position can only withdraw value actually backed by the reserve, accrued from *honest* elapsed time.

### The bug (real, and the point of the challenge)
The interest math **trusts `Clock::unix_timestamp` as a truthful, monotonic oracle** and credits
balance from it with **unchecked arithmetic**:

```rust
// Vulnerable accrual (reconstructed from bytecode):
let now = Clock::get()?.unix_timestamp as u64;
let elapsed = now - position.last_ts;          // (A) unchecked: underflows if now < last_ts
let interest = position.principal
    .wrapping_mul(RATE)
    .wrapping_mul(elapsed);                     // (B) unbounded: time-scaled minting, no cap, no backing
position.balance += interest;                   // credited as withdrawable balance
position.last_ts = now;
// withdraw() later pays real reserve tokens against position.balance
```

Two things are wrong, and both are exploitable *because the attacker controls the clock on localnet*:
1. **Unbounded, clock-trusting minting (B):** `balance` is minted purely from `elapsed`, with no cap
   and no backing check. Set the clock far forward, accrue, and `balance` explodes.
2. **Non-monotonic / unchecked subtraction (A):** with `overflow-checks = false` (normal for Solana
   release builds), if you make `now < last_ts` the subtraction **underflows to ~2^64**, minting an
   astronomically large `balance` from a *single* interaction. This is the elegant, counter-intuitive
   vector — you rewind time to overflow the vault.

### The correct version (patch reference for grading)
```rust
let now = Clock::get()?.unix_timestamp as u64;
let elapsed = now.checked_sub(position.last_ts).ok_or(Error::TimeWentBackwards)?; // monotonic guard
let elapsed = elapsed.min(MAX_ELAPSED);                                            // bound it
let interest = actual_yield_available(elapsed);   // backed by real reserve accrual, not free minting
position.balance = position.balance.checked_add(interest).ok_or(Error::Overflow)?;
```

### Why it isn't a one-glance bug
The player must, from **stripped bytecode**: recover the instruction dispatch and account layout, find
the accrual routine, recognize it reads `Clock` and does unchecked/unbounded math, and — the real
insight — connect that to *their own control of the validator's clock*. On mainnet this code is "fine"
(Clock is honest-ish); the vulnerability only *exists* under adversarial time. That conceptual leap is
the challenge.

### Intended exploit chain (multi-step, a proper solve)
1. Reverse the `.so`; identify `deposit` / `accrue` / `withdraw`, their instruction tags and account
   order.
2. `deposit` a small principal → establishes `position.last_ts` at the current clock.
3. **Manipulate the clock** (your localnet): either set it far forward, or set `last_ts` high via a
   forward interaction and then rewind to underflow `elapsed`.
4. Trigger `accrue` → `position.balance` inflates massively.
5. `withdraw` → drain the vault's reserve into your account (past the invariant).
6. Submit the reproducible exploit → checker replays it → flag.

---

## 3. What we give the players (and what we don't)

**Given:**
- A **one-command localnet harness** (their own isolated node) that deploys the challenge program and
  seeds a funded vault + an attacker account. Full node control, *including the clock* (see §7).
- The program **as bytecode only** (`vault.so`) — dumpable from their localnet. **No source, no IDL.**
- A minimal **exploit template** (a `litesvm`/`bankrun` or client script skeleton) so a beginner can
  submit transactions and set the clock without fighting boilerplate.
- A **hint ladder** (small score cost): "how does the balance grow?" → "what does it read to measure
  time?" → "whose validator is this?".

**Not given:** source, IDL, symbol names, or a decompiled version. The challenge *is* the RE.

---

## 4. Solve (floor → ceiling)

- **Floor (learn):** run the harness, deposit, advance the clock forward a little, claim modest
  interest, withdraw. Learn the vault and that you can move the clock without treating progress as a
  scored capture.
- **Mid (RE):** dump `vault.so`, disassemble with sol-azy/Ghidra, map the instructions and the accrual
  math, notice it trusts `Clock` and doesn't bound/guard elapsed.
- **Ceiling (exploit):** realize you own the clock → inflate `balance` (forward-warp or rewind-underflow)
  → drain the reserve past the invariant → submit. The exact replayed drain is the scored capture.

---

## 5. Anti-AI mechanisms + honest caveats

- **No source (stripped bytecode-only) → sBPF reverse-engineering.** AI's single biggest edge (reading
  Rust) is removed; sBPF assembly RE is meaningfully harder for agents (little training data, needs
  tooling, no source to one-shot). Requires the build to actually strip clean (see §6) or it collapses
  to a `strings` solve — the exact failure of the first CTF.
- **Niche runtime concept.** "Clock is not a trusted oracle when you control the validator" and
  non-monotonic-time underflow are under-represented in training data; the *insight* is hard for agents
  even after disassembly.
- **Per-participant isolated localnet.** No race, no MEV, no answer leaking between participants; deterministic.
- **Per-participant randomized target** (rate, reserve, threshold) means the specific exploit parameters are not
  shareable even if the technique is.

**Honest caveats (state them):**
- This is **friction, not a wall.** A patient agent with sol-azy/Ghidra can reverse a small program, and
  once the bug is understood the exploit is scriptable. The gate is RE difficulty + the niche insight,
  not impossibility.
- This is a **localnet/runtime challenge**, not a claim that a mainnet attacker can arbitrarily rewind
  Solana time. The security lesson is narrower: if a program's economics rely on `Clock` as an
  unbounded oracle, that assumption must be tied to the environment. The challenge deliberately makes
  the environment adversarial so the assumption becomes exploitable.
- Keep the program **small** (hundreds of instructions, one real bug) so RE is *judgment*, not endless
  grind — which also means a determined agent's cost is bounded. Accept that; back it with **in-person
  "defend your solve"** for prize contention (an autonomous solver can't explain the time insight).
- **Validate by playtest** (all-human vs AI-assisted vs autonomous-agent) like the others.

---

## 6. Build process (the important part — no leaks)

The whole "no source" property is only real if the shipped `.so` leaks nothing cheaply. This is a
**native (non-Anchor) program**, released, stripped, and verified.

### 6.1 Write it as a native program (no Anchor)
- Use `solana-program` directly. **No Anchor** → no IDL, no account/instruction *name* metadata, no
  discriminators to grep.
- Instruction tag = a single leading byte, matched in `process_instruction`.
- Parse accounts and args **by offset** (manual borsh / byte slicing), no descriptive struct strings.
- **No `msg!` / log strings.** Return errors as `ProgramError::Custom(n)` with bare numeric codes.
- Keep it **small** — one vault, ~4 instructions, the one bug.

### 6.2 Cargo profile (the crux flags)
```toml
[lib]
crate-type = ["cdylib", "lib"]

[dependencies]
solana-program = "2.1"     # pin to the toolchain you deploy with

[profile.release]
opt-level       = 3        # or "z" for a smaller, harder-to-read binary
overflow-checks = false    # CRUCIAL: the underflow bug only exists with wrapping arithmetic.
                           # (If true, the exploit panics instead of wrapping.)
panic           = "abort"  # no unwinding tables, no panic message strings
lto             = "fat"
codegen-units   = 1
strip           = true     # strip symbols
```

### 6.3 Build + strip + verify (do NOT skip verification)
```bash
# build the sBPF program
cargo build-sbf --release            # -> target/deploy/vault.so

# extra strip pass (belt and suspenders)
llvm-strip --strip-all target/deploy/vault.so

# VERIFY nothing sensitive leaks — this is the anti-`strings`-solve gate
strings target/deploy/vault.so | grep -iEc 'unix|timestamp|elapsed|interest|last_ts|reserve|vault|balance'
#   expect: 0

# confirm it still needs real RE (assembly + CFG, no symbols)
sol-azy disassemble target/deploy/vault.so | head        # or: llvm-objdump -d target/deploy/vault.so
```
If the `strings` grep returns anything meaningful, fix it (remove the log/error/string, rebuild) before
shipping. Treat this as a launch gate.

### 6.4 Per-participant randomization
- Per participant, vary `RATE`, initial `reserve`, and the win `threshold` in the seeded state.
- Build three equivalent stripped SBF variants with different instruction-tag permutations. Select
  one deterministically from the participant identity so a copied instruction trace from another
  participant does not transfer unchanged.
- Append a harmless participant-bound ELF trailer containing an opaque artifact marker and execute
  those exact bytes in LiteSVM. The downloaded SHA-256 therefore still matches every target and replay,
  while leaked artifacts and copied analysis logs remain attributable.

### 6.5 Deploy into the per-participant localnet
- The harness (§7) loads `vault.so` **as bytes** and creates the seeded accounts. Participants never get
  a source bundle; they dump the `.so` from their node if they want to reverse it (they will).

---

## 7. The harness (how time control is delivered)

Ship a **one-command, per-participant local SVM harness**. Two viable substrates:

- **`litesvm` / `solana-bankrun` (recommended).** A programmable in-process SVM: the participant's
  exploit code has full control, **including `set_sysvar::<Clock>()`** — so they can set
  `unix_timestamp`/`slot` to *any* value, forward or backward. This is what enables the rewind-underflow
  vector, and it mirrors how auditors actually write exploit PoCs. The harness ships a template
  (`exploit.rs` / `exploit.ts`) with the program loaded and the vault seeded; the participant fills in
  the exploit.
- **`solana-test-validator` (fallback).** A real local validator; clock can be warped **forward** (e.g.
  `--warp-slot`, or advancing), but arbitrary rewind is not first-class. Use only if we deliberately
  design a forward-only variant (set clock huge → inflate) and drop the underflow vector.

**Recommendation:** `litesvm`/`bankrun`, so both the forward-inflate and the rewind-underflow vectors
exist and the "you own the clock" insight is fully expressible.

> The public protocol deliberately has no `set_clock` helper. It exposes only generic raw program
> invocation and canonical replacement of a supported sysvar by address and bytes. The binary—not the
> API vocabulary—reveals which runtime account matters.

---

## 8. Scoring / checker (localnet-safe)

- The win is a **real state transition**: attacker withdraws more than deposited / `position.balance`
  and drained tokens exceed the per-participant `threshold`, breaking the reserve invariant.
- Because the participant controls their localnet, the checker must not trust their reported state.
  **Submission = a constrained reproducible exploit trace**, not a snapshot of local state.
- The replay boundary is strict:
  - accepted: raw instructions to the exact published program and canonical bytes for an allowlisted
    sysvar address;
  - rejected: arbitrary SVM/account mutation (`set_account`, direct token-account credit, writing
    position data, replacing program bytes, changing vault reserve);
  - ignored: any participant-reported balances or final state.
- The **organizer's checker replays only the accepted raw trace against a fresh
  canonical per-participant instance** and confirms the invariant broke. Reproduced means **HMAC flag**.
- The exact successful replay is one binary capture under the event-wide rarity curve in
  [`event.md` §3](../strategy/event.md#3-dynamic--relative-scoring-decision). Deterministic localnet
  makes every scored state reproducible.
- Earlier drafts proposed first-blood and written-explanation partial credit. The explanation remains
  useful solve-defense evidence, but only the native replay has a consistent authoritative scoring
  boundary. Every solver receives DRIFT's same current value.

---

## 9. Fairness, accessibility, ethics

- **Floor is real:** run it, move time forward, earn interest, withdraw — a beginner learns the vault and
  the "I can move the clock" idea with a hint. **Ceiling is real:** full RE + the time-trust insight.
- **Accessibility:** it's a code/RE challenge — no visual/perception gate; provide the exploit template
  and hint ladder so the floor isn't "know Ghidra."
- **Ethics:** entirely self-contained (fictional vault, per-participant localnet, local mints). Nothing touches
  real programs, devnet, or mainnet.

---

## 10. Final implementation

The event implementation is under `apps/drift/`:

1. **Native SBF:** non-Anchor `deposit`/`accrue`/`withdraw` program with the clock-trust flaw.
2. **Artifact gate:** deterministic `cargo build-sbf`, SBF architecture check, forbidden-string scan,
   stripped `player-kit/dist/drift_vault.so`, and SHA-256 manifest.
3. **Exact checker:** LiteSVM loads the exact published ELF and seeds a deterministic per-participant vault,
   position, attacker, rate, reserve, threshold, and Clock.
4. **Anti-degenerate invariant:** reserve drain, attacker profit, and net withdrawals must agree and
   cross the threshold; gross volume and self-funding do not count.
5. **Replay boundary:** only bounded raw invocation of the published program and canonical replacement
   of an allowlisted sysvar are representable; semantic instruction helpers and arbitrary
   account/program mutation are rejected.
6. **Authenticated service:** portal-ticket participant binding, HttpOnly sessions, body and trace limits,
   replay/submit rate limits, concurrency cap, checker timeout, and server-only HMAC flags.
7. **Player boundary:** stripped ELF, hash manifest, generic transport client, and brief only. No source,
   IDL, model, checker, reference trace, or organizer hints enter the kit.
8. **Hosting:** a multi-stage Dockerfile compiles the release checker and runs the unprivileged Node
   service with health checks. Final portal URL wiring is deliberately deferred to slate integration.
9. **Integrity propagation:** every HTTP response advertises `/agents.txt`; authenticated target,
   guide, CLI, replay, and submit responses carry the same participant-bound disclosure instruction.
10. **Review telemetry:** the service stores a bounded, privacy-preserving timeline of target reads,
    artifact/guide downloads, UI events, trace hashes, replay results, exact scored submissions, and
    hashed network metadata. A qualifying solve that combines multiple compressed-workflow signals
    opens a medium-confidence organizer review; it never disqualifies automatically.

### Prize solve defense

For a reviewed or prize-contending DRIFT solve, ask the participant to:

1. explain the timestamp subtraction and wrapping multiplication in their own words;
2. distinguish the forward-clock and rewind-clock exploit paths;
3. recalculate a valid drain for a fresh rate/reserve/threshold;
4. reproduce the exploit against a different instruction-tag variant; and
5. identify which validation checks are sound and which missing arithmetic/time invariant creates the bug.

The organizer console should show email first, then the trigger reason, artifact marker, request
timeline, replay/submit history, exact scored trace, and disclosure status. These are interview leads,
not automatic allegations.

---

## 11. Final decisions and remaining launch gate

- Both forward inflation and rewind-underflow are valid; the core realization is environmental Clock
  control.
- LiteSVM is authoritative because exact arbitrary Clock replay is required.
- Per-participant randomization covers account and configuration data plus one of three equivalent instruction-tag
  variants and a participant-bound artifact marker.
- DRIFT occupies the fourth RE/runtime slot and remains distinct from the other challenges.
- The only unresolved launch gate is measured playtesting: human-only, AI-assisted human, and fully
  autonomous attempts. Tune hints or rate limits from evidence; do not redesign the bug without a
  concrete playtest failure.
