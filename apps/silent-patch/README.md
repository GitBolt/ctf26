# SILENT PATCH

Stale-deployment source-archaeology CTF with an executable Solana authority path.

The latest fictional repo is fixed. The live target is an older pre-fix deployment. Players use the
patch to understand the bug, then exploit the stale live target. Do not describe this as exploiting a
fixed bug.

## What is built here

- a vulnerable Anchor vault that lets the caller choose a strategy program, then forwards the
  vault's own SPL-token authority PDA to that program as a signer;
- a malicious strategy program that reuses the forwarded signer in an SPL-token CPI;
- a fixed vault that pins the strategy program before forwarding signer privilege;
- an on-chain integration test proving the vulnerable drain and fixed rejection;
- a deterministic service/checker model for portal integration (not a substitute for SVM replay);
- a fictional repo archive with PRs, issues, decoys, and the quiet strategy-refactor patch.

## Run

```bash
npm test
npm run test:onchain
npm run play -- target
npm run play -- demo-exploit
npm run play -- latest-fails
```

## Player POV

1. Read the portal target: a live program is running an older commit.
2. Inspect the fictional repo archive under `repo/`.
3. Find the quiet strategy refactor that pins the strategy program id.
4. Infer that the stale vault forwards its trusted PDA signer to a caller-selected program.
5. Deploy or invoke a compatible malicious strategy and drain the stale target into the team escrow.

The model checker does not accept "the bug is X" as a solve. Event deployment should validate the
actual per-team on-chain reserve/escrow transition; the JavaScript checker is retained only for local
portal development.

Set a unique `FLAG_SECRET` of at least 32 characters before running any production checker. The local
model secret is accepted only outside `NODE_ENV=production`.
