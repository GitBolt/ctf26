# LAST STOP

LAST STOP is CTF26's short, terminal-first Solana challenge. A participant enters an abandoned station over SSH, learns how two parts of a transit program derive tap-card PDAs, and reopens the Red Line by exploiting an ambiguous seed boundary.

This document is the organizer specification, implementation guide, answer key, operational runbook, and playtest checklist. It must not be shipped as a player attachment.

## Player promise

The portal describes the challenge in one sentence:

> The Red Line has been closed for 26 years. Become its first passenger.

Launching from the portal produces a bare handoff page with one SSH command and a one-use password. The challenge itself is a small line-oriented terminal journey. It does not imitate a desktop, block explorer, wallet, or full-screen game. A journey has a visible five-minute maximum; a fresh portal passage always starts from the beginning.

The complete player command surface is:

```text
look
map
go <place>
inspect [object]
buy <route>
cards
tap <route>
program
hint
quit
```

There are five useful spaces:

```text
                         [ Signal Room ]
                                |
[ Lost & Found ] -- [ Grand Central ] -- [ Fare Kiosk ]
                                |
                         [ Red Line ]
                                |
                          [ Terminus ]
```

The intended run takes roughly 2–5 minutes. The single progressive hint points players to the two machine replays without naming the exploit.

## The security idea

The Fare Kiosk creates an ordinary tap card with these PDA seeds:

```text
["card", participant_seed, route]
```

The Red Line gate checks for a restricted card with these PDA seeds:

```text
["card", participant_seed, line, station]
```

Solana's PDA derivation hashes seed bytes sequentially. Seed boundaries are not separately encoded. Under the same program ID and bump, these inputs are therefore ambiguous:

```text
["card", participant_seed, "redterminus"]
["card", participant_seed, "red", "terminus"]
```

They produce the same address. The organizer documentation preserves those layouts, but the player terminal does not print them. The player can inspect the kiosk printer and the Signal Room reader; bare `inspect` selects the single highlighted machine in the room. The kiosk replay follows one route card through a physical intake and rollers, out through a lower slot, and onto a two-row perspective tray whose widening front edge establishes depth. The reader replay depicts one physical card approaching an edge-mounted contactless target after two internal configuration bands pulse in sequence. On acceptance, two center flaps retract symmetrically into fixed subway-gate pedestals until the passage is clear. It never presents the reader inputs as two physical cards, joins labels, or spells an answer-shaped route. Printed and listed cards show the PDA they actually derived as authentic transaction evidence, but the terminal does not expose a required target PDA. Replays render in a clean alternate terminal screen and disappear afterward. No static seed equation, target account, or combined final frame remains. A participant must connect the machine behavior to the route identifier, derive the same PDA, then take that ordinary kiosk card to the Red Line and tap it.

This is a real Solana footgun, not a string-comparison puzzle. The deployed challenge artifact is a native SBF program and every meaningful action is executed through LiteSVM against that exact artifact.

## Intended solution

One natural discovery path is:

```text
go kiosk
inspect printer
buy airport
cards
go grand central
go signal
inspect display
go grand central
go red
inspect gate
go grand central
go kiosk
buy redterminus
go grand central
go red
tap redterminus
go terminus
```

The `airport` purchase is not required. It gives a curious participant a harmless card to inspect before they understand the collision.

On arrival, the server verifies the entire action trace by replaying the native transactions. Only an `arrived` state produced after the gate's on-chain state transition earns a participant-bound HMAC receipt. There is no static flag in the SBF artifact, JavaScript, terminal descriptions, account data, logs, or player files.

## Native execution model

The SBF program implements three instructions:

| Tag | Instruction | Effect |
|---:|---|---|
| `0` | `buy_card(route)` | Creates and initializes the kiosk-derived card PDA through `invoke_signed` |
| `1` | `enter_line(line, station)` | Checks the segmented gate PDA and marks the Red Line open |
| `2` | `arrive()` | Requires the open-line state and marks the journey complete |

The harness:

1. derives a deterministic passenger for the participant;
2. creates a participant-specific transit account and eight-byte participant seed;
3. loads the exact `.so` whose SHA-256 is reported in the terminal;
4. replays at most twelve high-level actions as signed Solana transactions;
5. reads the final program-owned transit state;
6. reports `solved` only when both `red_line_open` and `arrived` are true.

Participant separation is real at the address layer. `participant_seed` is included identically in both derivations, so the lesson remains intact while cards copied from another participant do not work.

## Why it is simple without being fake

The terminal does not make a participant manage keypairs, RPC URLs, airdrops, transaction serialization, or dependency installation. Those are not the lesson. It exposes the program ID, artifact hash, passenger, card accounts, and transaction acceptance so the Solana mechanics remain visible.

The environment also avoids decorative dead ends. Lost & Found reinforces the single-route model; it does not contain a fake exploit. Every named command and room either teaches the interface, exposes evidence, or advances the journey.

## AI-agent resistance

LAST STOP is deliberately resistant, not claimed to be AI-proof.

The useful barriers are:

