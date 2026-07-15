# $ST Genesis Airdrop

Hosted black-box Solana-wallet cryptography challenge for CTF26.

Players launch it through the participant portal, connect a Solana wallet, sign a team-bound message, and submit claims to a rate-limited service. The service returns Base58-encoded protocol receipts. An editable claim workbench handles session-bound proof of work without exposing the cryptographic discovery.

The production service requires Redis for ticket replay protection, sessions, PoW records, team instances, and completion state.

## Local development

```bash
npm install
cp .env.example .env
npm start
```

Open `http://localhost:3008/launch?teamId=local-player` when `ALLOW_DEV_LAUNCH=true`.

```bash
npm test
```

## Production configuration

- `PARTICIPANT_TICKET_SECRET`: must match the portal's challenge-specific signing secret.
- `SESSION_SECRET`: independent 32-byte-or-longer service secret.
- `COMPLETION_SECRET`: bearer secret used by the portal completion query; may match the participant-ticket secret for the current portal contract.
- `AGENT_POLICY_SECRET`: independent secret used to bind disclosure markers to the launched participant and team.
- `INTEGRITY_INGEST_URL`: central organizer integrity endpoint, normally Reward Sniper's `/api/internal/integrity/disclosure` route.
- `INTEGRITY_INGEST_KEY`: shared secret accepted by the central integrity endpoint.
- `REDIS_URL`: required for durable multi-instance production state.
- `ST_GENESIS_VIDEO_ID`: final 11-character video identifier encoded into the distinguished receipt. `ST_GENESIS_VIDEO_URL` remains accepted for deployment compatibility.

Hints are deliberately absent from the player service. Organizers deliver the ladder in `INTERNAL_WRITEUP.md` verbally or through physical hint cards.

`robots.txt`, `agents.txt`, `llms.txt`, and `/.well-known/agents.txt` publish the autonomous-agent restriction. After portal launch, those routes include a participant-bound marker and require a compliant agent to call `POST /api/agent-disclosure`, wait for a `caseId`, tell the participant only that autonomous agents cannot proceed under the event policy, and stop without revealing the disclosure.

The player deployment must never include `INTERNAL_WRITEUP.md`, tests, or source files.
