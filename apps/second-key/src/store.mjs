import crypto from "node:crypto";
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
  return redisStore(redis, `${env.SECOND_KEY_REDIS_PREFIX || "second-key:v1"}:${generation}`, generation);
}

function memoryStore(generation = "rehearsal") {
  const tickets = new Map();
  const sessions = new Map();
  const instances = new Map();
  const audits = new Map();
  const rateBuckets = new Map();
  const operations = new Map();
  const slots = new Map();
  const provisionedParticipants = new Set();
  return {
    mode: "memory",
    eventGeneration: generation,
    async consumeTicket(jti, expiresAt) {
      const now = Math.floor(Date.now() / 1000);
      for (const [ticket, expiry] of tickets) if (expiry <= now) tickets.delete(ticket);
      if (tickets.has(jti)) return false;
      tickets.set(jti, expiresAt);
      return true;
    },
    async putSession(id, value) { sessions.set(id, structuredClone(value)); },
    async getSession(id) { return structuredClone(sessions.get(id) || null); },
    async putInstance(participantId, value) {
      instances.set(participantId, structuredClone(value));
      if (isCompletedProvision(value)) provisionedParticipants.add(participantId);
    },
    async getInstance(participantId) { return structuredClone(instances.get(participantId) || null); },
    async provisionedCount() { return provisionedParticipants.size; },
    async audit(participantId, event) {
      const rows = audits.get(participantId) || [];
      rows.push(structuredClone(event));
      audits.set(participantId, rows.slice(-300));
    },
    async rateLimit(scope, identifier, limit, windowMs = 60_000, nowMs = Date.now()) {
      const key = `${scope}:${identifier}`;
      let entry = rateBuckets.get(key);
      if (!entry || entry.expiresAt <= nowMs) entry = { count: 0, expiresAt: nowMs + windowMs };
      entry.count += 1;
      rateBuckets.set(key, entry);
      if (rateBuckets.size > 4_096) {
        for (const [candidate, value] of rateBuckets) {
          if (value.expiresAt <= nowMs) rateBuckets.delete(candidate);
        }
      }
      return {
        allowed: entry.count <= limit,
        remaining: Math.max(0, limit - entry.count),
        retryAfter: Math.max(1, Math.ceil((entry.expiresAt - nowMs) / 1_000)),
      };
    },
    async acquireOperation(participantId, { ttlMs, maxConcurrency, pool = "write", nowMs = Date.now() }) {
      const operationPool = normalizePool(pool);
      for (const [id, lease] of operations) if (lease.expiresAt <= nowMs) operations.delete(id);
      for (const [slot, lease] of slots) if (lease.expiresAt <= nowMs) slots.delete(slot);
      if (operations.has(participantId)) return null;
      const slot = Array.from({ length: maxConcurrency }, (_, index) => `${operationPool}:${index}`).find((candidate) => !slots.has(candidate));
      if (slot === undefined) return null;
      const lease = Object.freeze({ participantId, slot, pool: operationPool, token: crypto.randomUUID(), expiresAt: nowMs + ttlMs, local: true });
      operations.set(participantId, lease);
      slots.set(slot, lease);
      return lease;
    },
    async releaseOperation(lease) {
      if (!lease) return;
      if (operations.get(lease.participantId)?.token === lease.token) operations.delete(lease.participantId);
      if (slots.get(lease.slot)?.token === lease.token) slots.delete(lease.slot);
    },
    async health() { return true; },
    async close() {},
  };
}

