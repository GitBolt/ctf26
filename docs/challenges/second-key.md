# SECOND KEY

## Participant premise

A warehouse lending desk recognizes one certified receipt as collateral. The participant receives a participant-bound Devnet instance in the desk itself: the approved mint, personal event wallet, participant token account, lender vault, loan account, lending program, and standard pledge action.

The desk releases a 0.01 SOL advance after moving the receipt into its vault. Its stated rule is simple: the loan stays valid only while the receipt remains in lender custody. The participant must prove that this guarantee is false on the public chain.

## Vulnerability

The lender verifies ownership of the deposited token account but does not inspect the mint-level Permanent Delegate extension. The participant event wallet is the receipt mint's permanent delegate. Token-2022 therefore permits that wallet to authorize a checked transfer from the lender-owned vault even though it is not the token account owner.

## Intended solve

1. Pledge the receipt through the desk and draw the advance.
2. Inspect the certified mint and decode its Token-2022 extensions.
3. Use the issued event wallet to submit a Token-2022 `TransferChecked` instruction from the lender vault back to the exact participant token account.
4. Leave the loan outstanding.

The checker requires the outstanding loan, zero receipt balance in the lender vault, one receipt in the original participant account, and a successful finalized removal transfer whose authority is the participant event wallet. It inspects both top-level and inner Token-2022 instructions and rejects failed transactions. It reports completion only from real Devnet state.

## Delivery and integrity

There is no source download and no simulated chain. The public interface exposes the exact approved mint and lending program ID as neutral evidence but names neither Token-2022 nor any mint extension. It presents the wallet as the borrower's ordinary event wallet and makes the separate PDA vault authority visible without explaining why that relationship can be violated. Technical evidence stays in one chain drawer.

Every participant receives a fresh address namespace and has no prior successful removal transaction to copy. This blocks replay and prevents another participant's trace from revealing the exact winning accounts. It does not make public Devnet state unreadable to an authorized agent. Autonomous resistance therefore relies on the event's access, policy, telemetry, and solve-defense layers rather than claiming RPC obfuscation as a security boundary.

Production pins the Devnet RPC and program ID, uses Redis-backed generation-scoped state, and sets
`SECOND_KEY_MIN_PAYER_LAMPORTS` from the final field size. The health endpoint fails closed when Redis,
the RPC, or the factory payer reserve cannot support another case.
