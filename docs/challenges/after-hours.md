# AFTER HOURS — Discord-native Solana checkout

AFTER HOURS is CTF26's sixth challenge. It is intentionally Discord-native rather than a separate
challenge website.

AFTER HOURS is a short Solana payment-reconciliation challenge delivered through a Discord bot installed into a participant-controlled server. The venue is closed, one Midnight Pass remains, and an unattended night counter asks for `10.000000 NIGHT`. Every participant receives `7.000000` of the real fixed-supply NIGHT devnet token, whose immutable Metaplex metadata identifies it as `After Hours NIGHT (NIGHT)`, creating a credible shortfall before they investigate what the counter actually reconciles.

## Format

- Portal launch gives the Google-authenticated participant a one-use Discord passage and a server-invite link.
- The participant invites the bot to a Discord server where they can manage apps.
- Discord slash commands in that server show the counter, open checkout, and reconcile an order.
- The entire invoice is shown directly in Discord; there is no Solana Pay or secondary checkout page.
- A one-time wallet-bound allotment transfer proves that NIGHT is a real on-chain asset rather than an invented label.
- A wallet or participant-written client submits the Solana transaction.
- The bot accepts only a transaction signature and never requests private wallet material.
- Completion is a durable fulfillment backed by a finalized transaction and server-side receipt.

There is no challenge website. Discord is the application surface, Solana is the payment ledger, and the participant's wallet or script is the transaction composer.

## Learning objective

Token names, symbols, amounts, and decimals do not identify an SPL asset. Metaplex branding is copyable; a payment verifier must bind a transfer to the expected mint and token program as well as amount, destination, reference, status, and timing.

The complete organizer specification, vulnerable invariant, answer key, state model, integrity controls, deployment contract, and playtest matrix live in [`../../apps/after-hours/README.md`](../../apps/after-hours/README.md).
