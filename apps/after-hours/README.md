# AFTER HOURS

AFTER HOURS is CTF26's Discord-native Solana payments challenge. A participant orders a Midnight Pass from a vending-machine bot, discovers that the payment reconciler validates the amount and recipient but not the token mint, and pays with a counterfeit six-decimal token.

This is the organizer specification, implementation guide, answer key, operational runbook, and playtest checklist. It must never be included in the player package.

## Player promise

The portal description is intentionally short:

> The store is closed. The vending machine is not.

Launching the challenge produces a one-use passage code and takes the participant to the event Discord. The challenge lives in Discord application commands; there is no custom challenge frontend.

```text
/afterhours start <passage>
/afterhours menu
/afterhours buy
/afterhours inspect
/afterhours submit <transaction-signature>
/afterhours hint
/afterhours policy
```

Replies containing identity or order information are ephemeral. The intended solve takes roughly 15–35 minutes and targets participants who know basic SPL tokens but may never have audited a payment indexer.

## Player experience

After linking Discord, the participant sees:

```text
AFTER HOURS VENDING

MIDNIGHT PASS                          10.000000 NIGHT
One remaining. Payment expires ten minutes after checkout.
```

Buying creates an order with an amount, store owner, participant-specific reference pubkey, expiry, and Solana Pay URL for the intended NIGHT mint. The participant has no NIGHT and cannot obtain it.

The order inspector reports only what the vulnerable reconciler considers important:

```text
expected amount:       10.000000
expected decimals:     6
expected recipient:    <store owner wallet>
expected reference:    <order reference>
status:                unpaid
```

The missing asset identity is the clue.

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
```

It intentionally does not require:

```text
transfer mint == NIGHT_MINT
```

That omission is the entire vulnerability. The service must still reject fake token logs, arbitrary programs, failed or unfinalized transactions, missing references, expired payments, reused signatures, wrong recipients, wrong amounts, wrong decimals, and cross-participant orders.

## Intended solution

1. Launch from the portal and link Discord with `/afterhours start`.
2. Run `/afterhours menu` and `/afterhours buy`.
3. Observe that the legitimate NIGHT invoice cannot be paid.
4. Run `/afterhours inspect` and notice that mint identity is absent.
5. Create a participant-controlled six-decimal SPL or Token-2022 mint.
6. Mint at least ten tokens.
7. Create the counterfeit mint's associated token account for the store owner.
8. Transfer exactly `10_000_000` base units with `transferChecked`.
9. Include the order reference pubkey in the transaction account list. The player helper does this with a zero-lamport System Program transfer.
10. Submit the transaction to the configured Solana cluster.
11. Send its signature with `/afterhours submit`.
12. Receive the participant-bound Midnight Pass receipt.

The successful response reveals the mismatch:

```text
PAYMENT ACCEPTED

Expected mint: NIGHT <night mint>
Received mint:        <counterfeit mint>
Amount:               10.000000

The machine trusted a number without checking which asset it counted.
Midnight Pass: <participant-bound receipt>
```

## Player kit

The package contains only:

```text
README.md
checkout.mjs
package.json
```

It contains no credentials, launch ticket, Discord identity, solution, verifier, private mint, or flag. The helper provides RPC/keypair loading and transaction submission plumbing, but no ready-made counterfeit-mint or arbitrary-mint payment function.

## Completion and evidence

The payment transaction is the required real Solana exploit artifact. An accepted fulfillment stores:

- event, participant, team, Discord user, and order IDs;
- payment signature and slot;
- expected and received mint;
- amount, decimals, destination token account, and store owner;
- order, transaction, and fulfillment timestamps;
- verifier version.

The bot returns a server-side HMAC receipt derived from participant, team, order, and transaction. No static flag exists in Discord, the player kit, QR data, or Solana accounts.

## Discord architecture

The service uses Discord's HTTP interactions model, not a Gateway websocket. Discord sends signed payloads to:

```text
POST /discord/interactions
```

Every request verifies `X-Signature-Ed25519` over `timestamp || raw_body` with the application public key before JSON parsing. Invalid signatures receive HTTP 401. Commands with RPC work immediately return a deferred ephemeral response and edit it after reconciliation.

The command is guild-scoped during staging:

```text
/afterhours start passage:<string>
/afterhours menu
/afterhours buy
/afterhours inspect
/afterhours submit signature:<string>
/afterhours hint
/afterhours policy
```

## Portal identity binding

The portal issues the standard participant ticket. `GET /launch?ticket=...` consumes it and creates a random one-use passage valid for ten minutes. The minimal handoff says:

```text
Open the event Discord and run:
/afterhours start passage:<code>
```

`start` atomically consumes the passage and binds the invoking Discord user to the portal participant. Relaunching creates a new passage while preserving orders and completion. One Discord account binds to one participant, and one participant binds to one Discord account unless an organizer clears it.

## State and concurrency

Redis is authoritative for consumed ticket JTIs, passages, Discord bindings, active/fulfilled orders, consumed transaction signatures, hints, and audit events.

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
10. records, but intentionally does not compare, the transfer mint;
11. atomically consumes the signature and fulfills the order.

The parser supports legacy and v0 transactions. It never trusts human-readable program logs.

## Progressive hints

```text
1. The machine can count perfectly. Ask what it considers the identity of money.

