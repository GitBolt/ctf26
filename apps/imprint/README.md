# IMPRINT v2 — operator runbook

IMPRINT is a passkey-gated Solana vault challenge. Its intended on-chain vulnerability remains the
missing binding between a vault's stored P-256 key and the supplied registered key during withdrawal.
The event boundary is intentionally outside that bug: only an organizer-enrolled platform passkey can
become a registered passkey account, and the final assertion requires a live user-verification prompt.

An agent can inspect the program and prepare a transaction. It cannot finish autonomously because it
does not possess the event-issued hardware key or its user-presence action.

## Security model

- **No public registration endpoint.** Player-created WebAuthn registrations, including `fmt: "none"`,
  are never accepted by the live service.
- **Platform-passkey roster.** During organizer check-in, staff enroll one Touch ID, Face ID, Windows
  Hello, or equivalent platform credential per team while the participant is present. The resulting
  credential ID and COSE public key are held in the server-only
  `IMPRINT_CREDENTIAL_ROSTER_JSON` setting.
- **Portal-bound claim.** A team arrives with a signed portal ticket, proves possession of its assigned
  platform passkey, and receives the registrar-co-signed on-chain registration transaction.
- **Exact-target checking.** The server issues a flag only after the configured canonical target—not a
  player-created lookalike—has lost the configured net amount in a transaction signed by that team's
  claimed passkey-owner wallet.

The old deployed program, target, and registrations are unsafe. Do not reuse any of them for v2.

## Layout

```text
programs/imprint/        Anchor program; intended vault-to-passkey binding bug
tests/imprint.js         local exploit and negative tests
scripts/setup-target.js  organizer-only canonical target seeding
web/                     player console, platform-passkey claim flow, server checker
web/app/enroll/          organizer-only, pre-event roster enrollment screen
```

## Fresh v2 deployment

1. Disable the old IMPRINT Vercel deployment or at minimum remove its registration and target access.
   Existing software-created passkey accounts remain valid on its old program, so changing web
   variables alone is not a repair.

2. Generate a **fresh program keypair**, a dedicated registrar keypair, and a dedicated operator/target
   funder. Do not reuse the old program ID, target vault, or registrar key.

   Suggested commands (example):

   ```bash
   cd apps/imprint
   cp target/deploy/imprint-keypair.json target/deploy/imprint-keypair-v1-backup.json
   solana-keygen new --no-bip39-passphrase --outfile target/deploy/imprint-keypair.json

   mkdir -p .keys
   solana-keygen new --no-bip39-passphrase --outfile .keys/imprint-registrar-v2.json
   solana-keygen new --no-bip39-passphrase --outfile .keys/imprint-operator-v2.json
   ```

   Then update these compile-time values in source before build/deploy:

   - `declare_id!` in `programs/imprint/src/lib.rs`
   - `REGISTRAR_ID` in `programs/imprint/src/lib.rs`
   - `REGISTRAR_ID` in `web/lib/registrar.mjs`
   - `imprint =` entry in `Anchor.toml`

   After editing `lib.rs`, run `anchor keys sync` (or equivalent update) so `declare_id!` and
   the deploy keypair line up.

3. Update all compile-time values before building:

   - `declare_id!` in `programs/imprint/src/lib.rs` with the fresh program ID;
   - `[programs.devnet].imprint` in `Anchor.toml` with that same ID;
   - `REGISTRAR_ID` in `programs/imprint/src/lib.rs` and `web/lib/registrar.mjs` with the fresh
     registrar public key.

4. Build and deploy the program, then copy its regenerated IDL into the web project:

   ```bash
   cd apps/imprint
   npm run build
   ANCHOR_PROVIDER_URL="<devnet-rpc>" \
   ANCHOR_WALLET=".keys/imprint-operator-v2.json" \
   anchor deploy --provider.cluster devnet
   ```

5. Seed one fresh canonical target. The seeding script prints both the public target address and the
   exact checker-balance values.

   ```bash
   cd apps/imprint
   ANCHOR_PROVIDER_URL="<devnet-rpc>" \
   ANCHOR_WALLET=".keys/imprint-operator-v2.json" \
   INITIAL_SOL=0.5 \
   node scripts/setup-target.js
   ```

   Preserve the printed `IMPRINT_INITIAL_TARGET_LAMPORTS`; it includes the account's actual balance.
   `IMPRINT_MINIMUM_DRAIN_LAMPORTS` should normally be the prize deposit printed by the script, not
   gross transaction volume.

