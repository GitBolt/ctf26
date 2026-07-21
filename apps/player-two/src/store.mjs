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
  return redisStore(redis, `${env.PLAYER_TWO_REDIS_PREFIX || "player-two:v1"}:${generation}`, generation);
}

function memoryStore(generation = "rehearsal") {
  const tickets = new Map();
  const sessions = new Map();
  const instances = new Map();
  const provisionedParticipants = new Set();
  const audits = new Map();
  const rates = new Map();
  const slots = new Map();
  return {
    mode: "memory",
    eventGeneration: generation,
    async consumeTicket(jti, expiresAt) { if (tickets.has(jti)) return false; tickets.set(jti, expiresAt); return true; },
    async putSession(id, value) { sessions.set(id, structuredClone(value)); },
    async getSession(id) { return structuredClone(sessions.get(id) || null); },
    async getInstance(participantId) { return structuredClone(instances.get(participantId) || null); },
    async putInstance(participantId, value) {
      instances.set(participantId, structuredClone(value));
      if (isFullyProvisioned(value)) provisionedParticipants.add(participantId);
    },
    async provisionedInstanceCount() { return provisionedParticipants.size; },
    async audit(participantId, event) { const list = audits.get(participantId) || []; list.push(structuredClone(event)); audits.set(participantId, list.slice(-300)); },
    async hitRate(id, now, max, windowMs) {
      let value = rates.get(id);
      if (!value || now - value.startedAt >= windowMs) value = { startedAt: now, count: 0 };
      value.count += 1; rates.set(id, value); return value.count <= max;
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
  let provisionedIndexReady = null;
  const ensureProvisionedIndex = async () => {
    if (provisionedIndexReady) return provisionedIndexReady;
    provisionedIndexReady = (async () => {
      const marker = key("provisioned-participants", "backfilled");
      if (await redis.exists(marker)) return;
      for await (const instanceKeys of redis.scanIterator({ MATCH: `${prefix}:instance:*`, COUNT: 100 })) {
        if (!instanceKeys.length) continue;
        const rows = await redis.mGet(instanceKeys);
        for (const raw of rows) {
          if (!raw) continue;
          const instance = JSON.parse(raw);
          if (isFullyProvisioned(instance)) {
            await redis.sAdd(key("provisioned-participants", "all"), instance.participantId);
          }
        }
      }
      await redis.set(marker, "1");
    })().catch((error) => { provisionedIndexReady = null; throw error; });
    return provisionedIndexReady;
  };
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
    async putInstance(participantId, value) {
      const script = `
        redis.call('SET', KEYS[1], ARGV[1])
        if ARGV[2] == '1' then redis.call('SADD', KEYS[2], ARGV[3]) end
        return 1
      `;
      await redis.eval(script, {
        keys: [key("instance", participantId), key("provisioned-participants", "all")],
        arguments: [JSON.stringify(value), isFullyProvisioned(value) ? "1" : "0", participantId],
      });
    },
    async provisionedInstanceCount() { await ensureProvisionedIndex(); return redis.sCard(key("provisioned-participants", "all")); },
    async audit(participantId, event) { await redis.rPush(key("audit", participantId), JSON.stringify(event)); await redis.lTrim(key("audit", participantId), -300, -1); },
    async hitRate(id, now, max, windowMs) {
      const rateKey = key("rate", `${id}:${Math.floor(now / windowMs)}`);
      const count = await redis.incr(rateKey);
      if (count === 1) await redis.pExpire(rateKey, windowMs + 1_000);
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

function isFullyProvisioned(value) {
  return Boolean(
    value
    && value.allocationStatus !== "allocating"
    && value.participantId
    && value.jackpot
    && value.receiptSignature,
  );
}