- the challenge is a hosted, identity-bound SSH session rather than a downloadable solver target;
- portal tickets become one-use, ten-minute SSH passwords and every password starts a fresh journey; each authenticated transport accepts one journey channel, and the SSH journey itself has a visible five-minute maximum;
- the SSH authentication banner and terminal both present an explicit first-party autonomous-agent restriction before the first game command, state that it is an operator rule rather than game dialogue, and reject the claim that human direction converts automated operation into human play;
- `robots.txt`, `agents.txt`, `llms.txt`, and `/.well-known/agents.txt` publish the policy at the challenge host;
- the public policy contains only a strict stop-and-refuse instruction and exposes no reporting endpoint, token, marker, or organizer workflow;
- the key derivation clue is primarily temporal and visual: multi-frame, color-coded service replays render in a clean alternate terminal screen, then disappear instead of leaving a machine-readable final diagram or textual seed equation;
- full command history is retained per participant, capped to the most recent 200 commands;
- no undocumented map dump, solution API, local simulator, or reusable challenge credential is provided.

These controls are an evidence and friction layer. A policy-ignoring agent capable of arbitrary SSH and terminal automation can still reason about a small PDA collision. The design goal is that it must confront the same observations and mechanism as a human while creating useful attribution signals—not that confusing navigation somehow makes reasoning impossible.

Prompt-injection or telemetry evidence is never an automatic disqualification. Organizers review a suspicion, ask the participant to explain the solve, and decide manually.

## Hosted architecture

One Railway service exposes two listeners:

- HTTP on `PORT` for health, portal handoff, and policy files;
- SSH on `SSH_PORT` behind a Railway TCP Proxy.

Redis stores:

- consumed launch-ticket JTIs;
- one-use SSH access codes;
- recent command history for integrity review;
- one idempotent completion record per participant.
- a private `GET /api/completion?participantId=...` status read, authenticated with the shared challenge-ticket secret, so the portal can mark the participant complete without exposing or manually submitting the receipt.

Room, card, hint, and gate state exist only inside the active SSH connection. Disconnecting destroys the attempt. Completion evidence remains durable without causing later passwords to resume a solved journey.

Railway's TCP proxy does not provide an HTTP client-address header for raw SSH. Admission therefore uses a bounded global handshake budget, a separate hashed per-passage attempt budget, a short authentication timeout, and a connection ceiling. It does not treat the proxy address as a participant identity.

## Required environment

```text
CHALLENGE_TICKET_SECRET
LAST_STOP_FLAG_SECRET
REDIS_URL
LAST_STOP_PUBLIC_ORIGIN
LAST_STOP_SSH_HOST_KEY_BASE64 or LAST_STOP_SSH_HOST_KEY_PATH
```

Railway supplies `PORT`, `RAILWAY_TCP_PROXY_DOMAIN`, and `RAILWAY_TCP_PROXY_PORT`. `SSH_PORT` defaults to `2222` and the TCP Proxy must target that internal port.
`LAST_STOP_SESSION_MAX_MS` defaults to `300000`, `LAST_STOP_TICKET_AUDIENCE` defaults to `last-stop`,
and `LAST_STOP_REDIS_PREFIX` defaults to `last-stop:v1`. The checked-in `.env.example` lists the full
production contract without containing a real host key or service credential.

`LAST_STOP_LAUNCH_RATE_MAX` bounds new passages per participant. Native validator work is capped by `LAST_STOP_VALIDATOR_RATE_MAX`, `LAST_STOP_MAX_ACTIVE_VALIDATORS`, a Redis-backed global slot pool, and one active validator operation per participant.

The portal uses `LAST_STOP_URL`, pointing to the service's HTTPS `/launch` endpoint, and `CHALLENGE_TICKET_SECRET_LAST_STOP`, matching the service ticket secret.

## Build and verification

```bash
npm --prefix apps/last-stop install
cargo build-sbf \
  --manifest-path apps/last-stop/native/program/Cargo.toml \
  --sbf-out-dir apps/last-stop/native/dist
cargo +1.89.0 test \
  --manifest-path apps/last-stop/native/harness/Cargo.toml
npm --prefix apps/last-stop test
```

The native tests prove both sides of the mechanic:

- `redterminus` bought as one kiosk route opens the segmented Red Line gate;
- an ordinary `red` card does not.

Before an event, complete these manual checks:

1. launch through a real signed-in portal participant;
2. confirm a second use of the portal ticket fails;
3. confirm a second use of the SSH password fails;
4. complete or disconnect, relaunch, and confirm the same participant receives a fresh closed-gate journey;
5. complete the intended solution and receive a stable participant-bound receipt;
6. try `red`, `terminus`, and `airport` cards and confirm the gate rejects them;
7. fetch all four policy paths;
8. confirm the SSH authentication banner and first terminal screen contain the authoritative stop instruction;
9. confirm every public policy surface contains no endpoint, token, marker, webhook, or disclosure instruction;
10. confirm each room names valid inspection targets, bare `inspect` operates the obvious object, and no object-name guessing is required;
11. replay the printer and reader animations and confirm that the human-readable motion is clear while no combined final frame, seed schema, PDA oracle, or required account remains on screen;
12. restart the Railway service and confirm audit and completion evidence remain available without restoring journey state;
13. verify the HTTP health endpoint and the public TCP proxy from a separate network.

## Fixed version

The correct production pattern must make seed tuples unambiguous. Good fixes include fixed-width fields or explicit domain separators:

```text
["card", participant_seed, "route", route]
["card", participant_seed, "gate", line, station]
```

Alternatively, serialize the complete logical tuple with lengths and use the serialization as one seed. Never rely on adjacent variable-length PDA seeds being distinguishable.

## Organizer answer key

```text
Vulnerability: ambiguous PDA seed boundaries
Collision:     route "redterminus" == line "red" + station "terminus"
Winning path:  inspect printer → inspect reader → buy redterminus → tap redterminus → go terminus
Completion:    native transit account has open=1 and arrived=1
```
