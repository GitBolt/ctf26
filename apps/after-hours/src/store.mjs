import crypto from "node:crypto";
import { createClient } from "redis";
import { eventGeneration } from "@ctf26/leaderboard";

export async function createStore(env = process.env) {
  const generation = eventGeneration(env);
  const leaseSeconds = allotmentLeaseSeconds(env);
  if (!env.REDIS_URL) {
    if (env.NODE_ENV === "production") throw new Error("REDIS_URL is required in production");
    return createMemoryStore({ generation, leaseSeconds });
  }
  const redis = createClient({ url: env.REDIS_URL });
  redis.on("error", (error) => console.error("redis", error.message));
  await redis.connect();
  return createRedisStore(redis, `${env.AFTER_HOURS_REDIS_PREFIX || "after-hours:v1"}:${generation}`, generation, leaseSeconds);
}

function allotmentLeaseSeconds(env) {
  const value = Number(env.AFTER_HOURS_ALLOTMENT_LEASE_SECONDS || 90);
  if (!Number.isSafeInteger(value) || value < 30 || value > 300) {
    throw new Error("AFTER_HOURS_ALLOTMENT_LEASE_SECONDS must be an integer between 30 and 300");
  }
  return value;
}

export function createMemoryStore({ now = () => Date.now(), passageTtlMs = 600_000, generation = "rehearsal", leaseSeconds = 90 } = {}) {
  const tickets = new Set();
  const passages = new Map();
  const byDiscord = new Map();
  const byParticipant = new Map();
  const orders = new Map();
  const activeOrder = new Map();
  const signatures = new Set();
  const completions = new Map();
  const allotments = new Map();
  const issuedParticipants = new Set();
  const audits = new Map();
  const rates = new Map();
  const slots = new Map();
  return {
    mode: "memory",
    eventGeneration: generation,
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
    async beginAllotment(participantId, wallet, mint, at) {
      const current = allotments.get(participantId);
      const sameAsset = current?.mint === mint;
      if (sameAsset && current.wallet !== wallet) return { ok: false, reason: "wallet_conflict", allotment: structuredClone(current) };
      if (sameAsset && current.status === "issued") return { ok: false, reason: "issued", allotment: structuredClone(current) };
      if (sameAsset && current.status === "pending" && at < current.startedAt + leaseSeconds) return { ok: false, reason: "pending", allotment: structuredClone(current) };
      const pending = { participantId, wallet, mint, status: "pending", startedAt: at, leaseId: crypto.randomBytes(16).toString("base64url"), attempts: sameAsset ? Number(current?.attempts || 0) + 1 : 1 };
      allotments.set(participantId, pending);
      return { ok: true, allotment: structuredClone(pending) };
    },
    async completeAllotment(participantId, wallet, mint, leaseId, evidence, at) {
      const current = allotments.get(participantId);
      if (!current || current.wallet !== wallet || current.mint !== mint || current.leaseId !== leaseId || current.status !== "pending") return { ok: false };
      const issued = { ...current, status: "issued", issuedAt: at, evidence: structuredClone(evidence) };
      allotments.set(participantId, issued);
      issuedParticipants.add(participantId);
      return { ok: true, allotment: structuredClone(issued) };
    },
    async failAllotment(participantId, wallet, mint, leaseId, reason, at) {
      const current = allotments.get(participantId);
      if (current?.wallet === wallet && current.mint === mint && current.leaseId === leaseId && current.status === "pending") allotments.set(participantId, { ...current, status: "failed", failedAt: at, reason });
    },
    async allotmentForParticipant(participantId) { return structuredClone(allotments.get(participantId) || null); },
    async issuedAllotmentCount() { return issuedParticipants.size; },
    async createOrder(order) {
      const currentId = activeOrder.get(order.participantId);
      const current = currentId ? orders.get(currentId) : null;
      if (current?.status === "open" && current.expiresAt >= order.createdAt && current.nightMint === order.nightMint) return { created: false, order: structuredClone(current) };
      orders.set(order.id, structuredClone(order)); activeOrder.set(order.participantId, order.id);
      return { created: true, order: structuredClone(order) };
    },
    async activeOrder(participantId) {
      const id = activeOrder.get(participantId); return structuredClone(id ? orders.get(id) : null);
    },
    async orderById(orderId) { return structuredClone(orders.get(orderId) || null); },
    async fulfill(orderId, signature, evidence, fulfilledAt) {
      const order = orders.get(orderId);
      if (!order || order.status !== "open") return { ok: false, reason: "order_closed" };
      if (signatures.has(signature)) return { ok: false, reason: "signature_used" };
      signatures.add(signature);
      const fulfilled = { ...order, status: "fulfilled", fulfilledAt, evidence: structuredClone(evidence) };
      orders.set(orderId, fulfilled);
      completions.set(order.participantId, fulfilledAt);
      return { ok: true, order: structuredClone(fulfilled) };
    },
    async settleExpectedPayment(orderId, signature, evidence, settledAt) {
      const order = orders.get(orderId);
      if (!order || order.status !== "open") return { ok: false, reason: "order_closed" };
      if (signatures.has(signature)) return { ok: false, reason: "signature_used" };
      signatures.add(signature);
      const settled = { ...order, status: "expected-payment", settledAt, evidence: structuredClone(evidence) };
      orders.set(orderId, settled);
      return { ok: true, order: structuredClone(settled) };
    },
    async completionForParticipant(participantId) { return completions.get(participantId) || null; },
    async audit(participantId, event) { const list = audits.get(participantId) || []; list.push(event); audits.set(participantId, list.slice(-200)); },
    async auditLog(participantId) { return structuredClone(audits.get(participantId) || []); },
    async hitRate(id, at, max, windowMs) {
      let value = rates.get(id);
      if (!value || at - value.startedAt >= windowMs) value = { startedAt: at, count: 0 };
      value.count += 1; rates.set(id, value); return value.count <= max;
    },
    async acquireSlot(scope, holder, at, ttlMs, max) {
      const active = slots.get(scope) || new Map();
      for (const [id, expiresAt] of active) if (expiresAt <= at) active.delete(id);
      if (active.has(holder) || active.size >= max) return false;
      active.set(holder, at + ttlMs); slots.set(scope, active); return true;
    },
    async releaseSlot(scope, holder) { slots.get(scope)?.delete(holder); },
    async health() { return true; },
    async close() {},
  };
}

