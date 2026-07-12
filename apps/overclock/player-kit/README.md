# DRIFT — player kit

You have an unfamiliar native Solana program and a funded target reproduced by the event service.
Recover enough of the instruction and account behavior to produce a profitable state transition.

Included:

```text
dist/drift_vault.so   stripped Solana SBF artifact
manifest.json         artifact hash and size
client.mjs            authenticated target/replay/submission transport
```

Not included: source, IDL, symbols, organizer harness, reference trace, JavaScript model, or checker.

Set the launch ticket and service URL supplied by the event portal:

```bash
export DRIFT_URL='https://drift.example.org'
export DRIFT_TICKET='<short-lived portal ticket>'
```

Inspect the target and download the exact artifact:

```bash
node client.mjs target
node client.mjs artifact > drift_vault.so
sha256sum drift_vault.so
```

The first command exchanges the one-time ticket and stores a team session in `.drift-session` with
owner-only permissions. Later commands reuse it. Delete that file when leaving the event machine; if
it expires, launch DRIFT from the portal again to obtain a fresh ticket.

The submission client accepts a JSON schedule after you have reconstructed the relevant operations.
It deliberately does not describe the program, derive an exploit, or trust reported final state.

```bash
node client.mjs replay submission.json
node client.mjs submit submission.json
```

Every replay uses a fresh canonical instance for your team. Only state produced by the published SBF
program and the declared replay environment is scored.
