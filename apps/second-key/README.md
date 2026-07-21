# SECOND KEY

SECOND KEY is a hosted Solana Devnet collateral challenge. Each participant receives an isolated live case with its own wallet, accounts, vault, and loan state.

The participant surface exposes the real public chain record and the participant wallet required to interact with that case. The approved mint and lending program ID appear as neutral, copyable evidence so a participant can inspect the issued instance without being told what property matters. It does not provide program source, provisioning code, exploit helpers, extension labels, or a solution path.

## Local development

```bash
npm install
npm test
npm start
```

Configure every value in `.env.example` for a real Devnet run. The example program ID identifies the
current rehearsal deployment, but production startup requires both `SOLANA_RPC_URL` and
`SECOND_KEY_PROGRAM_ID` to be pinned explicitly. `ALLOW_DEV_LAUNCH=true` bypasses portal tickets locally
but never replaces chain state with a simulator.

## Production

Deploy with `apps/second-key/Dockerfile` and use `/health` for the Railway health check. Share the participant ticket secret with the portal. The factory key is an event-only Devnet keypair and must never hold mainnet value.

Readiness derives the live cost of each remaining case from the current mint, Token-2022 account, and loan rent exemptions, plus wallet funding, the loan advance, and `SECOND_KEY_FEE_BUDGET_LAMPORTS`. Completed provisions are counted in the event-generation Redis namespace, so the required reserve falls only after a case is durably allocated. `SECOND_KEY_CAPACITY_BUFFER_BPS` adds an operational margin and `SECOND_KEY_MIN_PAYER_LAMPORTS` remains an absolute floor. Readiness fails when the factory cannot fund every unprovisioned participant. Use `SECOND_KEY_EXPECTED_PARTICIPANTS=40` for the current field simulation; the rehearsal example reserves 50 participants.

Provisioning and chain mutations are globally serialized because they share a writable factory payer. RPC-only state and completion reconciliation use a separate bounded read pool, configured with `SECOND_KEY_MAX_READ_CONCURRENCY`. Redis-backed participant leases still reject overlapping work for one participant, while unrelated reads remain available during a write. Bounded rates and operation timeouts keep RPC polling and retries from exhausting the service.

Launch admission applies a per-address pre-authentication limit before a higher global attempt ceiling. Invalid tickets never consume the authenticated session budget. A valid ticket's one-time ID is consumed only after the shared provisioning slot is acquired, so a capacity retry can safely reuse the original portal URL.
