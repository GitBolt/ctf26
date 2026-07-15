import crypto from "node:crypto";
import { createClient } from "redis";

export async function createStore(env = process.env) {
  if (!env.REDIS_URL) return createMemoryStore();
  const redis = createClient({ url: env.REDIS_URL });
  redis.on("error", (error) => console.error("redis", error.message));
  await redis.connect();
  return createRedisStore(redis, env.AFTER_HOURS_REDIS_PREFIX || "after-hours:v1");
}

export function createMemoryStore({ now = () => Date.now(), passageTtlMs = 600_000 } = {}) {
  const tickets = new Set();
  const passages = new Map();
  const byDiscord = new Map();
  const byParticipant = new Map();
  const orders = new Map();
  const activeOrder = new Map();
  const signatures = new Set();
  const hints = new Map();
  const audits = new Map();
  return {
    mode: "memory",
    async consumeTicket(jti) { if (tickets.has(jti)) return false; tickets.add(jti); return true; },
    async issuePassage(identity) {
      const code = crypto.randomBytes(9).toString("base64url");
      passages.set(code, { identity: structuredClone(identity), expiresAt: now() + passageTtlMs });
      return code;
    },
    async bindPassage(code, discordUserId) {
      const passage = passages.get(code); passages.delete(code);
      if (!passage || passage.expiresAt < now()) return { ok: false, reason: "invalid" };
      const identity = passage.identity;
      const existingDiscord = byDiscord.get(discordUserId);
      const existingParticipant = byParticipant.get(identity.participantId);
      if (existingDiscord && existingDiscord.participantId !== identity.participantId) return { ok: false, reason: "discord_conflict" };
      if (existingParticipant && existingParticipant.discordUserId !== discordUserId) return { ok: false, reason: "participant_conflict" };
      const bound = { ...identity, discordUserId };
      byDiscord.set(discordUserId, bound); byParticipant.set(identity.participantId, bound);
      return { ok: true, identity: structuredClone(bound) };
    },
    async identityForDiscord(id) { return structuredClone(byDiscord.get(id) || null); },
    async createOrder(order) {
      const currentId = activeOrder.get(order.participantId);
      const current = currentId ? orders.get(currentId) : null;
      if (current?.status === "open" && current.expiresAt >= order.createdAt) return { created: false, order: structuredClone(current) };
      orders.set(order.id, structuredClone(order)); activeOrder.set(order.participantId, order.id);
      return { created: true, order: structuredClone(order) };
    },
    async activeOrder(participantId) {
      const id = activeOrder.get(participantId); return structuredClone(id ? orders.get(id) : null);
    },
    async fulfill(orderId, signature, evidence, fulfilledAt) {
      const order = orders.get(orderId);
      if (!order || order.status !== "open") return { ok: false, reason: "order_closed" };
      if (signatures.has(signature)) return { ok: false, reason: "signature_used" };
      signatures.add(signature);
      const fulfilled = { ...order, status: "fulfilled", fulfilledAt, evidence: structuredClone(evidence) };
      orders.set(orderId, fulfilled);
      return { ok: true, order: structuredClone(fulfilled) };
    },
    async nextHint(participantId) { const level = hints.get(participantId) || 0; hints.set(participantId, Math.min(3, level + 1)); return level; },
    async audit(participantId, event) { const list = audits.get(participantId) || []; list.push(event); audits.set(participantId, list.slice(-200)); },
    async auditLog(participantId) { return structuredClone(audits.get(participantId) || []); },
    async close() {},
  };
}

