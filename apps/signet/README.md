# SIGNET

SIGNET is a stale-deployment/source-archaeology Solana CTF challenge with an executable CPI authority
failure. The public brief gives a participant its live vault, opaque build fingerprint, current project
source repository, starter client, and one objective: move the assigned reserve into the registered participant escrow.
It does not tell players that the deployment predates the latest source or that a patch matters.

The organizer-only implementation contains three programs:

- `quarry-vault`: the deliberately deployed pre-fix vault. A caller selects the strategy program and
  the vault forwards its SPL-token authority PDA to that program as a signer.
- `attacker-strategy`: a test-only proof that the forwarded signer can be reused in a token-program
  CPI to drain the reserve.
- `quarry-vault-fixed`: the latest behavior. It pins the strategy program before forwarding privilege.

The public repository at `https://github.com/GitBolt/signet` contains current fixed source and a
realistic commit history. Archaeology identifies the authority-model change; only a live,
participant-bound reserve-to-escrow transition solves the challenge.

## Player service

The production service is deployable as a Vercel project rooted at this directory. It provides:

- signed, audience-bound CTF launch-ticket exchange;
- atomic one-time ticket consumption through Redis over Railway TCP or Vercel-compatible REST;
- an HTTP-only, signed first-party challenge session;
- participant-specific target manifests with live finalized token balances;
- a direct link to the public GitHub source repository;
- a generated starter-client archive;
- a finalized Solana transaction checker;
- deterministic HMAC flags bound to participant, instance, transaction, and final escrow balance;
- production submission rate limiting.

The checker does not trust a claimed amount or a text answer. It verifies all of the following from
the finalized transaction metadata:

1. the assigned vault program was actually invoked;
2. the assigned reserve and escrow were writable transaction accounts;
3. the registered participant wallet signed;
4. reserve and escrow token accounts use the assigned mint and expected authorities;
5. reserve loss equals escrow gain in the submitted transaction;
6. that delta meets the randomized target threshold;
7. final reserve and escrow balances satisfy the canonical instance bounds.

The browser never receives the private RPC URL, ticket key, session key, instance secret, or flag key.

## Local development

```bash
npm install
npm test
npm run dev
```

Open `http://127.0.0.1:4173`. Outside production, when no target manifest is configured, the service
uses an explicitly labelled interface preview. Submit `demo-drain` to exercise the success state. This
preview is not the event checker.

Run the executable Anchor proof separately:

```bash
npm run build:onchain
npm run test:onchain
```

Other model diagnostics remain available:

```bash
npm run play -- target
npm run play -- demo-exploit
npm run play -- latest-fails
```

## Production configuration

Copy `.env.example` into the deployment secret manager. Generate independent random values of at
least 32 bytes for:

- `FLAG_SECRET`
- `CHALLENGE_TICKET_SECRET`
- `CHALLENGE_SESSION_SECRET`
- `INSTANCE_SECRET` (provisioning only; do not give this to Vercel unless provisioning there)

Configure one Redis transport plus a private `SOLANA_RPC_URL`:

- Railway: `REDIS_URL=redis[s]://...`
- Vercel/Upstash: `KV_REST_API_URL` + `KV_REST_API_TOKEN` (the standard
  `UPSTASH_REDIS_REST_URL`/`UPSTASH_REDIS_REST_TOKEN` names are also accepted)

When both are present, `REDIS_URL` takes precedence. The portal must issue participant tickets with
audience `signet`. `PUBLIC_SOLANA_RPC_URL` is optional and is used only for Explorer links when
`SOLANA_EXPLORER_CLUSTER=custom`.

Checker work is protected by participant and global rate limits, a Redis-backed one-operation lease,
and a bounded global slot pool. `Retry-After` is returned for capacity and rate rejections. The public
health endpoint caches Redis and RPC probe results briefly so monitoring or hostile polling cannot
amplify into dependency traffic.

