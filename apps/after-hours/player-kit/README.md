# AFTER HOURS — player kit

The venue is closed. The night counter is not.

Start from the CTF26 portal. Invite AFTER HOURS to a Discord server where you can manage apps, then link the one-use passage from a channel in that server:

```text
/afterhours start passage:<your passage>
```

Then use the bot itself:

```text
/afterhours menu
/afterhours allotment wallet:<disposable devnet wallet>
/afterhours buy
/afterhours submit signature:<transaction signature>
/afterhours hint
```

The venue is closed, one Midnight Pass remains, and the unattended counter asks for `10.000000 NIGHT`. The counter issues your disposable devnet wallet a one-time allocation of `7.000000` of the official fixed-supply **After Hours NIGHT (`NIGHT`)** asset. The bot then shows the complete invoice directly in Discord. Complete checkout.

The bot accepts only a finalized Solana transaction signature. Never paste a private key, seed phrase, wallet file, Discord token, portal ticket, or cookie into Discord.

## Local setup

Use a disposable challenge wallet with only devnet funds.

```bash
npm install
```

`checkout.mjs` provides three small utilities:

- `loadDisposableKeypair(path)` loads a keypair file you explicitly choose;
- `orderReferenceInstruction(reference)` keeps the order reference in the transaction account list;
- `submitInstructions({ rpcUrl, payer, instructions })` signs and submits your instructions.

It does not decide which token, accounts, or instructions should satisfy the order. That is the challenge.

Example skeleton:

```js
import {
  loadDisposableKeypair,
  orderReferenceInstruction,
  submitInstructions,
} from "./checkout.mjs";

const payer = await loadDisposableKeypair(process.env.SOLANA_KEYPAIR);
const instructions = [];

// Construct your payment instructions here.

instructions.push(orderReferenceInstruction("REFERENCE_FROM_DISCORD", payer));

const signature = await submitInstructions({
  rpcUrl: process.env.SOLANA_RPC_URL,
  payer,
  instructions,
});

console.log(signature);
```

Keep your source and transaction signature for the short technical explanation required for prize eligibility.
