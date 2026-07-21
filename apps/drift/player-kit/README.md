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

The file is a stripped SBF ELF. Any SBF-aware disassembler is suitable. Solana's packaged LLVM tools
can disassemble it directly, for example:

```bash
llvm-objdump --arch-name=sbf --disassemble --no-show-raw-insn drift_vault.so
```

Solana addresses embedded by a program may appear only as their raw 32-byte public keys rather than
printable base58 strings. Standard Solana SDK or base58 tooling can convert between the two forms.

The first command exchanges the one-time ticket and stores a participant session in `.drift-session` with
owner-only permissions. Later commands reuse it. Delete that file when leaving the event machine; if
it expires, launch DRIFT from the portal again to obtain a fresh ticket.

The submission client accepts a JSON trace after you have reconstructed the relevant operations.
It deliberately does not describe the program, derive an exploit, or trust reported final state.

```bash
node client.mjs replay submission.json
node client.mjs submit submission.json
```

Every replay uses a fresh canonical instance for your participant. Only state produced by the published SBF
program and the declared replay environment is scored.

## Replay protocol

A submission is an object with one `steps` array. The array must contain 1–32 steps. Unknown fields,
unknown operations, non-canonical encodings, and direct account mutations are rejected.

```json
{
  "steps": []
}
```

### Invoke the published program

`invoke` submits one instruction to the published program. `dataHex` is canonical lowercase,
even-length hex. Account order and metadata are preserved exactly.

```json
{
  "op": "invoke",
  "dataHex": "00",
  "accounts": [
    {
      "account": "position",
      "isSigner": false,
      "isWritable": true
    }
  ]
}
```

The canonical instance exposes three generated accounts through stable aliases:

- `attacker` — your funded account and the only account the harness can sign for;
- `vault` — the funded program-owned target;
- `position` — your seeded program-owned position.

Any other `account` value must be a canonical base58 Solana address. The fee payer is internal and is
not part of the submitted account list. The checker does not infer or repair account order, signer
flags, writable flags, instruction tags, or instruction data.

### Replace a supported sysvar

`set_sysvar` replaces a supported Solana sysvar before the next invocation. `address` is the sysvar's
canonical base58 address. `dataBase64` is the standard base64 encoding of its complete canonical
native serialized bytes.

```json
{
  "op": "set_sysvar",
  "address": "<canonical sysvar address>",
  "dataBase64": "<canonical serialized bytes>"
}
```

The replay environment accepts only supported sysvar accounts; it does not permit arbitrary account,
owner, lamport, or program replacement. Which runtime account matters, and how the published program
expects its instructions and accounts to be encoded, are part of the binary-analysis task.
