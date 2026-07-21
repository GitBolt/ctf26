# EVIDENCE ROOM

EVIDENCE ROOM is a live Devnet account-lifecycle challenge presented as an after-hours case desk. Each participant receives an isolated case room and a personal room key. No factory source code is supplied.

## Player delivery

The portal launches a signed participant session directly into the room. The page contains the complete player workflow: a reopenable key drawer, one clear case action, review timing, real account links, and the permanent night log. Every successful case counts. A returning player receives the same room and can reopen the key drawer without losing progress.

## Objective

An overnight case creates and funds four new records before its automated process registers them. The player must identify the unfinished account, initialize it before the process does, make that registration fail, then close the account and return its rent deposit to the room key. One fully verified case completes the challenge. Unsuccessful cases may be retried within the funded case budget, after which an event operator can investigate and assist.

## Scope and invariant

Each case transaction creates four real accounts in a case-specific shuffled order. Only one is being prepared by the automated process. The other three are decoys with distinct account types. The target is a real legacy SPL Token Program account that exists before its initialization. The process later attempts to initialize it.

The challenge is completed when one case has:

1. A target initialized by the participant-controlled room key.
2. The records-process initialization for that same target reaches finality with the expected Token Program account-already-in-use failure.
3. A successful finalized SPL Token close-account transaction returning rent to the room key.
4. No external activity on any decoy account.

The actual on-chain state, not a browser assertion, determines completion. Generic RPC or transport failures and failed close transactions never satisfy the proof.

## Integrity and operations

Instances are isolated by participant and every intake uses deterministic participant-scoped keys derived from a server secret. The service records portal launches, room-key reveals, intake events, direct API use, and agent-policy disclosures. Completion is reported through the existing signed leaderboard event flow.

The production service needs a funded Devnet payer, a chain secret, the portal ticket secret, and Redis. The health endpoint reports the Devnet payer balance without exposing private data.
