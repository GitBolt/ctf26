# Solana CTF Learnings, Previous Failures, New Solana Themes, And Challenge Ideas

Compiled: 2026-07-01

Purpose: single source of truth for what failed in the previous Superteam-style Solana CTF, what a better architecture requires, which Solana themes are worth using, and what challenge concepts should be built next.

---

## 1. Executive Summary

The previous CTF was solved too easily because flags and winning inputs existed in public artifacts before the solver actually won. Program binaries, account data, transaction logs, NFT metadata, public hashes, source comments, IDLs, and off-chain assets acted as accidental flag stores.

The fix is structural:

- no flag in public artifacts
- fresh per-team instances
- checker-side flag generation after verified state transition
- randomized per-team state
- no reusable historical traces
- challenges built around real Solana exploit workflows
- AI red-team audit before launch

The target is not “AI can never solve.” That is unrealistic for pure software challenges. The target is:

> An AI cannot solve by reading, scraping, decoding, brute-forcing, replaying, or following a canned API path. If an AI solves, it must perform the same real exploit workflow as a strong human security engineer.

---

## 2. Previous CTF Result

The previous CTF had 14 challenges. 11 were solved. The 3 misses were not strong design wins:

- one was underspecified
- two depended on NFT images stored on ephemeral devnet Irys storage that had been purged

Most important result:

> 11 of 14 flags were captured without sending a single transaction.

### Captured Flags

```text
1  Ghost Admin            ST_FLAG{trust_n0_pubk3y}
2  Good First Impression  ST_FLAG{k3yp41r_gr1nd1ng_ch4mp}
3  Logs Of Truth          ST_FLAG{1sol_2sol_3sol_truth}
4  The Birthday Seed      ST_FLAG{ep0ch_0}
6  Signature Safari       ST_FLAG{s1g_ch4mp_d1d_th3_d1ff}
7  The Lamport Clock      ST_FLAG{a_ba1ance_b0rn_in_2006}
8  Where is the Needle    ST_FLAG{pda_hunt1ng_m4st3r}
9  Wrap It Up Guys        ST_FLAG{und3rfl0w_m4st3r}
11 Do Not Claim Thyself   ST_FLAG{ca11er_n0t_creat0r}
12 Voucher Roulette       ST_FLAG{g00d_on3}
14 Sus Protocol           ST_FLAG{t00k_y0u_a_wh1le}
```

Unsolved:

- `Named by Numbers`: underspecified; no program ID/address/file in the PDF snapshot
- `Monkeys and Bananas`: flag image purged from devnet Irys
- `Stripped Identity`: identity derived correctly, but final flag image purged from devnet Irys

---

## 3. Failure Modes From The Previous CTF

### Public Binary Strings

Challenges solved by dumping deployed programs and running `strings`:

- Ghost Admin
- Logs Of Truth
- Sus Protocol
- Do Not Claim Thyself alt program

Lesson: never compile `ST_FLAG{...}` or final-answer material into deployed binaries. Source placeholders do not matter if the deployed binary contains the real string.

### Public Account Data

Challenges solved by `getProgramAccounts` and decoding account bytes:

- Birthday Seed
- Where is the Needle

Lesson: hiding one real flag among decoys is not security. Agents filter instantly.

### Permanent Historical Logs

Challenges solved by scraping `getSignaturesForAddress` and transaction logs:

- Good First Impression
- Wrap It Up Guys
- Do Not Claim Thyself

Lesson: `msg!("flag")` is permanent. Closing a program does not erase transaction history.

### Public Metadata / Off-Chain Assets

Challenges partly or fully dependent on NFT metadata/images:

- Wrap It Up Guys
- Monkeys and Bananas
- Stripped Identity

Lesson: NFT metadata is public and indexable. Off-chain storage can also disappear, turning a challenge from hard into unsolvable.

### Public Hashes / Small Brute Force

Voucher Roulette was solved because each character had a public MD5 constraint. The answer was the flag and the search space was tiny.

