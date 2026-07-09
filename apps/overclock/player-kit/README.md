# OVERCLOCK — Player Kit

The build places the stripped native Solana artifact at:

```text
dist/overclock_vault.so
```

The event deployment must pair this artifact with an isolated SVM instance, seeded accounts, and a
transaction client template. Recover the program's instruction and account formats from the artifact,
produce the required state transition, and submit a reproducible transaction schedule. The organizer
replays the schedule against a fresh canonical target; client-reported account state is ignored.

No source, IDL, organizer harness, reference exploit, or JavaScript model belongs in this player kit.
