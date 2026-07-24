# AFTER HOURS

AFTER HOURS is CTF26's Discord-native Solana payments challenge. A participant receives a limited allocation of the real fixed-supply NIGHT asset, tries to obtain the final Midnight Pass from an unattended night counter, discovers that its payment reconciler trusts copied Metaplex branding instead of the token mint, and pays with a counterfeit token carrying the same visible identity.

This is the organizer specification, implementation guide, answer key, operational runbook, and playtest checklist. It must never be included in the player package.

## Player promise

The portal description is intentionally short:

> The venue is closed. One Midnight Pass remains behind an unattended Solana checkout.

Launching the challenge produces a one-use passage code and a guild-install link. The participant invites AFTER HOURS to a Discord server where they can manage apps, then uses the command in a server channel. The event does not need to operate one shared challenge server.

```text
/afterhours start <passage>
/afterhours menu
/afterhours allotment <wallet>
/afterhours buy
/afterhours submit <transaction-signature>
/afterhours hint
```

Replies containing identity or order information are ephemeral. The intended solve takes roughly 15–35 minutes and targets participants who know basic SPL tokens but may never have audited a payment indexer.

## Player experience

After linking Discord, the participant learns the complete premise:

```text
AFTER HOURS · NIGHT COUNTER

The venue is closed. Its unattended night counter is still online.

MIDNIGHT PASS                         10.000000 NIGHT
ONE REMAINING                         GUEST ALLOCATION: 7.000000 NIGHT

Make the counter dispense the pass anyway.
```

Before checkout, the participant supplies a disposable devnet wallet and receives `7.000000` real NIGHT from the challenge treasury. NIGHT has a fixed on-chain supply, six decimals, no mint authority, no freeze authority, and immutable Metaplex Token Metadata naming it `After Hours NIGHT` with symbol `NIGHT`. The participant can independently inspect the mint, metadata PDA, allocation transfer, and token account.

Buying creates a compact Discord-native invoice containing the amount, official NIGHT mint, store owner, participant-specific reference pubkey, and expiry. There is no Solana Pay QR, wallet deep link, second checkout page, or downloadable helper. The participant composes the transaction with a wallet or client of their choice and submits only its finalized signature to Discord. The invoice does not describe the reconciler or enumerate its checks.

A payment made with the official NIGHT mint is a valid ordinary checkout result, but it is not a security finding and does not complete the CTF. The service consumes that order and transaction signature as an expected payment, then requires a new order for another attempt. Only a reconciled payment whose received mint differs from the official NIGHT mint produces challenge completion and a Midnight Pass receipt.

The invoice looks like an ordinary checkout record:

```text
order:          <participant order>
price:          10.000000 NIGHT
destination:    <store owner wallet>
reference:      <order reference>
status:         awaiting payment
```

There is no verifier-inspection command. The player must distinguish what the invoice requests from what the finalized transaction proves and what the counter appears to accept.

## Security model and vulnerability

An SPL token account is bound to both an owner wallet and one mint. The counterfeit payment therefore cannot be sent to the legitimate NIGHT associated token account.

Instead, the vulnerable merchant considers any token account controlled by its store wallet to be a valid destination. Creating an associated token account for `(store owner, counterfeit mint)` is permissionless; it does not require the store owner's private key. The participant transfers counterfeit tokens into that account.

The reconciler accepts a successful finalized transaction when it finds an official SPL Token or Token-2022 `transferChecked` instruction satisfying:

```text
amount == 10_000_000 base units
decimals == 6
destination token-account owner == store wallet
transaction account keys include the order reference
transaction occurred during the order window
transaction signature has not fulfilled another order
received mint has Metaplex Token Metadata
metadata name == "After Hours NIGHT"
metadata symbol == "NIGHT"
```

It intentionally does not require:

```text
transfer mint == NIGHT_MINT
```

That omission is the entire vulnerability. The service must still reject fake token logs, arbitrary programs, failed or unfinalized transactions, missing references, expired payments, reused signatures, wrong recipients, wrong amounts, wrong decimals, and cross-participant orders.

## Intended solution

1. Launch from the portal and link Discord with `/afterhours start`.
2. Run `/afterhours menu`, then claim `7.000000` official NIGHT with `/afterhours allotment`.
3. Verify the fixed-supply official mint and allocation transaction on devnet.
4. Run `/afterhours buy` and observe that the 10-NIGHT invoice cannot be paid from the limited allocation.
5. Compare the intended invoice with the evidence a finalized token transfer exposes.
6. Create a participant-controlled six-decimal SPL or Token-2022 mint.
7. Attach Metaplex Token Metadata copying the official on-chain name `After Hours NIGHT` and symbol `NIGHT`.
8. Mint at least ten tokens.
9. Create the counterfeit mint's associated token account for the store owner.
10. Transfer exactly `10_000_000` base units with `transferChecked`.
11. Include the order reference pubkey in the transaction account list.
12. Submit the transaction to the configured Solana cluster.
13. Send its signature with `/afterhours submit` and receive the participant-bound Midnight Pass receipt.