## Organizer platform-passkey enrollment

Use the participant's own platform authenticator (Touch ID, Face ID, Windows Hello, or equivalent).
The participant must be physically present for the biometric/user-verification prompt. Do not accept
credentials created remotely or supplied as arbitrary JSON.

1. Temporarily deploy the web app with `IMPRINT_ENROLLMENT_ENABLED=true`, a strong
   `IMPRINT_ENROLLMENT_ADMIN_SECRET`, and optionally an AAGUID allowlist for approved platform
   authenticators.
2. Open `https://<imprint-host>/enroll` on the participant's device. Enter the one-time admin secret
   and team ID, then create the credential with Touch ID, Face ID, or Windows Hello.
3. Copy the returned JSON record into the server-only `IMPRINT_CREDENTIAL_ROSTER_JSON` array. One record
   is required for every team; credential IDs and P-256 keys must be unique.
4. Redeploy with `IMPRINT_ENROLLMENT_ENABLED=false` (or remove the enrollment routes in the production
   deployment) and rotate/delete the enrollment admin secret.

The enrollment interface is an organizer ceremony, not a participant feature. Its secret must never
be supplied to a player browser, checked into the repository, or configured on the live event project.

## Vercel configuration

Set the Vercel root directory to:

```text
apps/imprint/web
```

Use `npm run build` as the build command. Set every variable below in the **production** environment;
none of the unprefixed values may be exposed to the browser.

```text
NEXT_PUBLIC_RPC_URL=https://api.devnet.solana.com
NEXT_PUBLIC_PROGRAM_ID=<fresh-v2-program-id>
NEXT_PUBLIC_VAULT_ID=target-vault-001
NEXT_PUBLIC_TARGET_VAULT=<printed-by-setup-target>

IMPRINT_EXPECTED_ORIGIN=https://imprint.example.org
IMPRINT_RP_ID=imprint.example.org

CHALLENGE_TICKET_SECRET=<same-32+-byte-value-as-portal-CHALLENGE_TICKET_SECRET_IMPRINT>
IMPRINT_SESSION_SECRET=<independent-random-32+-byte-secret>
IMPRINT_FLAG_SECRET=<independent-random-32+-byte-secret>

IMPRINT_CREDENTIAL_ROSTER_JSON=<complete-organizer-generated-array>
REGISTRAR_KEYPAIR_JSON=<fresh-registrar-keypair-json>

IMPRINT_TARGET_VAULT=<printed-by-setup-target>
IMPRINT_INITIAL_TARGET_LAMPORTS=<printed-by-setup-target>
IMPRINT_MINIMUM_DRAIN_LAMPORTS=<printed-by-setup-target>

IMPRINT_ENROLLMENT_ENABLED=false
```

The portal's `CHALLENGE_TICKET_SECRET_IMPRINT` must match this app's `CHALLENGE_TICKET_SECRET` exactly.
`NEXT_PUBLIC_TARGET_VAULT` and `IMPRINT_TARGET_VAULT` must also match; the checker rejects a mismatch.

## Mandatory launch checks

Run these before opening the portal link:

```bash
npm --prefix apps/imprint/web test
npm --prefix apps/imprint/web run build
npm --prefix apps/imprint test
```

Then perform a human-only red-team test on the fresh deployment:

1. Launch through the portal and claim one assigned platform passkey.
2. Confirm that the claim causes a Touch ID, Face ID, or Windows Hello prompt and fails without the
   enrolled credential.
3. Attempt a forged `fmt: "none"` registration against the old public paths; both paths must be 404.
4. Attempt to claim with a non-rostered passkey; it must fail before a registrar-signed
   transaction is returned.
5. Create a player-controlled vault and drain it; `/api/solve` must reject it.
6. Complete the intended exploit against the exact fresh target using the assigned platform passkey; the
   checker must return one deterministic server-side flag.

Only after all six checks pass should the portal's `IMPRINT_URL` be pointed at the fresh deployment.
