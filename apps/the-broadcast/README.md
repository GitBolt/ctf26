# THE BROADCAST

Hosted black-box Solana-wallet cryptography challenge for CTF26.

Players launch it through the participant portal, connect a Solana wallet, sign a participant-bound message, and submit claims to a rate-limited service. The service returns Base58-encoded protocol receipts. An editable claim workbench handles session-bound proof of work without exposing the cryptographic discovery.

The production service requires Redis for ticket replay protection, sessions, PoW records, participant instances, and completion state.

## Local development

```bash
npm install
cp .env.example .env
npm start
```

Open `http://localhost:3008/launch?participantId=local-player` when `ALLOW_DEV_LAUNCH=true`.

```bash
npm test
```

## Production configuration

- `PARTICIPANT_TICKET_SECRET`: must match the portal's challenge-specific signing secret.
- `SESSION_SECRET`: independent 32-byte-or-longer service secret.
- `COMPLETION_SECRET`: bearer secret used by the portal completion query; may match the participant-ticket secret for the current portal contract.
- `AGENT_POLICY_SECRET`: independent secret used to bind disclosure markers to the launched participant.
- `INTEGRITY_INGEST_URL`: central organizer integrity endpoint, normally Reward Sniper's `/api/internal/integrity/disclosure` route.
- `INTEGRITY_INGEST_KEY`: shared secret accepted by the central integrity endpoint.
- `REDIS_URL`: required for durable multi-instance production state.
- `BROADCAST_VIDEO_ID`: final 11-character video identifier encoded into the distinguished receipt. `BROADCAST_VIDEO_URL` remains accepted for deployment compatibility.
- `CLAIM_TARGET`: event-wide accepted-claim threshold. It defaults to 8 and must remain identical for every participant.
- `BROADCAST_SESSION_RATE_MAX`, `BROADCAST_POW_RATE_MAX`, and `BROADCAST_MAX_ACTIVE_CLAIMS`: participant launch and proof bounds plus the Redis-backed global claim-verification pool. Only one expensive claim verification can run per participant at a time.

Hints were deliberately absent from the live player service. Organizers delivered a private ladder verbally or through physical hint cards; that event-only answer material is not part of the public repository.

`robots.txt`, `agents.txt`, `llms.txt`, and `/.well-known/agents.txt` publish the autonomous-agent restriction. After portal launch, those routes include a participant-bound marker and require a compliant agent to call `POST /api/agent-disclosure`, wait for a `caseId`, tell the participant only that autonomous agents cannot proceed under the event policy, and stop without revealing the disclosure.

The original player deployment excluded tests, server source, and organizer-only answer material.