function createRedisStore(redis, prefix, generation, leaseSeconds) {
  const key = (kind, id) => `${prefix}:${kind}:${id}`;
  let issuedIndexReady = null;
  const ensureIssuedIndex = async () => {
    if (issuedIndexReady) return issuedIndexReady;
    issuedIndexReady = (async () => {
      const marker = key("issued-participants", "backfilled");
      if (await redis.exists(marker)) return;
      for await (const allotmentKeys of redis.scanIterator({ MATCH: `${prefix}:allotment:*`, COUNT: 100 })) {
        if (!allotmentKeys.length) continue;
        const rows = await redis.mGet(allotmentKeys);
        for (const raw of rows) {
          if (!raw) continue;
          const allotment = JSON.parse(raw);
          if (allotment.status === "issued" && allotment.participantId) {
            await redis.sAdd(key("issued-participants", "all"), allotment.participantId);
          }
        }
      }
      await redis.set(marker, "1");
    })().catch((error) => { issuedIndexReady = null; throw error; });
    return issuedIndexReady;
  };
  return {
    mode: "redis",
    eventGeneration: generation,
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
    async beginAllotment(participantId, wallet, mint, at) {
      const leaseId = crypto.randomBytes(16).toString("base64url");
      const script = `
        local raw = redis.call('GET', KEYS[1])
        if raw then
          local current = cjson.decode(raw)
          if current.mint == ARGV[2] then
            if current.wallet ~= ARGV[1] then return {'wallet_conflict', raw} end
            if current.status == 'issued' then return {'issued', raw} end
            if current.status == 'pending' and tonumber(ARGV[3]) < tonumber(current.startedAt) + tonumber(ARGV[6]) then return {'pending', raw} end
            current.status = 'pending'; current.startedAt = tonumber(ARGV[3]); current.leaseId = ARGV[5]; current.attempts = tonumber(current.attempts or 0) + 1
            local updated = cjson.encode(current); redis.call('SET', KEYS[1], updated); return {'ok', updated}
          end
        end
        local pending = cjson.encode({participantId=ARGV[4], wallet=ARGV[1], mint=ARGV[2], status='pending', startedAt=tonumber(ARGV[3]), leaseId=ARGV[5], attempts=1})
        redis.call('SET', KEYS[1], pending); return {'ok', pending}
      `;
      const result = await redis.eval(script, { keys: [key("allotment", participantId)], arguments: [wallet, mint, String(at), participantId, leaseId, String(leaseSeconds)] });
      return { ok: result[0] === "ok", ...(result[0] !== "ok" ? { reason: result[0] } : {}), allotment: JSON.parse(result[1]) };
    },
    async completeAllotment(participantId, wallet, mint, leaseId, evidence, at) {
      const script = `
        local raw = redis.call('GET', KEYS[1]); if not raw then return {'missing'} end
        local current = cjson.decode(raw)
        if current.wallet ~= ARGV[1] or current.mint ~= ARGV[2] or current.leaseId ~= ARGV[3] or current.status ~= 'pending' then return {'conflict'} end
        current.status = 'issued'; current.issuedAt = tonumber(ARGV[4]); current.evidence = cjson.decode(ARGV[5])
        local updated = cjson.encode(current)
        redis.call('SET', KEYS[1], updated)
        redis.call('SADD', KEYS[2], ARGV[6])
        return {'ok', updated}
      `;
      const result = await redis.eval(script, {
        keys: [key("allotment", participantId), key("issued-participants", "all")],
        arguments: [wallet, mint, leaseId, String(at), JSON.stringify(evidence), participantId],
      });
      return result[0] === "ok" ? { ok: true, allotment: JSON.parse(result[1]) } : { ok: false };
    },
    async failAllotment(participantId, wallet, mint, leaseId, reason, at) {
      const script = `
        local raw = redis.call('GET', KEYS[1]); if not raw then return 0 end
        local current = cjson.decode(raw)
        if current.wallet ~= ARGV[1] or current.mint ~= ARGV[2] or current.leaseId ~= ARGV[3] or current.status ~= 'pending' then return 0 end
        current.status = 'failed'; current.failedAt = tonumber(ARGV[4]); current.reason = ARGV[5]
        redis.call('SET', KEYS[1], cjson.encode(current)); return 1
      `;
      await redis.eval(script, { keys: [key("allotment", participantId)], arguments: [wallet, mint, leaseId, String(at), String(reason)] });
    },
    async allotmentForParticipant(participantId) {
      const raw = await redis.get(key("allotment", participantId)); return raw ? JSON.parse(raw) : null;
    },
    async issuedAllotmentCount() { await ensureIssuedIndex(); return redis.sCard(key("issued-participants", "all")); },
    async createOrder(order) {
      const script = `
        local currentId = redis.call('GET', KEYS[1])
        if currentId then
          local raw = redis.call('GET', ARGV[1] .. currentId)
          if raw then
            local current = cjson.decode(raw)
            if current.status == 'open' and tonumber(current.expiresAt) >= tonumber(ARGV[2]) and current.nightMint == ARGV[5] then return {'existing', raw} end
          end
        end
        redis.call('SET', KEYS[1], ARGV[3])
        redis.call('SET', ARGV[1] .. ARGV[3], ARGV[4])
        return {'created', ARGV[4]}
      `;
      const result = await redis.eval(script, {
        keys: [key("active", order.participantId)],
        arguments: [`${prefix}:order:`, String(order.createdAt), order.id, JSON.stringify(order), order.nightMint],
      });
      return { created: result[0] === "created", order: JSON.parse(result[1]) };
    },
    async activeOrder(participantId) {
      const id = await redis.get(key("active", participantId));
      const raw = id ? await redis.get(key("order", id)) : null; return raw ? JSON.parse(raw) : null;
    },
    async orderById(orderId) {
      const raw = await redis.get(key("order", orderId));
      return raw ? JSON.parse(raw) : null;
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
        redis.call('SET', ARGV[3] .. order.participantId, tostring(order.fulfilledAt))
        return {'ok', updated}
      `;
      const result = await redis.eval(script, {
        keys: [key("order", orderId), key("signature", signature)],
        arguments: [String(fulfilledAt), JSON.stringify(evidence), `${prefix}:completion:`],
      });
      return result[0] === "ok" ? { ok: true, order: JSON.parse(result[1]) } : { ok: false, reason: result[0] };
    },
    async settleExpectedPayment(orderId, signature, evidence, settledAt) {
      const script = `
        local raw = redis.call('GET', KEYS[1])
        if not raw then return {'order_closed'} end
        local order = cjson.decode(raw)
        if order.status ~= 'open' then return {'order_closed'} end
        if redis.call('EXISTS', KEYS[2]) == 1 then return {'signature_used'} end
        order.status = 'expected-payment'; order.settledAt = tonumber(ARGV[1]); order.evidence = cjson.decode(ARGV[2])
        local updated = cjson.encode(order)
        redis.call('SET', KEYS[2], order.id)
        redis.call('SET', KEYS[1], updated)
        return {'ok', updated}
      `;
      const result = await redis.eval(script, {
        keys: [key("order", orderId), key("signature", signature)],
        arguments: [String(settledAt), JSON.stringify(evidence)],
      });
      return result[0] === "ok" ? { ok: true, order: JSON.parse(result[1]) } : { ok: false, reason: result[0] };
    },
    async completionForParticipant(participantId) { return redis.get(key("completion", participantId)); },
    async audit(participantId, event) { await redis.lPush(key("audit", participantId), JSON.stringify(event)); await redis.lTrim(key("audit", participantId), 0, 199); },
    async auditLog(participantId) { return (await redis.lRange(key("audit", participantId), 0, 199)).map(JSON.parse).reverse(); },
    async hitRate(id, at, max, windowMs) {
      const rateKey = key("rate", `${id}:${Math.floor(at / windowMs)}`);
      const count = await redis.incr(rateKey);
      if (count === 1) await redis.pExpire(rateKey, windowMs + 1_000);
      return count <= max;
    },
    async acquireSlot(scope, holder, at, ttlMs, max) {
      const script = `
        redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', ARGV[1])
        if redis.call('ZSCORE', KEYS[1], ARGV[2]) then return 0 end
        if redis.call('ZCARD', KEYS[1]) >= tonumber(ARGV[4]) then return 0 end
        redis.call('ZADD', KEYS[1], tonumber(ARGV[1]) + tonumber(ARGV[3]), ARGV[2])
        local latest = redis.call('ZREVRANGE', KEYS[1], 0, 0, 'WITHSCORES')
        if latest[2] then redis.call('PEXPIRE', KEYS[1], math.max(1000, tonumber(latest[2]) - tonumber(ARGV[1]) + 1000)) end
        return 1
      `;
      return Number(await redis.eval(script, { keys: [key("slots", scope)], arguments: [String(at), holder, String(ttlMs), String(max)] })) === 1;
    },
    async releaseSlot(scope, holder) { await redis.zRem(key("slots", scope), holder); },
    async health() { return String(await redis.ping()).toUpperCase() === "PONG"; },
    async close() { await redis.quit(); },
  };
}
