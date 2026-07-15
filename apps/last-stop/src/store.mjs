import crypto from "node:crypto";
import { createClient } from "redis";
import { initialState } from "./game.mjs";

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
    async getTeam(teamId) {
      const raw = await redis.get(`${prefix}:team:${teamId}`);
      return raw ? JSON.parse(raw) : initialState();
    },
    async setTeam(teamId, state) {
      await redis.set(`${prefix}:team:${teamId}`, JSON.stringify(state));
    },
    async close() { await redis.quit(); },
  };
}

function memoryStore() {
  const tickets = new Set();
  const codes = new Map();
  const teams = new Map();
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
    async getTeam(teamId) { return structuredClone(teams.get(teamId) || initialState()); },
    async setTeam(teamId, state) { teams.set(teamId, structuredClone(state)); },
    async close() {},
  };
}
