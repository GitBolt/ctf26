# Challenge Spec — IMPRINT (passkey-gated Solana exploit)

Status: **WORKING BUILD — Challenge 2 of 4 (hardware-auth)** · Updated: 2026-07-10 · Codename: IMPRINT

**One line:** a real, deep Solana security bug in a **passkey-controlled smart vault** — where the
winning exploit action **requires a physical passkey touch (Face ID / Touch ID / YubiKey)** that an
autonomous agent cannot produce. Depth and anti-AI live in the *same real primitive*. Built on `00` §2.

> **Identity in the 4-challenge slate:** the **hardware-auth / cryptographic** challenge. The core
> security task is auditing and exploiting a passkey-controlled Solana vault. The anti-agent property is
> in-band: the winning exploit requires a real passkey assertion and wallet approval. No dynamic-market
> (that's Reward Sniper), no archaeology (that's SIGNET). Real-CTF lineage: real bug-bounty/audit
> work on passkey wallets — a hot 2026 Solana surface.

---

## 1. The real primitive (current, authentic Solana)

- **[SIMD-0075](https://www.helius.dev/blog/solana-passkeys)** went live on Solana mainnet **June 2025**:
  a **secp256r1 precompile** (`Secp256r1SigVerify1111111111111111111111111`) that verifies **P-256 /
  WebAuthn passkey signatures on-chain**. P-256 is the curve behind Face ID, Touch ID, Windows Hello,
  YubiKeys.
- **[LazorKit](https://github.com/lazor-kit/program-v2)** ships passkey-native Solana smart wallets:
  *"every smart wallet is a PDA controlled by a secp256r1 passkey — the passkey IS the authentication."*
- Reference course: **[Blueshift — secp256r1 on Solana](https://learn.blueshift.gg/en/courses/secp256r1-on-solana/introduction)**.

This makes the challenge **authentic** (a live 2026 audit surface) *and* gives us an anti-AI gate rooted
in hardware presence.

---

## 2. The security core (real, deep secp256r1/WebAuthn bug)

A passkey-controlled smart vault verifies a secp256r1 assertion via the precompile + program
introspection. The intended rule: *only this vault's registered passkey, signing over this exact
withdrawal, may withdraw.*

**Canonical planted bug: owner-binding miss.** The program verifies that a WebAuthn assertion is valid
for *some* enrolled passkey, but fails to check that the passkey public key in the verified assertion
matches the target vault's registered passkey. A team can authenticate with its own real passkey, then
use that valid assertion to authorize a vault it should not control.

This is a genuine secp256r1/WebAuthn authority-binding bug — the exact class real auditors would look
for in new passkey smart-wallet programs. **White-box is fine** (`00` §2): the anti-AI is not hiding
the bug; it is requiring the exploit action to include a real hardware-backed assertion.

```rust
// Owner-binding miss (conceptual): verifies A signature exists and is valid,
// but never checks the passkey pubkey == the vault's registered passkey.
verify_secp256r1(precompile_ix, msg, passkey_pubkey)?;         // sig is valid...
// MISSING: require_keys_eq!(passkey_pubkey, vault.registered_passkey);
withdraw(vault, amount, destination)?;                          // ...so ANY registered passkey passes
```

---

## 3. What we give the players

- **Vault program source + IDL** (understanding the verification is fair; forging the hardware touch is
  not) — or a black-box variant with only the WebAuthn/precompile interface, for a harder cohort.
- A **passkey enrollment web app** (WebAuthn `create` / `get`) — teams register their own passkey
  **on-site** (attested) and get a vault.
- A generic assertion workbench that signs a player-supplied 32-byte challenge. It deliberately does
  not derive the withdrawal challenge, assemble the secp256r1 instruction, or submit the exploit.
- A **funded devnet Solana wallet** per team + a registered escrow the scoreboard watches. Phantom,
  Solflare, Backpack, or any wallet with transaction signing support should be compatible.
- Optional venue-local challenge parameter for the high-value drain, delivered in-room or through the
  web app. This is a support layer, not the core security mechanism.
- Starter client for the legit `deposit`/`withdraw`; a hint ladder.

---

## 4. Solve (floor → ceiling)

- **Floor:** enroll a passkey, create a vault, do a legit passkey-signed withdraw. Learn the flow +
  the secp256r1/WebAuthn model (real, current Solana knowledge).
- **Mid:** probe the verification — does it bind the challenge? the owner? Is `s` checked? Form the
  hypothesis (AI may help reason here — fine).
- **Ceiling:** exploit the binding flaw — authenticate with **your own passkey (a physical touch)** and,
  because the binding is broken, drain a vault/treasury you shouldn't be able to → submit through a
  Solana wallet approval. Fewer teams reach this; **first-blood + partial credit** rewards depth.

---

## 5. Anti-AI mechanisms (unique mix) + honest caveats

1. **★ Passkey biometric touch (the anchor).** The exploit's authorization is a WebAuthn assertion from
   a secure element requiring physical user verification. An autonomous agent — even computer-use —
   **cannot produce Face ID / a YubiKey tap.** Strongest software gate available.
2. **Wallet human-approve** for the submit tx — a second agent-hostile action.
3. **On-site enrollment + attestation + proctoring** closes the virtual-authenticator gap.
4. **Optional venue-local parameter** can bind the high-value drain to the live room, but it should not
   be presented as the core anti-AI mechanism.

**Honest caveats (state them):**
- The precompile verifies *any* P-256 sig, so the bug must **not** be "accepts any P-256 sig" — an agent
  would just software-sign. The bug must require authenticating with a **real registered hardware
  passkey**, where the *binding* flaw is misused. That keeps the human touch load-bearing.
- Residual risk: browser **virtual authenticators** (devtools fake passkeys). Close with **on-site
  enrollment under attestation** (platform authenticator, UV required) + **proctoring**.
- A **human driving an AI** (human touches the passkey + approves; AI helped find the bug) succeeds —
  and that's the intended, allowed meta. Honest bar: *autonomous loop can't complete*, not "impossible."

---

## 6. Scoring

- **First-blood + partial credit**, not a pure race: partial for a correct written exploit path in a
  sandbox, full for the live drain via passkey. This is a harder single-exploit challenge, so it
  contributes leaderboard *spread* (few solve it) rather than a contested pool.
- Optional HMAC flag from the checker on the validated on-chain drain, for portal compatibility.

---

## 7. How we build it

- **Anchor vault** verifying the secp256r1 precompile (instruction introspection of the
  `Secp256r1SigVerify…` ix) + the planted binding bug + a **correct-patch reference** for grading.
- **WebAuthn enrollment/assert web app** (platform authenticator, `userVerification: "required"`,
  attestation captured on-site).
- Optional **venue-local parameter** for the per-round challenge value if playtesting shows we need a
  second room-bound action.
- Escrows + indexer + scoreboard; Solana wallet connect + approve for submit.
- **Tests (this is the load-bearing part):** replay, cross-vault (owner-binding), malleable-`s`,
  duplicate/missing precompile ix, virtual-authenticator rejection. The verification path *itself* must
  be airtight except for the one planted bug.

The built registration route derives the on-chain P-256 key only from the credential COSE key returned
by successful WebAuthn verification. It never trusts the client convenience `response.publicKey`.
Withdrawals also enforce the stored RP-ID hash, UP and UV flags, exact challenge field, low-S form, and
the enrolled wallet's Solana signature. Production still requires validated authenticator models and
attestation roots, a dedicated registrar distinct from upgrade authority, and per-team target vaults.

---

## 8. Open decisions

1. Which **binding-bug variant** (owner-binding recommended — clearest to explain and exploit).
2. **White-box vs black-box** source (white-box is fine; black-box raises difficulty for elite cohort).
3. Exact **virtual-authenticator mitigation** (attestation policy + proctoring depth).
4. Whether to include a venue-local parameter for the high-value drain.

### Alternate bug variants for later cohorts

- **Challenge-binding miss:** the program checks a valid signature but not that the signed WebAuthn
  challenge equals *this* withdrawal → replay a prior authorization.
- **Malleability:** it doesn't enforce low-`s` on the ECDSA signature → replay with a mutated sig.
- **Introspection flaw:** it trusts the precompile instruction without checking it signed the right
  message/pubkey → forge.
