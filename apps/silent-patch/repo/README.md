# Quarry Vault

Quarry Vault is the strategy execution layer used by the Quarry treasury service. Vault reserves are
owned by a program-derived authority and rebalanced through small external strategy programs that
implement the public `execute(u64)` interface.

This read-only mirror was assembled from source control, issue export, and code-review backups after
the hosted project was retired. Some review metadata and deployment records are incomplete. The
`current/` tree is the latest source recovered from the default branch.

## Repository layout

- `current/` — latest recovered source
- `prs/` — pull-request and reviewer exports
- `issues/` — maintenance tracker export
- `commits/` — selected commit metadata recovered from build logs

Build fingerprints were recorded by CI, but the original release-to-deployment ledger is unavailable.