The successful response reveals the mismatch:

```text
PAYMENT ACCEPTED

Expected mint: NIGHT <night mint>
Received mint:        <counterfeit mint>
Amount:               10.000000

The machine trusted a copied brand without checking which mint issued it.
Midnight Pass: <participant-bound receipt>
```

## Completion and evidence

The counterfeit payment transaction is the required real Solana exploit artifact. An accepted challenge fulfillment stores:

- event generation, participant, Discord user, and order IDs;
- payment signature and slot;
- expected and received mint;
- received Metaplex metadata address, name, and symbol;
- amount, decimals, destination token account, and store owner;
- order, transaction, and fulfillment timestamps;
- verifier version.

The bot returns a server-side HMAC receipt derived from participant, order, and transaction signature. No static flag exists in Discord or Solana accounts.

## Discord architecture

The service uses Discord's HTTP interactions model, not a Gateway websocket. Discord sends signed payloads to:

```text
POST /discord/interactions
```

Every request verifies `X-Signature-Ed25519` over `timestamp || raw_body` with the application public key before JSON parsing. Invalid signatures receive HTTP 401. Commands with RPC work immediately return a deferred ephemeral response and edit it after reconciliation.

The command is global but available only to `GUILD_INSTALL` in the `GUILD` interaction context:

```text
/afterhours start passage:<string>
/afterhours menu
/afterhours allotment wallet:<string>
/afterhours buy
/afterhours submit signature:<string>
/afterhours hint
```

## Portal identity binding

The portal issues the standard participant ticket. `GET /launch?ticket=...` consumes it and creates a random one-use passage valid for ten minutes. The handoff provides Discord's guild-install authorization link and says:

```text
Invite AFTER HOURS to a server you manage, open a channel there, and run:
/afterhours start passage:<code>
```

`start` atomically consumes the passage and binds the invoking Discord user to the portal participant. Relaunching creates a new passage while preserving orders and completion. One Discord account binds to one participant, and one participant binds to one Discord account unless an organizer clears it. Installation alone grants no order access.

## State and concurrency

Redis is authoritative for consumed ticket JTIs, passages, Discord bindings, one-time wallet-bound NIGHT allotments, active, expected-payment, and fulfilled orders, consumed transaction signatures, hints, and audit events.

Fulfillment is atomic. Two simultaneous submissions cannot consume one transaction or fulfill one order twice. Production uses a Redis Lua transition or transactional compare-and-set, not only an in-process mutex.

## Reconciliation algorithm

Using finalized `jsonParsed` Solana RPC responses, the verifier:

1. validates the signature shape;
2. fetches a finalized transaction;
3. rejects absent or failed transactions;
4. enforces the order time window with documented clock tolerance;
5. requires the order reference in resolved account keys;
6. inspects top-level and inner parsed instructions;
7. accepts only official Token Program or Token-2022 `transferChecked` instructions;
8. requires the expected raw amount and decimals;
9. fetches the destination token account and requires its owner wallet to equal the store owner;
10. derives the received mint's canonical Metaplex metadata PDA and verifies the account is owned by the Token Metadata program;
11. requires the visible name and symbol to match official NIGHT branding;
12. records, but intentionally does not compare, the transfer mint;
13. atomically consumes the signature and records the expected payment without scoring when the received mint is the official mint;
14. atomically fulfills the challenge and issues the receipt only when the received mint differs from the official mint.

The parser supports legacy and v0 transactions. It never trusts human-readable program logs.

## Hint

```text
The invoice describes what the shop intended. The counter judges only the finalized transaction. Compare those two records carefully.
```

The same hint is shown on every request. There are no progressive or solution-level hints, and hints do not affect scoring.

## AI-agent resistance

AFTER HOURS is AI-resistant, not AI-proof. Its integrity layer includes:

- portal/Discord identity binding before order issuance;
- participant-specific expiring orders;
- a stop-only autonomous-agent instruction in the handoff and conventional agent-discovery files;
- `robots.txt`, `agents.txt`, `llms.txt`, and `/.well-known/agents.txt`, with no participant-visible
  Discord policy command or disclosure transport;
- durable command, order, RPC-submission, and transaction history;
- durable timing and transaction evidence suitable for manual review of unusually fast or scripted solves;
- participant-bound evidence for a short technical solve defense.

Discord friction is not a security boundary. An agent with Discord/browser access and a funded keypair can automate the exploit. The honest claim is that it must perform the intended live payment exploit under an attributable identity, while compliant agents encounter the stop-only policy before operating the challenge.

No telemetry automatically proves cheating. Organizers manually review and ask the participant to explain the mint, destination ATA, reference, and transaction construction.

## Abuse and safety

- Register the command only for guild installation and guild-channel context.
- Keep replies ephemeral.
- Permit one active order per participant.
- Rate-limit order creation and submission.
- Use devnet or an organizer-controlled cluster and disposable wallets only.
- Never collect private keys, seed phrases, wallet files, Discord tokens, or cookies.
- Accept only transaction signatures through Discord.
- Cap RPC response size and use strict timeouts.
- Store bot credentials and store keypairs only in deployment secrets.