Lesson: published hashes over small spaces are not secrets.

### API/Crypto Validation Bugs

The `$ST Genesis Airdrop` web challenge failed because:

- PoW was automatable
- message was static
- claim tracking used raw signature bytes
- backend accepted non-canonical Ed25519 `S`
- adding the Ed25519 group order to `S` produced multiple distinct signatures that still verified

Fixes:

- reject non-canonical Ed25519 signatures (`S < L`)
- track claims by canonical wallet/team/account, not signature bytes
- bind signed messages to `team_id`, `challenge`, `nonce`, `expiry`, and domain separator
- bind PoW to the exact claim body
- make PoW one-time
- rate-limit and invalidate after success
- add tests for malleated signatures, replayed PoW, duplicate pubkeys, and duplicate team claims

---

## 4. Non-Negotiable Architecture For New CTFs

### Per-Team Instance

Each team gets fresh isolated state:

- fresh deployment or fresh state namespace
- fresh salts
- fresh target amounts
- fresh vaults/markets/accounts
- private checker state
- no shared win condition
- no historical winning trace reusable by another team

### Checker-Generated Flag

The flag must not exist until after a valid solve.

Allowed:

- checker returns a server-generated flag after validating final state
- server-side HMAC flag derived from team/challenge/solve event
- Arcium seals a compact success payload to the solver, then checker releases flag
- live event system reveals flag only after checker confirmation

Forbidden:

- flag in program binary
- flag in source comment
- flag in logs
- flag in account data
- flag in IDL, generated client, tests, fixtures, errors
- flag in NFT name/symbol/URI/image before solve
- flag as a public hash preimage

Recommended flag format:

```text
ST_FLAG{hmac_sha256(server_secret, team_id || challenge_id || solve_id)[0..24]}
```

### Win Condition

The win condition should be a verified state transition, not a string:

- vault drained by exact randomized amount
- escrow increased and owned by team wallet
- fake authority accepted
- invariant broken
- active window used
- intended exploit path evidenced by transaction/account state

### Anti-Shortcut Launch Audit

Before launch, run:

1. dump every deployed program and scan strings
2. fetch every program-owned account and scan bytes
3. fetch signatures/logs/history
4. inspect IDL, generated clients, tests, fixtures, dashboards
5. inspect metadata and off-chain URIs
6. brute force any public hash/encoding space
7. run an AI agent with full repo, RPC, and internet
8. run a human beta solve

If the flag or winning input is readable without executing the exploit, redesign.

---

## 5. Solana Themes Worth Using

The best challenge categories should mirror real audited bug classes:

- business logic
- input validation / account validation
- access control / authorization
- PDA domain separation
- CPI program-ID pinning
- fake token program / interface compatibility
- sysvar spoofing
- instruction introspection mistakes
- ALT account substitution
- account layout assumptions
- stale state / ordering assumptions
- rounding and accounting invariants
- Token-2022 / P-Token compatibility assumptions
- Metaplex Core plugin/authority assumptions
- Arcium callback and sealed-output mechanics

Avoid making arithmetic-only puzzles the center of the event. They are usually easier for agents than humans.

---

## 6. Current Solana Development Themes To Incorporate

Use these as inspiration, but verify exact current details from primary sources before shipping:

- Alpenglow is a major consensus upgrade path, but do not depend on unshipped mainnet behavior.
- P-Token / Pinocchio-style rewrites are excellent challenge material for low-level account layout, compatibility, and CPI assumptions.
- Token-2022 confidential transfers are useful for privacy-themed puzzles, but account addresses and proof/context behavior remain public and matter.
- Address Lookup Tables are good for account-substitution and route-poisoning challenges.
- Light Protocol / ZK compression can inspire account-compression and proof-context challenges, but avoid relying on fragile external infrastructure.
- Arcium is useful where confidential evaluation is actually load-bearing.

Treat promotional claims and version numbers as unstable. Re-check before citing them.

---

## 7. Arcium Use

Arcium is useful for:

