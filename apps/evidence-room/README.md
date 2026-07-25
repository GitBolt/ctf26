# EVIDENCE ROOM

EVIDENCE ROOM is a hosted Solana Devnet challenge built around a real non-atomic SPL Token account lifecycle. The participant-facing experience presents the lifecycle as an after-hours case desk.

The service is the reserve factory. For every batch it submits a real allocation transaction that creates an uninitialized Token Program account, then later submits the normal account-initialization transaction. The four public records are shuffled for every case. A player who recognizes the state boundary can initialize the target for the case mint first, make the factory initialization fail, and close the empty account to recover its rent.

The public player kit only observes live account state. It does not include factory source, target labels, capture transactions, or an answer. Only one case may be active at a time, up to four treasury-funded cases are available to a participant before operator review, and the first fully verified capture completes the challenge. Two bounded interference credits leave one clean attempt plus one participant-error retry. The service checks actual Devnet account transitions, the specific finalized Token Program account-already-in-use failure from its own factory initialization, a successful finalized close instruction returning rent to the participant wallet, and untouched decoys. The completion time comes from the finalized close transaction block time.

Allocation intent is persisted before broadcast. Deterministic account reconciliation recovers a landed allocation after a process or transport failure. Scheduler work is bounded and parallel across participants so one slow RPC path does not block everyone else. A small, configurable number of cases with activity not signed by the event wallet can be excluded from the participant's funded case budget. This credit is intentionally bounded because signer evidence cannot prove who controlled another wallet.

## Local development

```bash
npm install
npm test
npm start
```

For a real Devnet run configure every value in `.env.example`, including a funded disposable Devnet factory keypair. `ALLOW_DEV_LAUNCH=true` only bypasses portal tickets locally. It does not replace any Devnet transaction with simulated state.

## Production

Deploy this as one Railway service with `apps/evidence-room/Dockerfile`. Configure `/health` as the health check, inject the shared Redis URL, and set `PARTICIPANT_TICKET_SECRET` equal to the portal's `CHALLENGE_TICKET_SECRET_EVIDENCE_ROOM`. Set the portal's `EVIDENCE_ROOM_URL` to the Railway HTTPS domain. Set `EVIDENCE_ROOM_MIN_FACTORY_LAMPORTS` to the event's actual funding floor. Health is ready only when Redis responds, finalized RPC state is readable, and the factory balance is at or above that floor.

The room key is a disposable Devnet keypair. It funds event wallets, the factory mint, and fresh account allocation only. Never use a personal wallet or a key that holds value outside the challenge.

Public Devnet remains a shared, observable environment. An outside party can watch factory transactions and race or disrupt newly revealed accounts. The live configuration grants no automatic interference credits, so a participant cannot manufacture extra treasury-funded attempts with a second wallet. A battle-hardened event should use an isolated validator or an access-controlled RPC and validator environment for this challenge. Redis-backed participant and capacity leases keep expensive work bounded across service replicas.

Launch admission has two stages. A per-address pre-authentication limit and a higher global attempt limit reject cheap ticket floods. Only a ticket with a valid signature enters the authenticated session budget, and its one-time ID is consumed only after provisioning capacity is reserved. A capacity retry therefore does not burn the portal ticket.

Readiness derives the live mint, token-account, and system-account rent, estimates the full four-case cost of one participant, applies `EVIDENCE_ROOM_CAPACITY_BUFFER_BPS`, and derives the maximum supported field from the current factory balance. The portal compares that live maximum with the checked-in roster. At the rent values pinned in the regression test, the estimate is 57,185,760 lamports per participant before the default 10 percent reserve buffer.