function redisStore(redis, prefix, generation) {
  const key = (kind, id = "") => `${prefix}:${kind}${id ? `:${id}` : ""}`;
  let provisionIndexHydration = null;

  async function hydrateProvisionIndex() {
    if (!provisionIndexHydration) {
      provisionIndexHydration = (async () => {
        const provisionedKey = key("provisioned");
        for await (const instanceKeys of redis.scanIterator({ MATCH: `${key("instance")}:*`, COUNT: 100 })) {
          if (!instanceKeys.length) continue;
          const rows = await redis.mGet(instanceKeys);
          for (const encoded of rows) {
            if (!encoded) continue;
            try {
              const instance = JSON.parse(encoded);
              if (isCompletedProvision(instance) && instance.participantId) await redis.sAdd(provisionedKey, instance.participantId);
            } catch {
              // Invalid instance state should surface through the participant path,
              // but must not make the entire readiness endpoint unavailable.
            }
          }
        }
      })().catch((error) => {
        provisionIndexHydration = null;
        throw error;
      });
    }
    return provisionIndexHydration;
  }

  return {
    mode: "redis",
    eventGeneration: generation,
    async consumeTicket(jti, expiresAt) {
      const ttl = Math.max(1, expiresAt - Math.floor(Date.now() / 1000));
      return (await redis.set(key("ticket", jti), "1", { NX: true, EX: ttl })) === "OK";
    },
    async putSession(id, value) { await redis.set(key("session", id), JSON.stringify(value), { EX: 43_200 }); },
    async getSession(id) { const value = await redis.get(key("session", id)); return value ? JSON.parse(value) : null; },
    async putInstance(participantId, value) {
      const transaction = redis.multi().set(key("instance", participantId), JSON.stringify(value));
      if (isCompletedProvision(value)) transaction.sAdd(key("provisioned"), participantId);
      await transaction.exec();
    },
    async getInstance(participantId) { const value = await redis.get(key("instance", participantId)); return value ? JSON.parse(value) : null; },
    async provisionedCount() {
      await hydrateProvisionIndex();
      return Number(await redis.sCard(key("provisioned")));
    },
    async audit(participantId, event) {
      await redis.rPush(key("audit", participantId), JSON.stringify(event));
      await redis.lTrim(key("audit", participantId), -300, -1);
    },
    async rateLimit(scope, identifier, limit, windowMs = 60_000, nowMs = Date.now()) {
      const bucketKey = key("rate", `${scope}:${identifier}`);
      const [countValue, ttlValue] = await redis.eval(
        "local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('PEXPIRE',KEYS[1],ARGV[1]); end; return {n,redis.call('PTTL',KEYS[1])}",
        { keys: [bucketKey], arguments: [String(windowMs)] },
      );
      const count = Number(countValue);
      const ttl = Math.max(1, Number(ttlValue));
      return { allowed: count <= limit, remaining: Math.max(0, limit - count), retryAfter: Math.max(1, Math.ceil(ttl / 1_000)) };
    },
    async acquireOperation(participantId, { ttlMs, maxConcurrency, pool = "write" }) {
      const operationPool = normalizePool(pool);
      const token = crypto.randomUUID();
      const participantKey = key("active", participantId);
      if (await redis.set(participantKey, token, { NX: true, PX: ttlMs }) !== "OK") return null;
      for (let slot = 0; slot < maxConcurrency; slot += 1) {
        const slotKey = key("active-slot", `${operationPool}:${slot}`);
        if (await redis.set(slotKey, token, { NX: true, PX: ttlMs }) === "OK") {
          return Object.freeze({ participantKey, slotKey, pool: operationPool, token, local: false });
        }
      }
      await deleteOwned(redis, participantKey, token);
      return null;
    },
    async releaseOperation(lease) {
      if (!lease) return;
      await Promise.all([deleteOwned(redis, lease.participantKey, lease.token), deleteOwned(redis, lease.slotKey, lease.token)]);
    },
    async health() { return String(await redis.ping()).toUpperCase() === "PONG"; },
    async close() { await redis.quit(); },
  };
}

function isCompletedProvision(value) {
  return Boolean(value && value.allocationStatus !== "allocating" && value.participantId && value.wallet && value.mint && value.loan);
}

async function deleteOwned(redis, key, token) {
  if (!key) return;
  await redis.eval(
    "if redis.call('GET',KEYS[1])==ARGV[1] then return redis.call('DEL',KEYS[1]) else return 0 end",
    { keys: [key], arguments: [token] },
  );
}

function normalizePool(value) {
  const pool = String(value || "write");
  if (!/^[a-z][a-z0-9-]{0,31}$/.test(pool)) throw new Error("operation pool is invalid");
  return pool;
}
