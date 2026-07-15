import { createClient } from "redis";

export async function createStore(env = process.env) {
  if (!env.REDIS_URL) return memoryStore();
  const redis = createClient({ url: env.REDIS_URL });
  redis.on("error", (error) => console.error("redis", error.message));
  await redis.connect();
  return redisStore(redis, env.ST_GENESIS_REDIS_PREFIX || "st-genesis:v1");
}

function memoryStore() {
  const tickets = new Map();
  const sessions = new Map();
  const instances = new Map();
  const powers = new Map();
  const rates = new Map();
  return {
    mode: "memory",
    async consumeTicket(jti, expiresAt) { if (tickets.has(jti)) return false; tickets.set(jti, expiresAt); return true; },
    async putSession(id, value) { sessions.set(id, structuredClone(value)); },
    async getSession(id) { return structuredClone(sessions.get(id) || null); },
    async getInstance(teamId) { return structuredClone(instances.get(teamId) || null); },
    async putInstance(teamId, value) { instances.set(teamId, structuredClone(value)); },
    async registerPow(challenge, value) { powers.set(challenge, structuredClone(value)); },
    async consumePow(challenge) { const value = powers.get(challenge) || null; powers.delete(challenge); return structuredClone(value); },
    async hitRate(key, now, max, windowMs) {
      let value = rates.get(key);
      if (!value || now - value.startedAt >= windowMs) value = { startedAt: now, count: 0 };
      value.count += 1; rates.set(key, value); return value.count <= max;
    },
    async close() {},
  };
}

function redisStore(redis, prefix) {
  const key = (kind, id) => `${prefix}:${kind}:${id}`;
  return {
    mode: "redis",
    async consumeTicket(jti, expiresAt) {
      const ttl = Math.max(1, expiresAt - Math.floor(Date.now() / 1000));
      return (await redis.set(key("ticket", jti), "1", { NX: true, EX: ttl })) === "OK";
    },
    async putSession(id, value) { await redis.set(key("session", id), JSON.stringify(value), { EX: 43_200 }); },
    async getSession(id) { const value = await redis.get(key("session", id)); return value ? JSON.parse(value) : null; },
    async getInstance(teamId) { const value = await redis.get(key("instance", teamId)); return value ? JSON.parse(value) : null; },
    async putInstance(teamId, value) { await redis.set(key("instance", teamId), JSON.stringify(value)); },
    async registerPow(challenge, value) { await redis.set(key("pow", challenge), JSON.stringify(value), { PX: Math.max(1, value.expiresAt - Date.now()) }); },
    async consumePow(challenge) { const value = await redis.getDel(key("pow", challenge)); return value ? JSON.parse(value) : null; },
    async hitRate(id, now, max, windowMs) {
      const bucket = Math.floor(now / windowMs);
      const rateKey = key("rate", `${id}:${bucket}`);
      const count = await redis.incr(rateKey);
      if (count === 1) await redis.pExpire(rateKey, windowMs + 1000);
      return count <= max;
    },
    async close() { await redis.quit(); },
  };
}
