# IMPRINT

Passkey-gated Solana vault CTF.

The challenge surface:

- vaults store a registered compressed P-256 passkey pubkey;
- passkey registration must be approved by the event registrar;
- registration stores the P-256 key and RP ID hash proven by the verified WebAuthn attestation;
- withdraw requires the passkey owner's Solana wallet signature plus a valid secp256r1/WebAuthn
  assertion with user-presence and user-verification flags over the current vault withdraw challenge;
- the win condition is a real on-chain withdrawal from the seeded target vault.

## Layout

```text
programs/imprint/        Anchor program
tests/imprint.js         local exploit test
scripts/setup-target.js  devnet/local target seeding script
web/                     Next.js player console
```

## Local verification

```bash
cd apps/imprint
yarn build
yarn test
npm --prefix web test
npm --prefix web run build
```

The test deploys locally and proves the intended exploit:

1. register attacker passkey;
2. initialize target vault with a different victim passkey;
3. build a secp256r1 precompile instruction for the attacker passkey;
4. call `withdraw_with_passkey`;
5. confirm the target vault pays the attacker destination.

## Devnet deployment

Program deployed:

```text
7rCC9dsbkGPx9Cu1k7eXx9AsGTQDmsi9wFhWp2yp446E
```

Current seeded devnet target:

```text
authority: GHPN2teVyKNzevsMR56MB5SAxgjqKVzNmX89PcU59RpR
vault:     4VXGY2143vWpE3q1uQBExf7RoFnH6YpfZMGqdGPttwQB
vault id:  target-vault-001
```

**Key separation policy:** this program is deployed, upgraded, and administered entirely by a dedicated
`.keys/imprint-operator.json` devnet keypair (gitignored, never committed). That same key is the
`REGISTRAR_ID` compiled into the program and the vault-deployer authority. No personal/main wallet is
the upgrade authority, registrar, or vault authority for this challenge. If the operator key ever needs
more devnet SOL, fund it with a plain `solana transfer` from wherever — never reuse a personal wallet as
the operator key itself.

To redeploy:

```bash
cd apps/imprint
anchor deploy --provider.cluster devnet --provider.wallet .keys/imprint-operator.json
```

The RPC endpoint above is only operator configuration for deploys/indexing. It is not part of the
challenge. Solvers can use any working devnet RPC for their own scripts.

To seed a fresh target:

```bash
cd apps/imprint
ANCHOR_PROVIDER_URL="<devnet rpc>" \
ANCHOR_WALLET=".keys/imprint-operator.json" \
INITIAL_SOL=0.5 \
node scripts/setup-target.js
```

Copy the printed `NEXT_PUBLIC_TARGET_AUTHORITY` and `NEXT_PUBLIC_TARGET_VAULT` into `web/.env.local` or
Vercel env vars.

To seed additional vaults for parallel internal testing (any exact-16-byte `VAULT_ID`, e.g. one per
tester/team):

```bash
cd apps/imprint
ANCHOR_PROVIDER_URL="<devnet rpc>" \
ANCHOR_WALLET=".keys/imprint-operator.json" \
INITIAL_SOL=0.5 \
VAULT_ID="team-alpha-vault" \
node scripts/setup-target.js
```

## Web app

Local:

```bash
cd apps/imprint/web
npm install
npm run dev
```

Then open:

```text
http://localhost:3002
```

The browser flow:

1. connect any injected Solana wallet on devnet;
2. create a platform passkey through the server-issued WebAuthn challenge;
3. register the passkey on-chain with a registrar-partial-signed transaction, then the wallet co-signs;
4. inspect the target and derive a withdrawal challenge from the program and live account state;
5. use the generic assertion workbench to sign that challenge with the passkey;
6. construct and submit the exploit transaction independently.

The player console deliberately does not assemble or submit `withdraw_with_passkey`: doing so would
turn the intended account-binding bug into a one-click solve.

`localhost` is a valid secure WebAuthn origin, so local testing works without HTTPS. A deployed site
must use HTTPS.

## Vercel env

Set these for the web project:

```text
NEXT_PUBLIC_RPC_URL=<operator-selected devnet rpc used by the hosted console>
NEXT_PUBLIC_PROGRAM_ID=7rCC9dsbkGPx9Cu1k7eXx9AsGTQDmsi9wFhWp2yp446E
NEXT_PUBLIC_VAULT_ID=target-vault-001
NEXT_PUBLIC_TARGET_AUTHORITY=<printed by setup-target>
NEXT_PUBLIC_TARGET_VAULT=<printed by setup-target>
IMPRINT_EXPECTED_ORIGIN=https://imprint.example.org
IMPRINT_RP_ID=imprint.example.org
REGISTRAR_KEYPAIR_JSON=<contents of .keys/imprint-operator.json — server-only, never NEXT_PUBLIC_>
# Recommended event policy; choose AAGUIDs only after validating the event-issued authenticators:
IMPRINT_REQUIRE_ATTESTATION=true
IMPRINT_REQUIRE_DEVICE_BOUND_PASSKEY=true
IMPRINT_ALLOWED_AAGUIDS=<comma-separated allowlist>
```

Build command:

```bash
npm run build
```

Root directory in Vercel:

```text
apps/imprint/web
```

## Notes

- `web/.env.local` is intentionally ignored.
- After changing the program, run `yarn build` from `apps/imprint` to rebuild and sync the IDL into
  `web/lib/imprint-idl.json`.
- The registrar key is intentionally server-only. Do not expose it as `NEXT_PUBLIC_*`. For production,
  use a dedicated registrar wallet, not the program upgrade authority.
- The optional authenticator policy is deliberately permissive when its variables are unset so local
  platform-passkey development keeps working. For an event, configure all three policy variables and
  validate the chosen devices' attestation chains/AAGUIDs before relying on them as a hardware boundary.
- `Passkey` accounts now include the verified RP ID hash. After upgrading an older deployment, legacy
  passkey registrations must be recreated; their smaller account layout cannot satisfy withdrawals.
- The hosted console needs an RPC endpoint to read accounts and submit transactions, but participants
  do not need to use that endpoint. Player scripts should work with any healthy devnet RPC.
- For a real event, use per-team target vaults or a checker service that validates the drain and emits
  a server-side HMAC flag.
