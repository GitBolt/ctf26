# IMPRINT

IMPRINT is a passkey-gated Solana vault challenge. The planted vulnerability is a missing binding between
a vault's stored P-256 key and the registered key supplied during withdrawal.

## Participant flow

1. The approved participant launches IMPRINT from the portal.
2. The service derives and creates one funded vault PDA from the authenticated participant ID.
3. The participant connects any devnet Solana wallet.
4. On first use, the browser creates a platform passkey with Face ID, Touch ID, Windows Hello, or an
   equivalent platform authenticator. Returning sessions verify the same passkey.
5. The registrar co-signs the participant's on-chain passkey registration transaction.
6. The participant finds the missing vault-to-passkey binding and drains the assigned vault.
7. The checker verifies the finalized transaction against the participant's exact vault, passkey PDA,
   wallet owner, and minimum drain before reporting the solve.

Vault and passkey provisioning are idempotent. Attendance does not need to be known in advance, wallets
are never preassigned, and refreshes do not create duplicate state.

## Anti-agent tradeoff

The live user-verification prompt remains part of the challenge. Registration is intentionally
self-service because the event has no staff capacity for an enrollment ceremony. A software or virtual
WebAuthn authenticator may therefore weaken this gate. Integrity telemetry and the event's normal
prize-contender review remain the backstop. Do not describe self-enrollment as equivalent to
organizer-observed hardware enrollment.

## Canonical devnet state

```text
program            5EgXikx8uaGDDRdLdxzoLsDafSruHZnNnstE7bd8wH6B
upgrade authority  DWtP6GyDdye8hcpogEiAaGN2mJAVdvZV8TmsjFy9Mr4
registrar          AdtCf3S1zEHZ14js7G7vqN5EDatSGC9SxSTDotJBEvJF
```

The operator key derives participant vaults using a generation-specific instance secret. Keep the
operator funded with devnet SOL. The default target deposit is `10000000` lamports and the required
transaction-local drain is `5000000` lamports.

## Layout

```text
programs/imprint/       Anchor program
tests/imprint.js        exploit and negative program tests
web/app/                participant interface and authenticated API
web/lib/auto-provision  deterministic first-launch vault provisioning
web/lib/state-store     Redis-backed passkey records and provisioning leases
web/lib/solve-verifier  finalized transaction attribution
```

## Production configuration

The Vercel project root is `apps/imprint/web`.

```text
SOLANA_RPC_URL=<private-devnet-rpc>
NEXT_PUBLIC_PROGRAM_ID=5EgXikx8uaGDDRdLdxzoLsDafSruHZnNnstE7bd8wH6B

IMPRINT_EXPECTED_ORIGIN=https://st26-imprint.vercel.app
IMPRINT_RP_ID=st26-imprint.vercel.app

CHALLENGE_TICKET_SECRET=<portal-imprint-ticket-secret>
LEADERBOARD_INGEST_URL=<portal-leaderboard-ingest-url>
IMPRINT_SESSION_SECRET=<independent-random-32-byte-secret>
IMPRINT_FLAG_SECRET=<independent-random-32-byte-secret>
CTF_EVENT_GENERATION=<portal-event-generation>

REDIS_URL=<durable-tls-redis-url>
IMPRINT_REDIS_PREFIX=ctf26:imprint:ticket:v1
IMPRINT_STATE_REDIS_PREFIX=ctf26:imprint:state:v2

REGISTRAR_KEYPAIR_JSON=<registrar-keypair-json>
IMPRINT_OPERATOR_KEYPAIR_JSON=<operator-keypair-json>
IMPRINT_INSTANCE_SECRET=<independent-random-32-byte-secret>
IMPRINT_PARTICIPANT_TARGET_REVISIONS_JSON={}
IMPRINT_TARGET_INITIAL_LAMPORTS=10000000
IMPRINT_TARGET_MINIMUM_DRAIN_LAMPORTS=5000000
IMPRINT_MIN_OPERATOR_LAMPORTS=100000000
```

The old static credential roster, target map, rehearsal target, and enrollment-secret variables are not
used. Production health fails closed when Redis, event generation, operator funding, or provisioning
configuration is unavailable.

## Program deployment

The deployed program does not need to change for self-enrollment or lazy vault creation. If the Anchor
program itself changes, rebuild and upgrade the canonical address:

```bash
cd apps/imprint
npm run build

solana program deploy target/deploy/imprint.so \
  --program-id 5EgXikx8uaGDDRdLdxzoLsDafSruHZnNnstE7bd8wH6B \
  --upgrade-authority .keys/imprint-operator-v2.json \
  --fee-payer .keys/imprint-operator-v2.json \
  --url devnet \
  --commitment confirmed \
  --use-rpc
```

After upgrading, verify that the program authority remains
`DWtP6GyDdye8hcpogEiAaGN2mJAVdvZV8TmsjFy9Mr4`.

## Launch verification

```bash
npm --prefix apps/imprint/web test
npm --prefix apps/imprint/web run build
npm --prefix apps/imprint run lint
```

Then use a fresh approved participant identity and a real platform authenticator:

1. Launch from the portal and confirm a unique vault is created.
2. Refresh and confirm the same vault is returned.
3. Connect a user-selected wallet.
4. Create the platform passkey and confirm the biometric or device-verification prompt appears.
5. Sign and submit the registrar-co-signed transaction.
6. Reopen the challenge and confirm the same passkey authenticates without creating another credential.
7. Drain a player-created lookalike vault and confirm the checker rejects it.
8. Complete the exploit against the assigned vault and confirm the leaderboard receives exactly one solve.
