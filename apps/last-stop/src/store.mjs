import crypto from "node:crypto";
import { createClient } from "redis";

export async function createStore(env = process.env) {
  if (!env.REDIS_URL) return memoryStore();
  const redis = createClient({ url: env.REDIS_URL });
  redis.on("error", (error) => console.error("redis", error.message));
  await redis.connect();
  const prefix = env.LAST_STOP_REDIS_PREFIX || "last-stop:v1";
  return {
    mode: "redis",
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
    async appendCommand(teamId, command) {
      const key = `${prefix}:commands:${teamId}`;
      await redis.multi()
        .rPush(key, JSON.stringify(command))
        .lTrim(key, -200, -1)
        .exec();
    },
    async getRecentCommands(teamId, limit = 40) {
      const values = await redis.lRange(`${prefix}:commands:${teamId}`, -limit, -1);
      return values.flatMap((value) => {
        try { return [JSON.parse(value)]; } catch { return []; }
      });
    },
    async recordCompletion(teamId, completion) {
      const key = `${prefix}:completion:${teamId}`;
      const encoded = JSON.stringify(completion);
      const inserted = await redis.set(key, encoded, { NX: true });
      if (inserted === "OK") return completion;
      const existing = await redis.get(key);
      return existing ? JSON.parse(existing) : completion;
    },
    async getCompletion(teamId) {
      const existing = await redis.get(`${prefix}:completion:${teamId}`);
      return existing ? JSON.parse(existing) : null;
    },
    async close() { await redis.quit(); },
  };
}

function memoryStore() {
  const tickets = new Set();
  const codes = new Map();
  const commandLogs = new Map();
  const completions = new Map();
  return {
    mode: "memory",
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
    async appendCommand(teamId, command) {
      const commands = [...(commandLogs.get(teamId) || []), structuredClone(command)].slice(-200);
      commandLogs.set(teamId, commands);
    },
    async getRecentCommands(teamId, limit = 40) {
      return structuredClone((commandLogs.get(teamId) || []).slice(-limit));
    },
    async recordCompletion(teamId, completion) {
      if (!completions.has(teamId)) completions.set(teamId, structuredClone(completion));
      return structuredClone(completions.get(teamId));
    },
    async getCompletion(teamId) {
      const completion = completions.get(teamId);
      return completion ? structuredClone(completion) : null;
    },
    async close() {},
  };
}