Launch attempts first enter a source-IP bucket and a high-ceiling global attempt bucket. Only a
cryptographically valid portal ticket consumes participant and valid-session admission capacity, and
the JTI is consumed only after admission succeeds. Invalid-ticket floods therefore cannot spend the
capacity reserved for real participants. The browser still retries temporary `429` launch pressure a
bounded six times before returning control to the participant.

Production normally stores one target per participant in Redis under
`ctf26:signet:<event_generation>:target:<participant_id>`. `SIGNET_TARGETS_JSON` is an optional
small-event/rehearsal fallback;
when present, it is an object keyed by the ticket's `participant_id`:

```json
{
  "participant-17": {
    "instanceId": "signet-a19ef84b7b82",
    "programId": "<base58 program id>",
    "vaultAccount": "<base58 vault PDA>",
    "vaultAuthority": "<base58 authority PDA>",
    "reserveAccount": "<base58 SPL token account>",
    "escrowAccount": "<base58 participant-owned SPL token account>",
    "mint": "<base58 challenge mint>",
    "participantWallet": "<base58 registered wallet>",
    "buildFingerprint": "a47a867fea8ec39e",
    "thresholdRaw": "750000",
    "initialReserveRaw": "1000000",
    "initialEscrowRaw": "0",
    "decimals": 0,
    "cluster": "devnet",
    "tokenSymbol": "QRY"
  }
}
```

`npm run publish-targets` validates the complete input before one atomic Redis publish. It writes a
generation-bound inventory marker only after every target write in that operation. Production health fails
closed without this marker and returns only `targetInventory.count` and
`targetInventory.participantIdsSha256`. The digest is SHA-256 over the JSON encoding of the sorted participant
ID array. The portal must compare both fields with its checked-in individual field; no participant IDs are
included in the health response or inventory marker.

The service refuses malformed addresses, invalid balance bounds, missing participant assignments, weak
secrets, replay-store failures, and absent production authentication.

## Chain deployment and target provisioning

Never use `~/.config/solana/id.json` or a personal wallet. Generate a disposable challenge operator
under the ignored `.keys/` directory and fund it with only the SOL needed for the event:

```bash
mkdir -p .keys
solana-keygen new --no-bip39-passphrase -o .keys/signet-operator.json
```

Before the first deployment, create dedicated program keypairs in `target/deploy/`, run
`anchor keys sync`, rebuild, and review the resulting program IDs. Deploy the vulnerable program with
the SIGNET operator as its upgrade authority. The fixed and attacker programs are required for local
regression testing, not for the live player target.

Provision each participant after the vulnerable program is deployed:

Collect a freshly generated, disposable Solana public key from every participant during registration. The
participant retains the private key; organizers fund that public key with the fixed challenge SOL budget and
bind it into the target below. Reject personal wallets and duplicate wallet registrations. Run a
roster preflight before opening SIGNET so every portal `participant_id` has exactly one funded wallet and one
published target.

```bash
PARTICIPANT_ID=participant-17 \
PARTICIPANT_WALLET=<registered-wallet> \
SOLANA_RPC_URL=<private-rpc> \
SOLANA_CLUSTER=devnet \
OPERATOR_KEYPAIR=.keys/signet-operator.json \
VAULT_PROGRAM_ID=<deployed-vulnerable-program> \
INSTANCE_SECRET=<independent-32-byte-secret> \
npm run --silent provision > participant-17-target.json
```

Provisioning deterministically randomizes the participant seed, starting reserve, and required recovery,
creates a participant-owned escrow, initializes the vault/reserve PDAs, seeds the complete challenge supply,
and revokes mint authority. Publish one or more emitted target objects into the same Redis instance used
by the service:

```bash
REDIS_URL=<railway-redis-url> \
npm run publish-targets -- participant-17-target.json
```

For the REST transport, replace `REDIS_URL` with `KV_REST_API_URL` and `KV_REST_API_TOKEN`.

For a small rehearsal, target objects can instead be merged into `SIGNET_TARGETS_JSON`. Do not use one
large environment variable for the full event roster.

For stronger isolation, deploy a separate vulnerable program ID per participant and provision each manifest
against that ID. A shared immutable program with per-participant PDAs is cheaper, but it requires RPC policy
and event rules to prevent participants from griefing another assignment. The checker itself never accepts a
cross-participant transaction.