- hidden thresholds
- private scoring
- sealed per-solver outputs
- confidential eligibility checks
- encrypted challenge-owned secrets
- preventing read/probe/replay shortcuts

Useful primitives:

- `Enc<Mxe, T>`: encrypted to the MPC/cluster; good for challenge-owned secrets
- `Enc<Shared, T>`: encrypted for a specific client/MXE shared key
- sealing: re-encrypt output to a specific solver key
- `SignedComputationOutputs<T>`: verified callback output

Constraints:

- fixed-size inputs/outputs
- no dynamic `Vec`, `String`, `HashMap`
- no dynamic loops
- no `break`, `continue`, early `return`
- callback output must fit in a Solana transaction
- queued computations and callbacks require careful rent/account handling

Important limitation:

> Arcium stops reading, probing, and replay. It does not stop a capable agent from performing a fully software exploit if the exploit itself is automatable.

Recommended use:

- add Arcium after checker/instance infrastructure works
- start with one challenge: Confidential Threshold Heist or Callback Mirage
- keep output to sealed `[u8; 32]` or a compact success proof

---

## 8. Recommended Challenge Ladder

### 1. Phantom Delegate

Bug class: CPI authority confusion / missing program-ID pinning.

Story: a vault delegates withdrawal authority to an official strategy program. The vault derives strategy authority under a caller-supplied `strategy_program` instead of the official program.

Solver must:

- read source
- deploy attacker program
- derive fake PDA under attacker program
- CPI into vault
- drain exact randomized amount into team escrow

Flag comes only from checker.

### 2. Canonical Bump Casino

Bug class: non-canonical PDA bump / seed namespace collision.

Solver creates a counterfeit chip/table account that passes validation and settles with impossible payout.

### 3. Timelock Without Time

Bug class: fake sysvar / instruction introspection mistake.

Solver crafts a multi-instruction transaction with precise accounts to satisfy fake time checks while real unlock time has not passed.

### 4. Share-Price Round Trip

Bug class: inconsistent rounding / accounting invariant.

Solver loops deposit/borrow/repay/withdraw paths to inflate redeemable assets above a randomized threshold.

### 5. P-Token Doppelganger

Bug class: fake token program / interface compatibility.

Solver uses a fake token-compatible CPI branch to mint protocol shares without real collateral movement.

### 6. ALT Poison Route

Bug class: v0 transaction and Address Lookup Table account substitution.

Solver completes a swap route where protocol accounting says success but assets end in solver escrow.

### 7. Core Asset Royalty Trap

Bug class: Metaplex Core plugin/authority assumptions.

Solver exploits stale plugin authority or collection validation to list/settle an asset that should be blocked.

### 8. Callback Mirage

Bug class: Arcium callback account substitution.

Solver causes another computation result to affect their own state because result accounts are not domain-separated by solver/instance.

### 9. Confidential Threshold Heist

Bug class: public state exploit plus encrypted threshold.

Solver mutates public state to raise score, then submits encrypted proof to Arcium. Threshold is hidden as `Enc<Mxe>`, output sealed to solver.

### 10. Multi-Leader Simulation

Bug class: stale state / ordering assumptions.

Solver finalizes two mutually exclusive claims in a simplified multi-proposer simulator.

---

## 9. Flagship: The Settlement Clerk

Best cheap flagship without physical production.

### Thesis

No pure software challenge can guarantee only humans solve it. The realistic target:

> AI-alone cannot solve from static artifacts; successful solving requires fresh, noisy, limited live context plus real Solana exploit execution.

### Setup

Teams receive:

- vulnerable Solana program source
- IDL
- generated client
- broken dashboard bundle
- stale rehearsal logs
- ambiguous product memo
- live per-team instance
- live clerk endpoint with limited query budget

### Story

Superteam runs an on-site marketplace:

- sponsors issue meal, swag, and bounty vouchers
- attendees trade vouchers
- settlement clerk closes market windows
- every redeemed voucher must be backed by exactly one sponsor deposit

Incident:

