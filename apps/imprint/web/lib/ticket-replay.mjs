import { createClient } from "redis";

import { eventGeneration } from "@ctf26/leaderboard";
import { createRedisTicketJtiConsumer } from "@ctf26/participant-ticket";

const DEFAULT_PREFIX = "ctf26:imprint:ticket:v1";
let sharedStorePromise;

export function ticketReplayConfiguration(env = process.env) {
  const generation = eventGeneration(env);
  const redisUrl = String(env.REDIS_URL || "").trim();
  if (env.NODE_ENV === "production" && !redisUrl) {
    throw new Error(
      "REDIS_URL is required for production ticket replay protection"
    );
  }
  const prefix = String(env.IMPRINT_REDIS_PREFIX || DEFAULT_PREFIX).trim();
  if (!/^[A-Za-z0-9:_-]{1,128}$/.test(prefix)) {
    throw new Error("IMPRINT_REDIS_PREFIX is invalid");
  }
  return Object.freeze({ generation, prefix, redisUrl });
}

export async function createImprintTicketReplayStore(
  env = process.env,
  options = {}
) {
  const config = ticketReplayConfiguration(env);
  if (!config.redisUrl && !options.redis)
    return createMemoryStore(config.generation);

  const redis = options.redis || createClient({ url: config.redisUrl });
  if (!options.redis) {
    redis.on("error", (error) => console.error("IMPRINT Redis", error.message));
    await redis.connect();
  }
  const consume = createRedisTicketJtiConsumer(redis, {
    eventId: config.generation,
    prefix: config.prefix,
  });
  return Object.freeze({
    mode: "redis",
    eventGeneration: config.generation,
    consume,
    async health() {
      return String(await redis.ping()).toUpperCase() === "PONG";
    },
    async close() {
      if (!options.redis && redis.isOpen) await redis.quit();
    },
  });
}

export function imprintTicketReplayStore(env = process.env) {
  if (env !== process.env) return createImprintTicketReplayStore(env);
  sharedStorePromise ||= createImprintTicketReplayStore(env);
  return sharedStorePromise;
}

function createMemoryStore(generation) {
  const seen = new Set();
  return Object.freeze({
    mode: "memory",
    eventGeneration: generation,
    async consume({ jti }) {
      if (seen.has(jti)) return false;
      seen.add(jti);
      return true;
    },
    async health() {
      return true;
    },
    async close() {},
  });
}
