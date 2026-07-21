# EVIDENCE ROOM player kit

This kit is the normal observation tool for the overnight case desk. It contains no records-process source and no close transaction.

1. Open the evidence-room key drawer in the challenge service.
2. Install dependencies with `npm install` in this directory.
3. Set `EVIDENCE_ROOM_RPC` and `EVIDENCE_ROOM_WALLET` to the values shown by the service.
4. Run `node observer.mjs` while a case is open.

The observer prints account owner, data length, lamports, and token state. It does not classify accounts or submit instructions.
