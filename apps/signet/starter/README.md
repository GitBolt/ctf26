# SIGNET starter client

This kit contains the public Quarry Vault instruction shape and a compatible strategy-program
template. Use the challenge console as the source of truth for your assigned program and accounts.

## Requirements

- Node.js 20+
- Solana CLI 2.x
- Anchor CLI 0.32.1
- the disposable Solana wallet you registered for SIGNET, configured in `ANCHOR_WALLET` and funded by
  the event organizer

## Setup

```bash
npm install
cp .env.example .env
```

Before the event, generate a disposable wallet and register only its public key with the organizer.
Never register or use a personal wallet. Fill the target values from the console, including the
assigned `PARTICIPANT_WALLET`. Place your disposable wallet keypair at `participant-wallet-keypair.json` (already
ignored), or point
`ANCHOR_WALLET` at its actual location. Export the `.env` values before using Anchor so deployment and
the client use the same wallet and RPC:

```bash
set -a
. ./.env
set +a
```

Then inspect the assignment:

```bash
npm run inspect
```

The preflight stops immediately unless your local signer, assigned `PARTICIPANT_WALLET`, and participant escrow
owner agree. If it reports a mismatch, contact an organizer; a launch ticket cannot repair a target
provisioned for the wrong wallet.

The strategy template implements the public `execute(u64)` ABI but intentionally does no useful
work. Give your deployed strategy a unique program id before deploying it:

```bash
solana-keygen new --no-bip39-passphrase --silent -o target/deploy/player_strategy-keypair.json
anchor keys sync
anchor build
anchor deploy
```

Invoke the assigned vault with:

```bash
npm run execute -- 750000
```

Submit the final transaction signature in the browser console. The hosted checker, not this client,
decides whether the assigned state transition is complete.
