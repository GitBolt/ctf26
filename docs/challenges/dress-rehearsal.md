# Challenge Spec — DRESS REHEARSAL (mutable upgrade-buffer TOCTOU)

Status: **DESIGN DRAFT — proposed fifth challenge; no implementation yet** · Updated: 2026-07-10 ·
Codename: DRESS REHEARSAL

**One line:** a release committee approves the safe program currently staged in a Solana Loader-v3
buffer, but later authorizes the upgrade by **buffer address rather than current bytes**. Replace the
reviewed bytes after approval, install malicious code at the already-trusted program ID, and use its
unchanged PDA namespace to drain the treasury.

> **Proposed identity in the slate:** the **program deployment / supply-chain pwn** challenge. It adds
> Upgradeable Loader internals, release governance, malicious sBPF, and a genuine time-of-check /
> time-of-use failure. It is not another DeFi accounting challenge (Reward Sniper), signature challenge
> (IMPRINT), stale-source investigation (SIGNET), or bytecode/runtime puzzle (DRIFT).

This document is the organizer design and answer key. The player-facing brief is in §2 and deliberately
does not name the missing check.

---

## 1. Why this challenge earns a slot

DRESS REHEARSAL teaches an important Solana trust distinction:

```text
trusted program address != trusted program bytes forever
```

Loader-v3 separates an upgradeable deployment into a stable executable **Program** account, a
**ProgramData** account holding the current code and upgrade authority, and a mutable **Buffer** used to
stage replacement code. An upgrade preserves the Program ID. PDAs derived under that Program ID also
keep the same addresses after the code changes.

The fictional release process makes a realistic governance mistake: it reviews the contents of a
mutable buffer, records both the buffer address and reviewed digest, but leaves the team in control of
the buffer. At execution time it checks the approved address and proposal fields, but not whether the
bytes still have the approved digest.

The security invariant is crisp:

> The bytes installed into ProgramData must be exactly the bytes the committee reviewed.

The player must do more than spot one missing comparison. A full solve requires understanding loader
accounts and authorities, staging and rewriting an sBPF buffer, satisfying the governance handoff,
installing a valid malicious program, waiting for the upgraded code to become visible, and then using
the target's persistent PDA authority to move real challenge assets.

### Distinctness from the existing four

| Challenge | Primary skill | Winning action |
|---|---|---|
| Reward Sniper | live market/accounting strategy | extract from changing reward state |
| IMPRINT | WebAuthn/secp256r1 authorization | land a passkey-backed cross-vault withdrawal |
| SIGNET | source archaeology + CPI authority | exploit a stale program through a malicious strategy |
| DRIFT | sBPF RE + runtime assumptions | manipulate an isolated replay |
| **DRESS REHEARSAL** | **loader/release-governance TOCTOU** | **replace approved code and upgrade the trusted program itself** |

The closest existing challenge is SIGNET because both eventually run attacker-written Solana code.
The authority failures are nevertheless different. SIGNET forwards a treasury signer to an untrusted
CPI target. DRESS REHEARSAL never forwards that signer: the attacker replaces the trusted target's code,
and the replacement naturally inherits the target Program ID's PDA namespace.

---

## 2. Player-facing brief

The public brief should be short:

> **DRESS REHEARSAL**
>
> The Release Committee controls the upgrade authority for a treasury program. Your team has one
> staging buffer and one live review approval. The committee insists that the code it reviews is the code
> it deploys.
>
> Move at least **TARGET** units from the treasury reserve into your registered escrow without obtaining
> the committee's private key.

The portal may explain the normal release stages—stage, review, execute—but must not say that the buffer
remains mutable, that execution omits a digest check, or that the Program ID preserves PDA authority.

Do not advertise this as “find a TOCTOU” or “swap the buffer after approval.” Those are the earned
security conclusions.

---

## 3. The real Solana primitive

The challenge uses the real **BPF Loader Upgradeable / Loader-v3**, not a JavaScript model of an
upgrade process.

Current Loader-v3 behavior relevant to the challenge:

- a Program account points to its ProgramData account;
- ProgramData stores the deployed bytes and optional upgrade authority;
- a Buffer stores staged bytes and has a mutable authority;
- writing to a Buffer requires its authority's signature;
- upgrading requires the Buffer authority and ProgramData upgrade authority to resolve to the same
  signing authority;
- the loader verifies the staged ELF, copies it into ProgramData, drains the Buffer, and leaves the
  Program account and Program ID unchanged;
