import { createClient } from "redis";
import { eventGeneration } from "@ctf26/leaderboard";

export async function createStore(env = process.env) {
  const generation = eventGeneration(env);
  if (!env.REDIS_URL) {
    if (env.NODE_ENV === "production") throw new Error("REDIS_URL is required in production");
    return memoryStore(generation);
  }
  const redis = createClient({ url: env.REDIS_URL });
  redis.on("error", (error) => console.error("redis", error.message));
  await redis.connect();
  return redisStore(redis, `${env.BROADCAST_REDIS_PREFIX || "the-broadcast:v1"}:${generation}`, generation);
}

function memoryStore(generation = "rehearsal") {
  const tickets = new Map();
  const sessions = new Map();
  const instances = new Map();
  const powers = new Map();
  const rates = new Map();
  const slots = new Map();
  return {
    mode: "memory",
    eventGeneration: generation,
    async consumeTicket(jti, expiresAt) { if (tickets.has(jti)) return false; tickets.set(jti, expiresAt); return true; },
    async putSession(id, value) { sessions.set(id, structuredClone(value)); },
    async getSession(id) { return structuredClone(sessions.get(id) || null); },
    async getInstance(participantId) { return structuredClone(instances.get(participantId) || null); },
    async putInstance(participantId, value) { instances.set(participantId, structuredClone(value)); },
    async registerPow(challenge, value) { powers.set(challenge, structuredClone(value)); },
    async consumePow(challenge) { const value = powers.get(challenge) || null; powers.delete(challenge); return structuredClone(value); },
    async hitRate(key, now, max, windowMs) {
      let value = rates.get(key);
      if (!value || now - value.startedAt >= windowMs) value = { startedAt: now, count: 0 };
      value.count += 1; rates.set(key, value); return value.count <= max;
    },
    async acquireSlot(scope, holder, now, ttlMs, max) {
      const active = slots.get(scope) || new Map();
      for (const [id, expiresAt] of active) if (expiresAt <= now) active.delete(id);
      if (active.has(holder) || active.size >= max) return false;
      active.set(holder, now + ttlMs); slots.set(scope, active); return true;
    },
    async releaseSlot(scope, holder) { slots.get(scope)?.delete(holder); },
    async health() { return true; },
    async close() {},
  };
}

function redisStore(redis, prefix, generation) {
  const key = (kind, id) => `${prefix}:${kind}:${id}`;
  return {
    mode: "redis",
    eventGeneration: generation,
    async consumeTicket(jti, expiresAt) {
      const ttl = Math.max(1, expiresAt - Math.floor(Date.now() / 1000));
      return (await redis.set(key("ticket", jti), "1", { NX: true, EX: ttl })) === "OK";
    },
    async putSession(id, value) { await redis.set(key("session", id), JSON.stringify(value), { EX: 43_200 }); },
    async getSession(id) { const value = await redis.get(key("session", id)); return value ? JSON.parse(value) : null; },
    async getInstance(participantId) { const value = await redis.get(key("instance", participantId)); return value ? JSON.parse(value) : null; },
    async putInstance(participantId, value) { await redis.set(key("instance", participantId), JSON.stringify(value)); },
    async registerPow(challenge, value) { await redis.set(key("pow", challenge), JSON.stringify(value), { PX: Math.max(1, value.expiresAt - Date.now()) }); },
    async consumePow(challenge) { const value = await redis.getDel(key("pow", challenge)); return value ? JSON.parse(value) : null; },
    async hitRate(id, now, max, windowMs) {
      const bucket = Math.floor(now / windowMs);
      const rateKey = key("rate", `${id}:${bucket}`);
      const count = await redis.incr(rateKey);
      if (count === 1) await redis.pExpire(rateKey, windowMs + 1000);
      return count <= max;
    },
    async acquireSlot(scope, holder, now, ttlMs, max) {
      const script = `
        redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', ARGV[1])
        if redis.call('ZSCORE', KEYS[1], ARGV[2]) then return 0 end
        if redis.call('ZCARD', KEYS[1]) >= tonumber(ARGV[4]) then return 0 end
        redis.call('ZADD', KEYS[1], tonumber(ARGV[1]) + tonumber(ARGV[3]), ARGV[2])
        local latest = redis.call('ZREVRANGE', KEYS[1], 0, 0, 'WITHSCORES')
        if latest[2] then redis.call('PEXPIRE', KEYS[1], math.max(1000, tonumber(latest[2]) - tonumber(ARGV[1]) + 1000)) end
        return 1
      `;
      return Number(await redis.eval(script, { keys: [key("slots", scope)], arguments: [String(now), holder, String(ttlMs), String(max)] })) === 1;
    },
    async releaseSlot(scope, holder) { await redis.zRem(key("slots", scope), holder); },
    async health() { return String(await redis.ping()).toUpperCase() === "PONG"; },
    async close() { await redis.quit(); },
  };
}