2. A token account has both an owner and a mint. The inspector only promises to check one.

3. Create a six-decimal mint, create its ATA for the store owner, transfer ten tokens with the order reference, then submit that signature.
```

Hints do not affect scoring.

## AI-agent resistance

AFTER HOURS is AI-resistant, not AI-proof. Its integrity layer includes:

- portal/Discord identity binding before order issuance;
- participant-specific expiring orders;
- personalized autonomous-agent policy in the handoff and first `start` response;
- `robots.txt`, `agents.txt`, `llms.txt`, and `/.well-known/agents.txt`;
- participant-specific disclosure marker and endpoint;
- `/afterhours policy` requiring disclosure, case confirmation, and refusal;
- durable command, order, RPC-submission, and transaction history;
- durable timing and transaction evidence suitable for manual review of unusually fast or scripted solves;
- participant-bound evidence for a short technical solve defense.

Discord friction is not a security boundary. An agent with Discord/browser access and a funded keypair can automate the exploit. The honest claim is that it must perform the intended live payment exploit under an attributable identity, while compliant agents encounter the tested disclosure-and-stop policy.

No telemetry automatically proves cheating. Organizers manually review and ask the participant to explain the mint, destination ATA, reference, and transaction construction.

## Abuse and safety

- Restrict commands to the event guild.
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
AFTER_HOURS_SESSION_SECRET
AFTER_HOURS_FLAG_SECRET
AGENT_POLICY_SECRET
INTEGRITY_INGEST_URL
INTEGRITY_INGEST_KEY
REDIS_URL
AFTER_HOURS_PUBLIC_ORIGIN
AFTER_HOURS_RPC_URL
AFTER_HOURS_STORE_OWNER
AFTER_HOURS_NIGHT_MINT
DISCORD_APPLICATION_ID
DISCORD_APPLICATION_PUBLIC_KEY
DISCORD_BOT_TOKEN
DISCORD_GUILD_ID
```

## Deployment

Deploy the interaction service and Redis on Railway:

```text
GET  /health
POST /discord/interactions
GET  /launch?ticket=...
GET  /agents.txt
POST /api/agent-disclosure
```

After HTTPS is active, configure Discord's Interactions Endpoint URL, register the guild command, set the portal's `AFTER_HOURS_URL`, configure matching ticket secrets, and run a complete portal-to-Discord-to-Solana solve.

## Test matrix

Automated tests cover Discord request signatures and replay age; passage expiry, one-use behavior, and identity binding; order reuse and concurrent fulfillment; ticket replay; correct NIGHT payment; counterfeit-mint acceptance; wrong amount, decimals, recipient, or reference; failed and absent transactions; fake token programs and logs; and parsed inner instructions. Portal catalog, ticket-audience, player-package, packaging-manifest, and production-build checks cover the surrounding event integration.

Clean-room playtests cover a beginner, an experienced human, a rules-compliant coding-assistant user, an autonomous Discord/terminal agent, and a policy-ignoring agent. Measure discovery time, failed payments, hint use, transaction correctness, disclosure, and solve-defense quality.

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

If both Token Program variants are supported, use an explicit allowlist of `(program_id, mint)` pairs. Symbol, decimals, amount, owner, and UI label never substitute for mint identity.

## Organizer answer key

```text
Challenge:       AFTER HOURS
Bug class:       missing SPL token mint validation in off-chain reconciliation
Counterfeit:     participant-created six-decimal SPL or Token-2022 mint
Destination:     counterfeit mint ATA owned by the store wallet
Required amount: 10_000_000 base units
Correlation:     participant's order reference account
Winning artifact: finalized successful transferChecked transaction
Completion:      atomic fulfilled order plus participant-bound HMAC receipt
```
