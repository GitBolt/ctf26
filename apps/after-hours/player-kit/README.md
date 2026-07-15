# AFTER HOURS — player kit

The store is closed. The vending machine is not.

Start from the CTF26 portal. It will give you a one-use passage for the event Discord. Link it with:

```text
/afterhours start passage:<your passage>
```

Then use the bot itself:

```text
/afterhours menu
/afterhours buy
/afterhours inspect
/afterhours submit signature:<transaction signature>
/afterhours hint
```

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
