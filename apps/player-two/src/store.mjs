import { createClient } from "redis";

export async function createStore(env = process.env) {
  if (!env.REDIS_URL) return memoryStore();
  const redis = createClient({ url: env.REDIS_URL });
  redis.on("error", (error) => console.error("redis", error.message));
  await redis.connect();
  return redisStore(redis, env.PLAYER_TWO_REDIS_PREFIX || "player-two:v1");
}

function memoryStore() {
  const tickets = new Map();
  const sessions = new Map();
  const instances = new Map();
  const audits = new Map();
  return {
    mode: "memory",
    async consumeTicket(jti, expiresAt) { if (tickets.has(jti)) return false; tickets.set(jti, expiresAt); return true; },
    async putSession(id, value) { sessions.set(id, structuredClone(value)); },
    async getSession(id) { return structuredClone(sessions.get(id) || null); },
    async getInstance(teamId) { return structuredClone(instances.get(teamId) || null); },
    async putInstance(teamId, value) { instances.set(teamId, structuredClone(value)); },
    async audit(teamId, event) { const list = audits.get(teamId) || []; list.push(structuredClone(event)); audits.set(teamId, list.slice(-300)); },
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
    async audit(teamId, event) { await redis.rPush(key("audit", teamId), JSON.stringify(event)); await redis.lTrim(key("audit", teamId), -300, -1); },
    async close() { await redis.quit(); },
  };
}