function createRedisStore(redis, prefix) {
  const key = (kind, id) => `${prefix}:${kind}:${id}`;
  return {
    mode: "redis",
    async consumeTicket(jti, expiresAt) {
      const ttl = Math.max(1, expiresAt - Math.floor(Date.now() / 1000));
      return (await redis.set(key("ticket", jti), "1", { NX: true, EX: ttl })) === "OK";
    },
    async issuePassage(identity) {
      const code = crypto.randomBytes(9).toString("base64url");
      await redis.set(key("passage", code), JSON.stringify(identity), { EX: 600 }); return code;
    },
    async bindPassage(code, discordUserId) {
      const script = `
        local passage = redis.call('GET', KEYS[1])
        if not passage then return {'invalid'} end
        redis.call('DEL', KEYS[1])
        local identity = cjson.decode(passage)
        local discord = redis.call('GET', KEYS[2])
        local participantKey = ARGV[1] .. identity.participantId
        local participant = redis.call('GET', participantKey)
        if discord and cjson.decode(discord).participantId ~= identity.participantId then return {'discord_conflict'} end
        if participant and cjson.decode(participant).discordUserId ~= ARGV[2] then return {'participant_conflict'} end
        identity.discordUserId = ARGV[2]
        local bound = cjson.encode(identity)
        redis.call('SET', KEYS[2], bound)
        redis.call('SET', participantKey, bound)
        return {'ok', bound}
      `;
      const result = await redis.eval(script, {
        keys: [key("passage", code), key("discord", discordUserId)],
        arguments: [`${prefix}:participant:`, discordUserId],
      });
      return result[0] === "ok" ? { ok: true, identity: JSON.parse(result[1]) } : { ok: false, reason: result[0] };
    },
    async identityForDiscord(id) { const raw = await redis.get(key("discord", id)); return raw ? JSON.parse(raw) : null; },
    async createOrder(order) {
      const script = `
        local currentId = redis.call('GET', KEYS[1])
        if currentId then
          local raw = redis.call('GET', ARGV[1] .. currentId)
          if raw then
            local current = cjson.decode(raw)
            if current.status == 'open' and tonumber(current.expiresAt) >= tonumber(ARGV[2]) then return {'existing', raw} end
          end
        end
        redis.call('SET', KEYS[1], ARGV[3])
        redis.call('SET', ARGV[1] .. ARGV[3], ARGV[4])
        return {'created', ARGV[4]}
      `;
      const result = await redis.eval(script, {
        keys: [key("active", order.participantId)],
        arguments: [`${prefix}:order:`, String(order.createdAt), order.id, JSON.stringify(order)],
      });
      return { created: result[0] === "created", order: JSON.parse(result[1]) };
    },
    async activeOrder(participantId) {
      const id = await redis.get(key("active", participantId));
      const raw = id ? await redis.get(key("order", id)) : null; return raw ? JSON.parse(raw) : null;
    },
    async fulfill(orderId, signature, evidence, fulfilledAt) {
      const script = `
        local raw = redis.call('GET', KEYS[1])
        if not raw then return {'order_closed'} end
        local order = cjson.decode(raw)
        if order.status ~= 'open' then return {'order_closed'} end
        if redis.call('EXISTS', KEYS[2]) == 1 then return {'signature_used'} end
        order.status = 'fulfilled'; order.fulfilledAt = tonumber(ARGV[1]); order.evidence = cjson.decode(ARGV[2])
        local updated = cjson.encode(order)
        redis.call('SET', KEYS[2], order.id)
        redis.call('SET', KEYS[1], updated)
        return {'ok', updated}
      `;
      const result = await redis.eval(script, {
        keys: [key("order", orderId), key("signature", signature)],
        arguments: [String(fulfilledAt), JSON.stringify(evidence)],
      });
      return result[0] === "ok" ? { ok: true, order: JSON.parse(result[1]) } : { ok: false, reason: result[0] };
    },
    async nextHint(participantId) { const level = Number(await redis.get(key("hint", participantId)) || 0); await redis.set(key("hint", participantId), String(Math.min(3, level + 1))); return level; },
    async audit(participantId, event) { await redis.lPush(key("audit", participantId), JSON.stringify(event)); await redis.lTrim(key("audit", participantId), 0, 199); },
    async auditLog(participantId) { return (await redis.lRange(key("audit", participantId), 0, 199)).map(JSON.parse).reverse(); },
    async close() { await redis.quit(); },
  };
}
