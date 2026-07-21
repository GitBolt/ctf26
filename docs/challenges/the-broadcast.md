# THE BROADCAST

## Player-facing catalog

**Category:** Solana wallet authorization / black-box cryptography

**Format:** Hosted protocol service

**Objective:** Complete the genesis allocation for the Solana wallet authorized by your participant instance.

The service issues a participant-bound message, accepts a Solana wallet signature, and returns Base58 protocol receipts. Players must determine what the service considers a distinct claim and reach the authoritative completed state. An editable claim workbench handles proof-of-work and authenticated submission without exposing the cryptographic construction.

## Organizer boundary

The vulnerable verifier behavior, raw-signature ledger identity, hidden threshold, receipt records, tests, and reference construction are organizer-only. Only the hosted web surface is player-facing.

## Event fit

- Real Solana wallet message signing rather than an arbitrary generated key.
- Participant-bound live state consumed through the portal ticket contract.
- A cryptographic authorization/identity mismatch rather than a static artifact search.
- Body-bound one-time proof of work and per-wallet rate limits.
- No player-visible hint endpoint. In-person organizers deliver an escalating Socratic hint ladder only after a human participant requests help.
- All decoded receipts use the same `video:<11-character ID>` shape: six lead to false-success videos and the distinguished receipt leads to the narrative video. Dashboard completion still comes from authoritative service state.