> A sponsor says their deposit was charged twice, but the dashboard says settlement is balanced. The clerk insists only one kind of receipt is legally valid. Find the exploit and settle in your favor.

### Bug

`settle_receipt` validates a PDA-like authority using caller-provided `receipt_program` and treats dashboard/sponsor receipt hashes as equivalent when they share a `window_id`.

Bad conceptual check:

```rust
let expected = Pubkey::create_program_address(
    &[
        b"receipt",
        market.key().as_ref(),
        window_id.to_le_bytes().as_ref(),
        receipt_hash.as_ref(),
        &[bump],
    ],
    receipt_program.key,
)?;

require_keys_eq!(expected, receipt_authority.key());
```

### Live Clerk

Endpoint:

```text
POST /clerk/<team_id>/ask
```

Input:

```json
{ "question": "Which receipt type does the clerk accept for sponsor Alpha?" }
```

Output:

```json
{
  "answer": "For this window, the clerk accepts signed settlement receipts, not dashboard receipts.",
  "queries_remaining": 3
}
```

Properties:

- deterministic
- limited budget
- answers business questions, not exploit questions
- changes per window/team
- no flag exposure

### Win Condition

Checker validates:

- team escrow increased by active sponsor-backed amount
- sponsor vault decreased by same amount
- active window used
- dashboard receipt accepted where sponsor receipt was required
- fake receipt authority accepted
- attacker-controlled receipt program used
- no public flag emitted

Then checker returns server-generated flag.

---

## 10. Physical / Live Challenge Position

Physical clues alone are not enough. A user can photograph or transcribe static physical information and give it to an AI.

Physical becomes useful only when it attacks the relay channel:

- real-time timing matters
- signal is continuous
- next cue depends on previous action
- observation and action are coupled
- attempts are supervised and bounded

Use physical/live systems only for a finale or tie-breaker, not every challenge.

Best design: `Sealed Cue`.

- 60-90 second audio/visual/haptic performance
- calibration round teaches hidden rule
- scored round requires timed A/B/C/D responses
- response sequence encrypted and graded by Arcium
- flag seed sealed to solver key on pass

This makes AI assistance weak because a human-to-AI-to-human relay misses the timing window.

---

## 11. Build Plan

### Phase 1: Infrastructure

- fork/adapt `otter-sec/sol-ctf-framework`
- implement per-team instances
- implement checker API: `health`, `start`, `submit`, `status`, `claim_flag`
- implement HMAC flag generation
- implement scoreboard
- implement action logging
- implement safe canary logger

### Phase 2: First Challenge

Build `Phantom Delegate` first:

- cheapest proof of framework
- no Arcium
- no physical layer
- real Solana bug
- solver must deploy attacker CPI program

### Phase 3: Flagship

Build `Settlement Clerk`:

- dynamic server-side context
- limited clerk queries
- stale/misleading evidence
- real exploit path
- prompt-injection decoys

### Phase 4: Arcium Pilot

Build one Arcium challenge:

- `Confidential Threshold Heist` or `Callback Mirage`
- sealed `[u8; 32]` output
- strict callback verification
- rent cleanup tests

### Phase 5: Finale

If budget allows:

- build `Sealed Cue`
- use physical live timing as final human gate

---

## 12. Sources

- Existing local design docs in this folder, consolidated on 2026-07-01.
- Danisy Eisyraf, “How I make CTF challenges harder to solve with AI”: https://danisy-eisyraf-portfolio.super.site/blog-posts/how-i-make-ctf-challenges-harder-to-solve-with-ai
- Arcium docs: https://docs.arcium.com
- OtterSec Solana CTF framework: https://github.com/otter-sec/sol-ctf-framework
- Solana network upgrades: https://solana.com/news/solana-network-upgrades
- Solana Token-2022 confidential transfer docs: https://solana.com/docs/tokens/extensions/confidential-transfer
- Helius Solana/P-Token posts: https://www.helius.dev
- Sec3 Solana Security Ecosystem Review: https://sec3.dev/report

