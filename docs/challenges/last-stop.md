# LAST STOP — Hosted Solana PDA Journey

LAST STOP is the fifth CTF26 challenge: a short, beginner-friendly SSH text adventure built around a real Solana PDA seed-boundary collision.

## Player view

The portal gives the participant a one-use SSH passage. They enter Grand Central, navigate between a Fare Kiosk, Lost & Found, Signal Room, and the closed Red Line, then use terminal commands to inspect evidence and operate the deployed program. The kiosk names one inspectable printer and the Signal Room names one inspectable reader; bare `inspect` selects the nearby machine. Object-name guessing is not part of the challenge.

The challenge is deliberately small. It has no large frontend, fake block explorer, downloadable repository, or decorative decoy endpoints. Movement is ordinary terminal state. Buying a card, tapping the Red Line gate, and arriving are authoritative transactions replayed against the exact native SBF artifact in LiteSVM.

## Security core

The kiosk and gate derive the same logical card with incompatible variable-length seed schemas:

```text
kiosk: ["card", team_seed, route]
gate:  ["card", team_seed, line, station]
```

Solana does not encode the boundary between adjacent PDA seed byte strings. The route `redterminus` therefore collides with line `red` plus station `terminus`. Inspection does not print a seed schema, seed count, or target PDA. The kiosk shows one physical card progressing through a clear intake and rollers, leaving through the lower output, and landing on a widening two-row tray that establishes foreground depth. The Signal Room instead shows two internal configuration bands pulsing one after another, one physical card touching an edge-mounted target, and two center flaps retracting symmetrically into fixed subway-gate pedestals. The replay never misrepresents those fields as separate cards, joins labels, or spells an answer-shaped route. Printed and listed cards display the PDA that each kiosk route derived as normal transaction evidence, but no comparison oracle is exposed. Each replay uses a clean alternate terminal screen that is fully repainted per frame, then restores the player’s normal terminal without leaving a combined state behind. The winning card is an ordinary kiosk product whose address is accepted as the restricted gate card.

## Delivery and integrity

- Portal ticket bound to participant, email, event, and challenge audience.
- One-use SSH password with ten-minute expiry; every password starts one fresh ephemeral journey on one SSH session channel. The terminal also has a visible five-minute maximum.
- Redis-backed completion evidence and recent command history; room, card, hint, and gate state disappear when SSH disconnects.
- An authoritative stop-only autonomous-agent policy appears in the SSH banner and again before gameplay, with no participant-visible reporting mechanism.
- `robots.txt`, `agents.txt`, `llms.txt`, and `/.well-known/agents.txt` policy discovery.
- Server-side HMAC completion receipt produced only after native replay reaches the arrival state.
- Automatic portal completion status backed by the challenge's Redis record; the receipt remains organizer evidence and is never a player-submitted flag.

This puts a clear refusal boundary in front of compliant agents without exposing organizer-side integrity operations or pretending that a policy-ignoring agent cannot reason about PDA collisions. It remains a learning challenge first.

The complete organizer specification, answer key, build commands, environment contract, deployment architecture, and playtest checklist live in [`../../apps/last-stop/README.md`](../../apps/last-stop/README.md).