- upgraded code becomes effective after the runtime's deployment visibility delay, so the drain occurs
  in a later slot/transaction. The pinned Agave v3.1.8 path currently uses a one-slot delay, but clients
  must poll the effective deployment slot rather than sleep for a hard-coded slot count.

The implementation must pin an exact Agave release and use its real loader path. The initial target is
Loader-v3, not Loader-v4. If event infrastructure changes versions, the complete authority and
visibility sequence must be re-proven before launch.

Authoritative references:

- [Solana program deployment and Loader-v3 upgrade mechanism](https://solana.com/docs/core/programs/program-deployment)
- [Solana program execution and deployment visibility](https://solana.com/docs/core/programs/program-execution)
- [Agave v3.1.8 Loader-v3 implementation](https://github.com/anza-xyz/agave/blob/v3.1.8/programs/bpf_loader/src/lib.rs)

---

## 4. Challenge system

Each team receives an isolated target with the following real accounts.

| Account | Owner | Purpose |
|---|---|---|
| `target_program` | Loader-v3 | Stable executable address players and the treasury trust |
| `target_program_data` | Loader-v3 | Current target ELF; upgrade authority is `release_authority` |
| `staging_buffer` | Loader-v3 | Team-controlled buffer used for the reviewed release |
| `release_config` | Release program | Pinned target, reviewer, loader, expiry policy, and PDA bump |
| `release_proposal` | Release program | Team, target, Buffer, reviewed length/digest/slot, nonce, not-before/expiry, status |
| `treasury_config` | Target program | Challenge mint, reserve, and treasury-authority derivation |
| `treasury_reserve` | Token program | Organizer-funded reserve controlled by a target-program PDA |
| `team_escrow` | Token program | Registered destination watched by the checker |

The target program starts with benign treasury code. Its reserve authority is a PDA derived under
`target_program`, for example from a domain-separated treasury seed plus the treasury config address.
The normal program never lets the team withdraw the reserve.

The safe maintenance release is deliberately boring: a telemetry or versioned-health-check update
that preserves the public ABI and cannot move reserve funds. The Release Desk accepts only the exact
canonical safe digest.

### Normal release flow

1. The team creates or receives its staging Buffer with the team wallet as Buffer authority.
2. The team writes the canonical safe maintenance ELF into that Buffer.
3. The Release Desk reads the actual Loader-v3 Buffer, hashes the canonical staged payload, verifies
   the safe digest, and creates a short-lived `release_proposal` signed by the reviewer. The proposal
   stores `reviewed_payload_len`, `reviewed_payload_digest`, and `approved_slot`.
4. The team calls `execute_release` before expiry.
5. The release program verifies proposal, team, target, ProgramData, Buffer address, status, a
   `not_before_slot` after approval, and expiry.
6. It invokes Loader-v3 `SetAuthorityChecked` with the writable Buffer, the team as current-authority
   signer, and `release_authority` as new-authority PDA signer. The team signature propagates from the
   outer transaction; the release PDA signs through `invoke_signed`.
7. It invokes Loader-v3 `Upgrade` with ProgramData, Program, Buffer, spill, Rent, Clock, and the same
   `release_authority` PDA signer. At this point Buffer authority and ProgramData upgrade authority are
   both `release_authority`.
8. After the visibility delay, the safe target version is active.

The two loader calls in steps 6–7 are essential. Loader-v3 requires the Buffer authority and the
ProgramData upgrade authority to match for `Upgrade`; the release program cannot simply pass a
team-owned Buffer directly into an upgrade authorized by its PDA. The proposal is marked executed only
after `Upgrade` succeeds.

---

## 5. The vulnerability

Approval records four facts:

```text
approved buffer address = B
reviewed payload length = L
reviewed digest         = H(domain || encode_u64(L) || B.payload[0..L])
approved slot           = S
```

Execution validates proposal identity, target, Buffer address, status, and expiry, but never recomputes
the current payload length/digest and compares them with the reviewed values. Approval also leaves the
team as Buffer authority until execution.

`payload` means bytes after Loader-v3 Buffer metadata. `L` is the full Buffer payload allocation, not
the logical ELF file length. The safe artifact is padded to that exact capacity before review, and the
team uploader must overwrite all `L` bytes. This removes prefix-hash and stale-tail ambiguity.

That creates the exploit window:

```text
safe padded payload in B
    -> Release Desk reviews H(domain || length || safe padded payload)
    -> proposal approves B
    -> team overwrites B with malicious ELF
    -> execute_release validates B, not its current bytes
    -> authority handoff to release PDA
    -> Loader-v3 installs malicious ELF at target_program
```

The loader itself is behaving correctly. It proves that the Buffer and ProgramData authorities agree,
verifies that the current bytes are valid sBPF, and installs exactly those current bytes. The release
program is the vulnerable component because it mistakes a mutable account address for immutable code
identity.

### Why the final drain works

After upgrade, `target_program` still has the same public key. Therefore the treasury-authority PDA
derived under that program remains the same address. The malicious replacement implements an
instruction that:

1. validates enough account structure to invoke the pinned Token Program;
2. signs for the existing treasury-authority PDA with the known target seeds;
3. transfers the randomized target amount from `treasury_reserve` to `team_escrow`.

The attacker never learns the governance key or a PDA private key. They gain authority by changing the
code that is entitled to sign for the PDA.

---

## 6. Intended solve (floor → ceiling)

### Floor — learn the deployment model

- inspect Program, ProgramData, and Buffer state;
- stage the safe maintenance build in a local practice instance;
- complete one benign release and observe that the Program ID stays constant while ProgramData changes;
- observe the one-slot visibility behavior rather than treating a same-slot invocation failure as a
  broken exploit.

### Mid — find the broken binding

- audit the release program and proposal schema;
- notice that review records a digest but execution checks only target and Buffer identity;
- verify that the team still controls the Buffer after approval;
- determine the exact Buffer-authority handoff performed by `execute_release`.

### Ceiling — weaponize the release

1. Build a valid malicious native sBPF replacement small enough for the allocated Buffer/ProgramData.
2. Stage the canonical safe release in the live Buffer.
3. Complete the live Release Desk review and receive the proposal.
4. While still Buffer authority, overwrite the entire `reviewed_payload_len` Buffer payload with the
   malicious ELF and deterministic padding; ordinary Loader writes neither shrink the Buffer nor clear
   an old tail.
5. Call `execute_release`; the vulnerable governance program hands the Buffer to its PDA and upgrades
   the target without rehashing.
6. Wait until the new version is visible.
7. Invoke the malicious target and drain the reserve into the registered escrow.
8. Submit the solve transaction to the checker, which verifies state rather than accepting a claimed
   digest or player-reported balance.

The live Buffer is consumed by a **successful** Loader-v3 upgrade. A failed `Upgrade` CPI rolls back the
whole transaction, including authority handoff and proposal-status writes, so the same approved Buffer
is retryable until proposal expiry. This is intentional: scarcity is one physical review approval, not
one on-chain execution attempt. Infrastructure may rate-limit its own RPC, but the challenge must not
claim that an off-chain cooldown can prevent direct on-chain retries.

---

## 7. What we give players

- release-governance program source and interface;
- original treasury program source and account layout;
- safe maintenance release source plus canonical `.so` and expected digest;
- a custom uploader that can create a Buffer, inspect Loader-v3 state, and overwrite the **entire fixed
  payload capacity** of the team's existing Buffer, including deterministic tail padding;
- a local validator or container reproducing the exact pinned Loader-v3 behavior;
- a legitimate release client that stages, requests review, and executes a safe upgrade;
- a reproducible minimal native-program skeleton with entrypoint, instruction parsing, CPI dependencies,
  and containerized SBF build; players still author the malicious sweep and exploit client;
- instance-scoped target Program, ProgramData, reserve, escrow, Buffer, and randomized drain target;
- enough test SOL and a team-owned challenge wallet;
- the Release Desk URL/queue mechanism and a paid hint ladder.

We do **not** give players:

- the malicious reference program;
- the reference exploit client;
- reviewer or instancer keys;
- checker internals or HMAC secret;
- organizer deployment keypairs;
- an endpoint that accepts uploaded balance claims or arbitrary account snapshots.

Full source is intentional. Hiding the missing digest check is not the anti-agent mechanism and would
make this overlap with DRIFT.

---

## 8. Human-loop and anti-autonomous-agent design

The access/action layer is the **Release Desk**, which is part of the vulnerable process rather than a
separate puzzle.

### Default event mode: deterministic staffed review

- the desk opens during published review windows; the queue is keyed by team, so discovering the bug at
  an arbitrary time does not cause a team to miss a fixed appointment;
- each team receives one finalized approval, with a written reset policy for infrastructure failure;
- the authenticated player creates a review request signed by the registered team wallet;
- the QR contains only an opaque, short-lived `review_request_id`—never the portal launch ticket,
  trusted team fields, Buffer address, or reviewer credential;
- a participant presents that QR at the physical desk; remote review requests are not approved;
- an organizer-side console independently reads the Buffer, checks its authority, size, and canonical
  safe digest, then enables one **Approve** action;
- the organizer approves from a separate device; no reviewer secret reaches the player browser;
- the server derives team, target, and Buffer from the authenticated request rather than QR fields and
  atomically advances `created → desk_claimed → approval_submitted → approval_finalized`;
- the resulting proposal is bound to team, target, Buffer, reviewed length/digest/slot, nonce, and an
  on-chain `not_before_slot` plus expiry with comfortable measured upload-time headroom;
- execution and the final drain are signed by the registered team wallet.

The review is objective and fast: staff verifies what the console reports and presses approve. Staff
does not judge whether the player's code “looks safe,” so personality, persuasion, and organizer
discretion cannot affect correctness.

This creates a real human checkpoint in the exact place the security failure lives: between code review
and deployment. An unattended agent can read the source and build both binaries, but it cannot complete
the separate in-room desk action without involving the participant. A normal software-wallet signature
is identity and replay binding, not a human-presence proof; call it an additional human action only if
the event explicitly enforces a non-exportable mobile or hardware-wallet approval. A participant using
AI to help audit or write the payload remains valid human-driven play.

Supporting controls:

- a dedicated `dress-rehearsal` launch-ticket audience and verifier key; the edge calls
  `consumeParticipantTicket` with durable atomic JTI storage, creates an HTTP-only first-party session,
  and removes the ticket from the URL before review state exists;
- per-team target, Buffer, proposal nonce, digest, expiry, and escrow;
- one live finalized review approval rather than an unlimited remote approval oracle;
- local unlimited practice so scarce live attempts test judgment, not blind luck;
- browser/session abuse controls around review requests;
- database uniqueness and concurrency tests for double scans, expired QR codes, cross-team scans, staff
  double-clicks, and two desks claiming the same request;
- screen recording or short solve defense for prize contenders.

No prompt-injection canary, visual riddle, CAPTCHA, or off-topic reflex gate is load-bearing. An
automated Release Desk can be offered for remote cohorts, but it materially weakens the unattended-agent
bar and should be described as a different mode.

---

## 9. Scoring and checker

DRESS REHEARSAL is naturally a **Jeopardy pwn challenge**. Do not distort it into KOTH or relative
extraction. Platform-level dynamic value by solve count is fine; the challenge itself has one crisp
full solve.

The checker persists finalized historical evidence because a successful Loader-v3 upgrade drains and
truncates the Buffer. It records this state machine from the instancer's authenticated internal RPC:

```text
instance creation
  → review snapshot(length, digest, slot)
  → finalized approval
  → ProgramData digest and deployment slot
  → finalized drain transaction
  → atomic solve record
```

It returns a server-generated flag only when all of the following hold:

- the instance/genesis identity, registered team wallet, target, ProgramData, Buffer, reserve, and
  escrow match immutable instancer state;
- a finalized reviewer proposal binds that team/target/Buffer and stores the safe payload length,
  digest, `approved_slot`, `not_before_slot`, and expiry;
- ProgramData's deployment slot is strictly after `approved_slot`;
- the checker hashes exactly the first reviewed payload length after ProgramData metadata, and that
  installed digest differs from the reviewed safe digest;
- the drain occurs at or after the program's effective deployment slot and is signed by the registered
  team wallet;
- the drain transaction invokes the target Program ID and contains the expected inner SPL Token
  transfer authorized by the treasury PDA;
- the exact transaction deltas show `treasury_reserve` loss equals `team_escrow` gain in the challenge
  mint and meets the randomized target;
- this `(event, challenge, team, instance)` has no prior canonical solve.

Use plain SPL Token for the challenge asset, seed the entire supply into the reserve, and revoke mint
and freeze authorities after setup. That makes exact reserve/escrow deltas sufficient provenance and
removes a needless organizer-mint exception from the scoring rule.

Suggested flag derivation:

```text
message = "ctf26:v1:dress-rehearsal" ||
          len(event_id) || event_id ||
          len(team_id) || team_id ||
          len(instance_id) || instance_id ||
          len(target_program) || target_program ||
          len(approval_id) || approval_id ||
          len(solve_tx) || solve_tx

flag = "ST_FLAG{" || first_12_bytes(HMAC-SHA256(flag_secret, message)).hex_lower() || "}"
```

The checker must calculate **net reserve loss and net escrow gain**, not gross transfer volume. Client
reports, emitted strings, proposal metadata, and the fact that an upgrade occurred are insufficient by
themselves. Finality, fork/replay behavior, ledger retention, and the scoreboard's acceptance of dynamic
checker flags all require end-to-end tests before a manifest is published.

Optional non-scoring progress markers may show that a team successfully staged or safely upgraded in
the practice instance. Do not issue a second public flag that lets teams bypass the full chain.

---

## 10. Per-team randomization and answer sharing

Per team, randomize:

- release-authority and treasury-authority PDAs through instance-specific config addresses;
- staging Buffer and proposal nonce;
- review expiry and approval ID;
- challenge mint, reserve, escrow, starting reserve, and target drain amount;
- registered team wallet and instance/genesis identity.

With isolated validators, reuse one canonical target Program ID, ProgramData address, safe binary, and
safe digest across containers. Unique program IDs create build/digest/keypair support cost without
improving isolation. Use unique Program IDs only if a shared-validator design survives the resource and
cross-team review.

The canonical safe release digest may remain common across teams. It is an input to the release
ceremony, not a secret, and salting reproducible builds would add operational risk without preventing
technique sharing.

The conceptual technique can be shared, as with any pwn challenge. Another team's Buffer, proposal,
payload transaction, target program, and flag cannot be replayed. Randomization should prevent trace
replay without gratuitously changing the source-level bug between teams.

---

## 11. Correct design / patch reference

The production-safe version should use defense in depth.

### Patch A — lock Buffer authority before review

The desk cannot seize a team-authorized Buffer by itself. The fixed custody flow is:

1. the team calls `lock_buffer`, co-signing a Loader-v3 `SetAuthorityChecked` CPI that transfers Buffer
   authority to `release_authority`;
2. the desk waits for finality and independently confirms the Buffer is now controlled by that PDA;
3. the desk hashes and approves the now team-immutable payload;
4. governance upgrades later from that locked Buffer.

An alternative `approve_and_lock` flow must atomically include reviewer, team, and PDA signatures plus
the on-chain payload hash. Hashing off-chain and transferring authority in a later transaction leaves
the same race window. Loader-v3 Buffer authority cannot simply be removed: the pinned loader rejects an
authority-less Buffer and `Upgrade` requires the Buffer and ProgramData authorities to match.

This is the strongest simple fix because it removes the mutability that creates the race.

### Patch B — rehash at execution

Immediately before authority handoff/upgrade, `execute_release` hashes the current Buffer payload using
one canonical byte range and requires equality with the approved digest.

The canonicalization must be exact:

- compute `H(domain || encode_u64(reviewed_payload_len) || payload[0..reviewed_payload_len])`;
- exclude Loader-v3 metadata and include the entire reviewed payload allocation;
- require deterministic trailing-byte padding and reject length mismatch;
- pin the hash algorithm and domain separator;
- reject unexpected Buffer length rather than hashing a convenient prefix;
- perform the hash in the same instruction that invokes the loader so no later write can interleave.

Hashing a full sBPF payload plus `SetAuthorityChecked` and `Upgrade` may exceed the desired compute
budget. Benchmark the actual safe payload and SHA syscall in Milestone 0; Patch A is still sufficient if
Patch B is impractical at the chosen size.

### Patch C — both

Lock authority before review **and** rehash at execution. The second control catches organizer mistakes,
unexpected authority changes, and future flow regressions.

The fixed reference build must prove that the safe release still works. A patch that simply disables
all upgrades is not an acceptable functional fix unless immutability is an explicit product decision.

---

## 12. Build architecture

Recommended organizer layout, following the executable challenge/solve separation used by serious
Solana CTF repositories:

```text
dress-rehearsal/
  README.md                  player-facing brief
  attachment/
    release-program/        player source
    treasury-program/       player source
    safe-release/           source + canonical .so + digest
    client/                 legitimate stage/review/execute helpers
    localnet/               pinned reproducible practice environment
  organizer/
    instancer/
    release-desk/
    checker/
    reference-malicious-program/
    reference-solve/
    patched-program/
    tests/
  kona.toml                 once real endpoints and limits are fixed
```

### On-chain components

1. **Treasury target:** small native or Anchor program with a real SPL-token reserve and a PDA token
   authority. The safe release preserves its legitimate ABI.
2. **Release governance:** validates proposals and performs Loader-v3 authority handoff + Upgrade CPI.
   Only the current-byte binding is intentionally missing.
3. **Malicious reference target:** organizer-only native sBPF implementing the drain after upgrade.
4. **Patched release governance:** used for negative tests and the post-event lesson.

### Off-chain components

1. **Instancer:** creates isolated target/programdata/buffer/reserve/proposal state and never gives
   players upgrade/reviewer keys.
2. **Release Desk:** consumes the central participant ticket, creates a first-party session, reads the
   live Buffer independently, enforces review count/expiry, and submits reviewer-approved proposals.
3. **Checker/indexer:** persists initial balances and approval state, verifies the real upgrade/drain,
   atomically records solve, and generates the HMAC flag.
4. **Replay/audit log:** retains review, Buffer digest, authority handoff, upgrade, visibility slot, and
   drain transactions for support and post-event review.

### Key custody

| Capability | Location and rule |
|---|---|
| Challenge ticket verifier | Challenge edge only; dedicated audience key, never browser-visible |
| Reviewer signer | Isolated signer/HSM service; never the desk web process or target upgrade authority |
| Flag secret | Checker only |
| Instancer/deployer credentials | Instancer only; absent from validator containers and player artifacts |
| Release authority | PDA controlled only by the release program; no private key exists |
| Challenge mint/freeze authority | Revoked after the complete supply is seeded into the reserve |
| Team signer | Participant's registered wallet; never distributed as an organizer-generated keypair file |

`release_config` becomes immutable after instance setup or is controlled by a separate cold
administrative authority. Reviewer-key rotation, signer/device failover, and suspected-key compromise
must be rehearsed without granting the reviewer any direct upgrade or reserve power.

### Instance choice

Prefer an isolated validator/container per team for the first production version. Shared-validator
namespaces are possible, but arbitrary program-buffer uploads make resource caps and denial-of-service
isolation more important than in a normal account-only challenge.

Each instance needs authenticated team-scoped RPC, fixed fee funding, disabled unneeded faucet/admin
methods, CPU/RAM/PID/disk/network/ledger limits, no Docker socket or host/cloud credentials, a fixed TTL,
health monitoring, and prewarmed spare capacity. Benchmark the maximum simultaneous team count and
upload bandwidth on event hardware; “one validator per team” is an isolation choice, not a capacity
plan.

A reset creates a new `instance_id` and invalidates all old QR requests, proposals, sessions scoped to
the old target, and checker state. The reset transaction must atomically preserve or refund the team's
review allowance according to the written infrastructure-failure policy.

---

## 13. Mandatory feasibility spike before the full build

Do not build the portal or art first. Prove this exact chain on the pinned validator:

1. deploy a target with ProgramData upgrade authority set to a release-program PDA;
2. create a Buffer controlled by a team key;
3. create one fixed payload capacity, write the safe ELF plus deterministic padding, and hash the exact
   domain/length/payload representation;
4. use the exact player uploader to overwrite all payload bytes with a different valid padded ELF;
5. call the release program with the team as outer signer; CPI to `SetAuthorityChecked` with both team
   and release-PDA signatures, then CPI to `Upgrade` with the release PDA;
6. measure compute for full-payload hashing, both loader CPIs, and ELF verification;
7. prove a failed Upgrade rolls back authority/proposal state and remains retryable until expiry;
8. poll until the replacement is effective rather than invoking in the deployment slot;
9. invoke the replacement at the unchanged Program ID;
10. sign for the unchanged treasury PDA and transfer real SPL tokens.

This spike is the go/no-go gate. If any authority transition is simulated, bypassed, or performed with
an organizer key outside the documented flow, the challenge is not ready.

Agave v3.1.8 is the current reference used by this design review, while the repository's existing local
Solana toolchain has used 2.3.13 elsewhere. Milestone 0 must select and pin one validator/CLI/SDK/SBF
toolchain combination and re-prove every loader claim on that exact version. If
`SetAuthorityChecked` is not active there, deliberately use and document legacy `SetAuthority` rather
than silently changing the sequence.

---

## 14. Required tests and launch gates

### Loader and exploit correctness

- canonical safe release is approved and upgrades successfully;
- unapproved Buffer cannot be executed;
- malicious bytes staged **before** review are rejected by the Release Desk;
- safe bytes reviewed, then replaced, succeed against the vulnerable release program;
- `SetAuthorityChecked` receives the team current-authority signer and release-PDA new-authority signer;
- direct Loader-v3 upgrade fails because the team cannot sign for release authority;
- wrong ProgramData, Program, Buffer, loader, or authority account fails;
- the exact uploader rewrites the full payload capacity; shorter ELF plus stale tail fails the canonical
  digest/padding test;
- failed Loader upgrade rolls back proposal/authority state and can be retried until slot expiry;
- target cannot be upgraded twice in the same slot;
- upgraded code is unavailable during the visibility delay and callable afterward;
- malicious replacement signs for the pre-existing treasury PDA and drains real tokens;
- original and safe target builds cannot perform the unauthorized drain.

### Patch correctness

- team-authorized Buffer lock **before review** prevents later team writes;
- rehashing current bytes rejects post-approval replacement;
- both patches still permit the canonical safe release;
- prefix-only hashing, altered trailing bytes, changed Buffer length, and padding ambiguity fail;
- full-payload hash plus loader CPIs fits the selected compute budget, or Patch B is dropped in favor of
  the proven custody fix;
- proposal cannot be replayed across team, target, Buffer, instance, or expiry.

### Checker integrity

- self-transfers and self-funded escrow deposits do not solve;
- gross volume without reserve loss does not solve;
- a safe upgrade without drain does not solve;
- a drain before approval or in a different instance does not solve;
- non-finalized/forked transactions, old-ledger gaps, and player-supplied RPC responses do not solve;
- repeated checker submissions return the same solve state without minting multiple flags;
- HMAC secret and reviewer keys never enter logs, browser bundles, attachments, or transaction data.

### Packaging and operations

- player archive contains no keypair JSON, deploy authority, reviewer secret, checker, tests, answer
  key, reference payload, or reference solve;
- every shipped `.so` is identified, hashed, and intentionally allowlisted;
- `cargo build-sbf` output cannot accidentally publish deployment keypairs;
- program/buffer size, chunk count, compute limit, transaction limit, review attempts, and instance TTL
  are explicit;
- concurrent QR scans, double approvals, expired requests, and signer-service retries are tested;
- reviewer-key compromise/rotation and spare desk-device failover are rehearsed;
- challenge reset is tested after approval, during upload, during upgrade, and after a successful
  upgrade but before the drain;
- maximum-concurrency validator/upload burn-in and a clean-machine extracted-player-bundle scan pass;
- the scoring platform accepts a real dynamic checker flag end to end before any manifest is published;
- full human, AI-assisted-human, and unattended-agent playtests are recorded.

---

## 15. Hint ladder

Hints should teach the runtime, not hand out a transaction.

1. **Small cost:** “List the owner and decoded state of the Program, ProgramData, and Buffer accounts.”
2. **Medium cost:** “Write down what the committee checks during review and what execution checks
   later. Are those the same facts?”
3. **Medium cost:** “Who can legally issue Loader-v3 `Write` instructions after approval?”
4. **High cost:** “The approved account address is stable; its payload is not. Inspect Buffer authority.”
5. **High cost:** “An upgrade preserves the Program ID. What other authorities are derived from that
   identity?”

No default brief or free hint says “overwrite the approved Buffer.”

---

## 16. Fairness, accessibility, and event operations

- The Release Desk interaction has no reflex, vision, hearing, handwriting, or language puzzle.
- Approval is a deterministic hash/authority check displayed to both staff and player.
- Publish on-demand review windows and expected wait time; do not bind teams to discovery-time
  appointments.
- Measure clean and failure-path p50/p95 for QR claim, internal RPC read, signer call, submission, and
  finality. Capacity-plan around 60–90 seconds per clean review until measurements prove faster.
- Size desks and published windows for the actual team count and keep sustained utilization below
  roughly 70%; provide a visible queue, spare signer/device, and a separate failure lane.
- Set proposal slot expiry from the measured p95 full-buffer rewrite plus wallet/RPC congestion
  headroom, and define behavior if an instance pauses or restarts.
- Give every team an unlimited local replica. Live scarcity is for final execution judgment, not for
  learning Loader-v3 by guessing.
- Infrastructure-caused failures receive a free reset. An invalid Loader upgrade naturally rolls back
  and remains retryable until expiry; an accidental successful safe upgrade consumes the Buffer and
  follows the written player-error reset policy.
- Solo players may use the same desk flow as teams; no second participant is required.
- The challenge should be marked **hard bonus/finale candidate**, not automatically a fifth core
  challenge. Provide a guided Loader-v3 practice task before the event or as an unscored warmup.

---

## 17. Known risks and design traps

1. **Authority mismatch makes the concept impossible.** Loader-v3 requires Buffer authority and
   ProgramData upgrade authority to match. The release program must explicitly perform the team → PDA
   Buffer-authority handoff before Upgrade.
2. **Same-slot execution confusion.** Newly upgraded code is not immediately callable. The client and
   checker must model the visibility delay without revealing the exploit.
3. **Buffer-size ambiguity.** The malicious ELF must fit the allocated Buffer/ProgramData. Overwriting
   must deterministically handle every trailing byte. Prove this with the exact CLI/uploader players use.
4. **Fake upgrade simulation.** A JavaScript object whose `codeHash` changes is not acceptable. The
   real loader, real ProgramData, real sBPF verifier, and real token transfer are the challenge.
5. **Second unintended bug.** Pin Program ↔ ProgramData, proposal ↔ team/target/Buffer, Token Program,
   reserve, mint, escrow owner, reviewer, nonce, and expiry. The only intended missing invariant is
   reviewed bytes ↔ installed bytes.
6. **Review bottleneck.** Manual review is strong but operational. Use short deterministic checks,
   on-demand published windows, measured capacity, multiple desks, a visible queue, and a failure lane.
7. **Shared-validator abuse.** Cap Buffer size and upload rate, isolate fee payers, and prefer per-team
   validators so one oversized or repeated upload cannot starve others.
8. **Artifact leak.** Native builds create deploy keypairs beside `.so` files. Player packaging must
   copy allowlisted binaries explicitly rather than archiving build directories.
9. **Too much signposting.** The normal release stages can be documented. The mutability gap and PDA
   persistence should be discovered from source and live state.
10. **Over-hard malicious payload.** Give the original treasury seeds, account layout, and a minimal
    native program template. Difficulty should be in the authority chain and release exploit, not in
    wrestling an undocumented build toolchain.

---

## 18. Build plan

### Milestone 0 — loader proof

- complete the mandatory feasibility spike in §13;
- pin Agave, Solana CLI, Rust, and SBF platform-tools versions;
- record exact Buffer/ProgramData metadata offsets, authority transitions, maximum payload size,
  padding/verifier behavior, compute cost, failed-upgrade rollback, and visibility behavior.

### Milestone 1 — challenge programs

- build original treasury, canonical safe release, release governance, malicious reference, and
  patched governance;
- prove the vulnerable and fixed paths with native integration tests;
- keep only one planted security failure.

### Milestone 2 — local player kit

- ship source, safe artifact, legitimate client, uploader, and exact local validator;
- write the unscored Loader-v3 practice flow;
- verify a clean player can reproduce a benign release without organizer files.

### Milestone 3 — Release Desk and identity

- consume participant launch tickets atomically and establish a first-party session;
- implement the separate organizer approval console;
- implement wallet-signed opaque review requests and the replay-safe desk state machine;
- bind review to team/target/Buffer/payload length/digest/approved slot/not-before slot/nonce/expiry;
- isolate reviewer signing from the desk process and rehearse rotation/failover;
- implement deterministic reset and audit logging.

### Milestone 4 — instancer and checker

- create resource-capped isolated validators with authenticated internal/team RPC boundaries;
- persist the finalized instance → review → approval → ProgramData → drain → solve history;
- validate exact reserve → escrow movement and post-approval ProgramData change;
- issue one checker-side HMAC flag per solve;
- add resource, upload, review, and submission limits.

### Milestone 5 — packaging and event QA

- produce explicit player and organizer manifests;
- run key/answer/solver/string leakage gates;
- conduct human, AI-assisted-human, and unattended-agent playtests;
- burn in maximum concurrent validators and uploads;
- rehearse the measured review queue, signer/device failure, infrastructure resets, and post-event solve
  audit;
- prove the real portal → desk → upgrade → drain → checker → scoring-platform path end to end.

---

## 19. Decision and open questions

**Recommendation:** proceed to Milestone 0. On paper, DRESS REHEARSAL is a stronger fifth challenge
than another vault-accounting or missing-account-check pwn because it adds a new Solana subsystem, a
memorable exploit chain, and an in-band human action boundary.

Decide after the spike:

1. exact pinned Agave release and whether the event instance is `solana-test-validator` or another
   validator wrapper with full Loader-v3 parity;
2. native vs Anchor release-governance program (native target replacement remains preferable);
3. safe build size and deterministic Buffer-padding format;
4. exact reset/refund policy after infrastructure failure, accidental safe upgrade, and expired review;
5. proposal lifetime long enough for humans to rewrite/upload safely without becoming a speed puzzle;
6. whether the live Release Desk is staffed by organizers or sponsor security reviewers;
7. whether a small Loader-v3 warmup ships separately for the learner-friendly floor.

Do not add DRESS REHEARSAL to the official slate until the real loader feasibility spike, patched
negative path, and reviewer-throughput rehearsal all pass.
