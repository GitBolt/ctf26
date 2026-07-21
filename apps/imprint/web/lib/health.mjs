import { parseCredentialRoster } from "./credential-roster.mjs";
import { validateTargetConfiguration } from "./target-config.mjs";
import { ticketReplayConfiguration } from "./ticket-replay.mjs";

export function imprintHealth(
  env = process.env,
  { parseRoster = parseCredentialRoster } = {}
) {
  const roster = parseRoster(env.IMPRINT_CREDENTIAL_ROSTER_JSON);
  const targets = validateTargetConfiguration(
    env,
    roster.map((credential) => credential.participantId)
  );
  const replay = ticketReplayConfiguration(env);
  return Object.freeze({
    ok: true,
    eventReady: targets.mode === "per-participant",
    targetMode: targets.mode,
    participantCount: targets.participantCount,
    eventGeneration: replay.generation,
    ticketReplay: replay.redisUrl ? "redis" : "memory",
  });
}
