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
  const prefix = `${env.LAST_STOP_REDIS_PREFIX || "last-stop:v1"}:${generation}`;
  return {
    mode: "redis",
    eventGeneration: generation,
    async consumeTicket(jti, expiresAt) {
      const ttl = Math.max(1, expiresAt - Math.floor(Date.now() / 1000));
      return (await redis.set(`${prefix}:ticket:${jti}`, "1", { NX: true, EX: ttl })) === "OK";
    },
    async issueCode(identity) {
      const code = crypto.randomBytes(9).toString("base64url");
      await redis.set(`${prefix}:code:${code}`, JSON.stringify(identity), { EX: 600 });
      return code;
    },
    async consumeCode(code) {
      const raw = await redis.getDel(`${prefix}:code:${code}`);
      return raw ? JSON.parse(raw) : null;
    },
    async readCode(code) {
      const raw = await redis.get(`${prefix}:code:${code}`);
      return raw ? JSON.parse(raw) : null;
    },
    async appendCommand(participantId, command) {
      const key = `${prefix}:commands:${participantId}`;
      await redis.multi()
        .rPush(key, JSON.stringify(command))
        .lTrim(key, -200, -1)
        .exec();
    },
    async getRecentCommands(participantId, limit = 40) {
      const values = await redis.lRange(`${prefix}:commands:${participantId}`, -limit, -1);
      return values.flatMap((value) => {
        try { return [JSON.parse(value)]; } catch { return []; }
      });
    },
    async recordCompletion(participantId, completion) {
      const key = `${prefix}:completion:${participantId}`;
      const encoded = JSON.stringify(completion);
      const inserted = await redis.set(key, encoded, { NX: true });
      if (inserted === "OK") return completion;
      const existing = await redis.get(key);
      return existing ? JSON.parse(existing) : completion;
    },
    async getCompletion(participantId) {
      const existing = await redis.get(`${prefix}:completion:${participantId}`);
      return existing ? JSON.parse(existing) : null;
    },
    async hitRate(id, now, max, windowMs) {
      const rateKey = `${prefix}:rate:${id}:${Math.floor(now / windowMs)}`;
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
      return Number(await redis.eval(script, { keys: [`${prefix}:slots:${scope}`], arguments: [String(now), holder, String(ttlMs), String(max)] })) === 1;
    },
    async releaseSlot(scope, holder) { await redis.zRem(`${prefix}:slots:${scope}`, holder); },
    async health() { return String(await redis.ping()).toUpperCase() === "PONG"; },
    async close() { await redis.quit(); },
  };
}

function memoryStore(generation = "rehearsal") {
  const tickets = new Set();
  const codes = new Map();
  const commandLogs = new Map();
  const completions = new Map();
  const rates = new Map();
  const slots = new Map();
  return {
    mode: "memory",
    eventGeneration: generation,
    async consumeTicket(jti) {
      if (tickets.has(jti)) return false;
      tickets.add(jti);
      return true;
    },
    async issueCode(identity) {
      const code = crypto.randomBytes(9).toString("base64url");
      codes.set(code, identity);
      return code;
    },
    async consumeCode(code) {
      const identity = codes.get(code) || null;
      codes.delete(code);
      return identity;
    },
    async readCode(code) {
      const identity = codes.get(code);
      return identity ? structuredClone(identity) : null;
    },
    async appendCommand(participantId, command) {
      const commands = [...(commandLogs.get(participantId) || []), structuredClone(command)].slice(-200);
      commandLogs.set(participantId, commands);
    },
    async getRecentCommands(participantId, limit = 40) {
      return structuredClone((commandLogs.get(participantId) || []).slice(-limit));
    },
    async recordCompletion(participantId, completion) {
      if (!completions.has(participantId)) completions.set(participantId, structuredClone(completion));
      return structuredClone(completions.get(participantId));
    },
    async getCompletion(participantId) {
      const completion = completions.get(participantId);
      return completion ? structuredClone(completion) : null;
    },
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