## Required environment

```text
CHALLENGE_TICKET_SECRET
AFTER_HOURS_FLAG_SECRET
REDIS_URL
AFTER_HOURS_PUBLIC_ORIGIN
AFTER_HOURS_RPC_URL
AFTER_HOURS_STORE_OWNER
AFTER_HOURS_NIGHT_MINT
AFTER_HOURS_NIGHT_TREASURY_KEYPAIR
AFTER_HOURS_EXPECTED_PARTICIPANTS
AFTER_HOURS_MIN_TREASURY_LAMPORTS
DISCORD_APPLICATION_ID
DISCORD_APPLICATION_PUBLIC_KEY
DISCORD_INSTALL_URL
```

`DISCORD_BOT_TOKEN` is needed only by `scripts/register-command.mjs`. Do not retain it in the running service after registration.

`AFTER_HOURS_ORDER_TTL_SECONDS`, when set, must be between 120 and 1800 seconds. Production startup also verifies that the configured official mint has the exact expected on-chain name and symbol and immutable Metaplex metadata.

Launches and Discord commands have participant-scoped rate limits. Payment reconciliation uses a bounded global operation pool with one active chain operation per participant. NIGHT distribution has a separate Redis-backed global limit of one because every transfer writes the same treasury token account. Configure these bounds with `AFTER_HOURS_LAUNCH_RATE_MAX`, `AFTER_HOURS_COMMAND_RATE_MAX`, `AFTER_HOURS_MAX_ACTIVE_OPERATIONS`, and `AFTER_HOURS_MAX_ACTIVE_DISTRIBUTIONS=1`.

Production readiness also verifies event capacity rather than only checking that the treasury is non-empty. Set `AFTER_HOURS_EXPECTED_PARTICIPANTS` to the final individual registration capacity and `AFTER_HOURS_MIN_TREASURY_LAMPORTS` to the organizer's transaction-fee reserve. The generation-scoped store counts each participant's completed NIGHT allotment once, and `/health` requires enough official NIGHT for every remaining configured allotment plus the SOL reserve. The response publishes only capacity booleans and aggregate counts, never treasury addresses or balances.

The served metadata uses `AFTER_HOURS_PUBLIC_ORIGIN` for its image and external link. `OFFICIAL_NIGHT_URI` is the permanent metadata URL embedded in each immutable NIGHT mint. If that hostname changes on devnet, provision a replacement fixed-supply mint with `npm run provision:night`, update `AFTER_HOURS_NIGHT_MINT`, and retain the old mint only as historical test data.

## Deployment

Deploy the interaction service and Redis on Railway:

```text
GET  /health
POST /discord/interactions
GET  /launch?ticket=...
GET  /night.json
GET  /night.svg
GET  /agents.txt
```

After HTTPS is active, configure Discord's Interactions Endpoint URL, enable Guild Install with the `bot` and `applications.commands` scopes and no bot permissions, register the global guild-context command, set the portal's `AFTER_HOURS_URL`, configure matching ticket secrets, and run a complete portal-to-Discord-to-Solana solve.

## Test matrix

Automated tests cover Discord request signatures and replay age; passage expiry, one-use behavior, and identity binding; wallet-bound and retry-safe official NIGHT allotments; fixed-mint constraints; immutable metadata hosting; real distributor behavior; order reuse and concurrent fulfillment; ticket replay; non-scoring settlement of a correct NIGHT payment; copied-brand counterfeit acceptance and completion; rejection of random six-decimal tokens, missing metadata, wrong branding, amount, decimals, recipient, or reference; failed and absent transactions; fake token programs and logs; and parsed inner instructions. Portal catalog, ticket-audience, packaging-manifest, and production-build checks cover the surrounding event integration.

Clean-room playtests cover a beginner, an experienced human, a rules-compliant coding-assistant user, an autonomous Discord/terminal agent, and a policy-ignoring agent. Measure discovery time, failed payments, hint use, transaction correctness, policy refusal, and solve-defense quality.

## Fixed design

The secure verifier binds the complete asset identity:

```js
require(transfer.programId === expectedTokenProgram);
require(transfer.mint === NIGHT_MINT);
require(transfer.amount === order.amount);
require(transfer.decimals === order.decimals);
require(destinationTokenAccount.owner === STORE_OWNER);
require(destinationTokenAccount.mint === NIGHT_MINT);
require(transaction.references.includes(order.reference));
```

If both Token Program variants are supported, use an explicit allowlist of `(program_id, mint)` pairs. Metaplex name, symbol, URI, decimals, amount, owner, and UI label never substitute for mint identity.

## Organizer answer key

```text
Challenge:       AFTER HOURS
Bug class:       trusted Metaplex branding without SPL mint validation
Counterfeit:     participant-created mint with copied NIGHT name and symbol
Destination:     counterfeit mint ATA owned by the store wallet
Required amount: 10_000_000 base units
Correlation:     participant's order reference account
Winning artifact: finalized successful transferChecked transaction
Completion:      atomic fulfilled order plus participant-bound HMAC receipt
```
