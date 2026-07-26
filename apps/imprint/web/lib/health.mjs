import { participantTarget } from "./auto-provision.mjs";
import { ticketReplayConfiguration } from "./ticket-replay.mjs";

export function imprintHealth(env = process.env) {
  participantTarget("health-check", env);
  const replay = ticketReplayConfiguration(env);
  return Object.freeze({
    ok: true,
    eventReady: true,
    targetMode: "on-demand",
    dynamicProvisioning: true,
    eventGeneration: replay.generation,
    ticketReplay: replay.redisUrl ? "redis" : "memory",
  });
}
