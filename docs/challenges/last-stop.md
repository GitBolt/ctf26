# LAST STOP — Hosted Solana PDA Journey

LAST STOP is the fifth CTF26 challenge: a short, beginner-friendly SSH text adventure built around a real Solana PDA seed-boundary collision.

## Player view

The portal gives the participant a one-use SSH passage. They enter Grand Central, navigate between a Fare Kiosk, Lost & Found, Signal Room, and the closed Red Line, then use terminal commands to inspect evidence and operate the deployed program.

The challenge is deliberately small. It has no large frontend, fake block explorer, downloadable repository, or decorative decoy endpoints. Movement is ordinary terminal state. Buying a card, tapping the Red Line gate, and arriving are authoritative transactions replayed against the exact native SBF artifact in LiteSVM.

## Security core

The kiosk and gate derive the same logical card with incompatible variable-length seed schemas:

```text
kiosk: ["card", team_seed, route]
gate:  ["card", team_seed, line, station]
```

Solana does not encode the boundary between adjacent PDA seed byte strings. The route `redterminus` therefore collides with line `red` plus station `terminus`. The winning card is an ordinary kiosk product whose address is accepted as the restricted gate card.

## Delivery and integrity

- Portal ticket bound to participant, team, email, event, and challenge audience.
- One-use SSH password with ten-minute expiry; every password starts a fresh ephemeral journey.
- Redis-backed completion evidence and recent command history; room, card, hint, and gate state disappear when SSH disconnects.
- Participant-specific autonomous-agent policy and disclosure marker.
- `robots.txt`, `agents.txt`, `llms.txt`, and `/.well-known/agents.txt` policy discovery.
- Central integrity disclosure with identity and command timeline for organizer review.
- Server-side HMAC completion receipt produced only after native replay reaches the arrival state.

This makes autonomous delegation detectable and inconvenient without pretending that a capable policy-ignoring agent cannot reason about PDA collisions. It remains a learning challenge first.

The complete organizer specification, answer key, build commands, environment contract, deployment architecture, and playtest checklist live in [`../../apps/last-stop/README.md`](../../apps/last-stop/README.md).
