# Participant launch tickets

This package defines the server-to-server identity handoff from the CTF portal to a challenge.
Tickets use the strict format `v1.<base64url-json>.<base64url-hmac-sha256>` and contain only opaque
participant/team IDs. Every ticket is bound to one event and one challenge audience, expires after
five minutes by default, and carries a unique `jti`.

A challenge must call `consumeParticipantTicket`, not just decode or verify a ticket. Its
`consumeJti` callback must atomically insert a previously unseen `(event, audience, jti)` into a
shared replay store with expiry at `expiresAt`. Returning `false` rejects a replay. After successful
consumption, the challenge should establish a first-party, HTTP-only challenge session and redirect
to the same page without the `ticket` query parameter.

Each challenge has a distinct HMAC key. The portal stores it as
`CHALLENGE_TICKET_SECRET_<CHALLENGE_NAME>`; the challenge service should receive only its own value,
typically under the local name `CHALLENGE_TICKET_SECRET`. Keys must contain at least 32 random bytes,
must not be reused as the portal session or participant-ID secret, and must never be shipped in a
player bundle or browser environment.
