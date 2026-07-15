# AFTER HOURS — Discord-native Solana checkout

AFTER HOURS is a short Solana payment-reconciliation challenge delivered through the event Discord. A vending-machine application creates a participant-specific Solana Pay order for a Midnight Pass. The participant must make a real on-chain payment that satisfies a verifier which checks value and recipient but mishandles asset identity.

## Format

- Portal launch binds the Google-authenticated participant to a one-use Discord passage.
- Discord slash commands create, inspect, and reconcile an order.
- A wallet or participant-written client submits the Solana transaction.
- The bot accepts only a transaction signature and never requests private wallet material.
- Completion is a durable fulfillment backed by a finalized transaction and server-side receipt.

There is no challenge website. Discord is the application surface, Solana is the payment ledger, and the participant's wallet or script is the transaction composer.

## Learning objective

Token amounts and decimals do not identify an SPL asset. A payment verifier must bind a transfer to the expected mint and token program as well as amount, destination, reference, status, and timing.

The complete organizer specification, vulnerable invariant, answer key, state model, integrity controls, deployment contract, and playtest matrix live in [`../../apps/after-hours/README.md`](../../apps/after-hours/README.md).