## Launch gates

Before opening the event:

- run `npm test` and `npm run test:onchain` against the exact release commit;
- confirm the live program hash/fingerprint and target manifest agree;
- verify mint authority is revoked for every challenge mint;
- confirm reserve owner is the assigned vault-authority PDA and escrow owner is the participant wallet;
- exercise one sacrificial end-to-end instance, including ticket replay rejection and flag issuance;
- verify the latest fixed program rejects the same attacker strategy;
- inspect the generated starter tarball and public browser assets for secrets/private keys;
- run desktop, narrow-screen, keyboard-only, and failure-state UI checks;
- run the human-driven, AI-assisted, and autonomous-agent playtest matrix;
- retain an RPC/indexer fallback and a reset plan for unsolved instances.

## Vercel deployment and smoke test

Create a dedicated Vercel project with **Root Directory** set to `apps/signet`. The included
`vercel.json` runs the deterministic web build, publishes `public/`, packages the protected `repo/`
files with each API function, adds strict browser headers, and caps function duration at 15 seconds.

Set the production environment variables from `.env.example`, omit `SIGNET_TARGETS_JSON` when using
the Redis target store, then deploy from this directory:

```bash
vercel deploy --prod
```

No deployment command is run automatically by this repository. After deployment, use the returned
origin in this exact smoke sequence:

```bash
ORIGIN=https://<signet-project>.vercel.app

# Must be 200 with {"ok":true,"service":"signet","mode":"live"}.
curl --fail-with-body "$ORIGIN/api/health"

# Static shell is public, but participant state must be session-gated.
curl --fail-with-body "$ORIGIN/" >/dev/null
test "$(curl -sS -o /tmp/signet-target.json -w '%{http_code}' "$ORIGIN/api/target")" = "401"

# Launch through the event portal with a fresh audience=signet ticket.
# The browser must remove ?ticket=..., receive an HttpOnly signet_session cookie,
# load only that participant's manifest, open the source repository, and download the starter archive.
```

For the sacrificial end-to-end instance, execute the real reserve recovery, submit its finalized
signature in the UI, confirm the flag on the scoreboard, resubmit to verify deterministic behavior,
and verify that the same signature is rejected under another participant's session. Reusing the original
launch URL must fail because its JTI was consumed atomically.

## Railway deployment

Railway can run the same service as one long-lived Node container and use the existing Railway Redis
TCP endpoint. Keep the service source/root at the repository root so the local
`packages/participant-ticket` dependency remains inside the Docker build context. Set Railway's config
file path to `apps/signet/railway.json`; it selects `apps/signet/Dockerfile.railway` and
watches only SIGNET plus the shared ticket package.

Attach the Redis service and apply `railway.env.example`, especially:

```text
REDIS_URL=${{Redis.REDIS_URL}}
NODE_ENV=production
HOST=0.0.0.0
FLAG_SECRET=<independent 32+ byte secret>
CHALLENGE_TICKET_SECRET=<independent 32+ byte secret>
CHALLENGE_SESSION_SECRET=<independent 32+ byte secret>
SOLANA_RPC_URL=<private devnet RPC>
```

The container installs production dependencies only, builds the deterministic starter archive, runs
as the unprivileged `node` user, binds Railway's injected `PORT`, closes Redis cleanly on SIGTERM, and
uses `/api/health` for both Docker and Railway readiness. The health endpoint returns 200 only after
Redis answers `PONG`, the Solana RPC answers `getHealth`, and all production secrets meet minimum
length. The repository-root `.dockerignore` excludes every `.keys` directory, keypair JSON, local env
file, Anchor ledger, and build target before Docker receives the context.

After Railway reports healthy, use the same smoke sequence above with the Railway public origin.
Unauthenticated `/api/target` must remain 401, and a fresh portal ticket must establish the signed
first-party session exactly once.

No git commit, program deployment, target provisioning, or Vercel publication is performed by the
local build scripts.
