import { createClient } from "redis";
import crypto from "node:crypto";
import { eventGeneration } from "@ctf26/leaderboard";

export class RedisConfigurationError extends Error {
  constructor(message) {
    super(message);
    this.name = "RedisConfigurationError";
  }
}

let activeTcpClient = null;
let activeTcpUrl = null;
let activeTcpConnection = null;
const localCompletions = new Map();
const localRateBuckets = new Map();
const localOperationLeases = new Map();

export function signetRedisKey(kind, id, env = process.env) {
  const prefix = `ctf26:signet:${eventGeneration(env)}`;
  return id === undefined ? `${prefix}:${kind}` : `${prefix}:${kind}:${id}`;
}

function restConfig(env = process.env) {
  const url = env.KV_REST_API_URL || env.UPSTASH_REDIS_REST_URL;
  const token = env.KV_REST_API_TOKEN || env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    throw new RedisConfigurationError("REDIS_URL or Redis REST credentials are required");
  }
  return { url: url.replace(/\/$/, ""), token };
}

function tcpUrl(env) {
  if (!env.REDIS_URL) return null;
  let parsed;
  try {
    parsed = new URL(env.REDIS_URL);
  } catch {
    throw new RedisConfigurationError("REDIS_URL is invalid");
  }
  if (parsed.protocol !== "redis:" && parsed.protocol !== "rediss:") {
    throw new RedisConfigurationError("REDIS_URL must use redis:// or rediss://");
  }
  return env.REDIS_URL;
}

async function connectedTcpClient(url) {
  if (activeTcpUrl !== url) {
    await closeRedis();
    activeTcpUrl = url;
  }
  if (!activeTcpClient) {
    activeTcpClient = createClient({
      url,
      socket: {
        connectTimeout: 5_000,
        reconnectStrategy(retries) {
          return retries >= 5 ? new Error("Redis reconnect limit reached") : Math.min(100 * 2 ** retries, 2_000);
        },
      },
    });
    // Node Redis requires an error listener. Command failures still propagate to callers.
    activeTcpClient.on("error", () => {});
    activeTcpConnection = activeTcpClient.connect().then(() => activeTcpClient).catch((error) => {
      activeTcpClient?.destroy();
      activeTcpClient = null;
      activeTcpConnection = null;
      throw error;
    });
  }
  if (!activeTcpClient.isReady) await activeTcpConnection;
  return activeTcpClient;
}

export async function closeRedis() {
  const client = activeTcpClient;
  activeTcpClient = null;
  activeTcpConnection = null;
  activeTcpUrl = null;
  if (!client?.isOpen) return;
  try {
    await client.close();
  } catch {
    client.destroy();
  }
}

export async function redisCommand(
  command,
  { env = process.env, fetchImpl = fetch, tcpClient } = {},
) {
  if (!Array.isArray(command) || command.length === 0) {
    throw new RedisConfigurationError("Redis command must be a non-empty array");
  }
  const url = tcpUrl(env);
  if (url) {
    const client = tcpClient || await connectedTcpClient(url);
    return client.sendCommand(command.map((part) => String(part)));
  }

  const { url: restUrl, token } = restConfig(env);
  const response = await fetchImpl(restUrl, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(command),
    signal: AbortSignal.timeout(5_000),
  });

  if (!response.ok) throw new Error("replay store request failed");
  const body = await response.json();
  if (body.error) throw new Error("replay store command failed");
  return body.result;
}

export async function consumeLaunchJti(record, options = {}) {
  const key = signetRedisKey("launch", `${record.eventId}:${record.jti}`, options.env || process.env);
  const result = await redisCommand(
    ["SET", key, record.participantId, "NX", "EXAT", String(record.expiresAt)],
    options,
  );
  return result === "OK";
}

export async function enforceSubmissionRateLimit(participantId, options = {}) {
  const env = options.env || process.env;
  const limit = Number(env.SIGNET_SUBMIT_LIMIT_PER_MINUTE || 12);
  if (!Number.isSafeInteger(limit) || limit < 1) {
    throw new RedisConfigurationError("SIGNET_SUBMIT_LIMIT_PER_MINUTE is invalid");
  }
  const key = signetRedisKey("submit", participantId, env);
  const count = await incrementWindow(key, 60, options);
  return {
    allowed: Number.isSafeInteger(count) && count <= limit,
    remaining: Math.max(0, limit - count),
    retryAfter: 60,
  };
}

export async function enforceTargetRateLimit(participantId, options = {}) {
  const env = options.env || process.env;
  const limit = Number(env.SIGNET_TARGET_LIMIT_PER_MINUTE || 30);
  if (!Number.isSafeInteger(limit) || limit < 1) {
    throw new RedisConfigurationError("SIGNET_TARGET_LIMIT_PER_MINUTE is invalid");
  }
  const key = signetRedisKey("target-read", participantId, env);
  const count = await incrementWindow(key, 60, options);
  return {
    allowed: Number.isSafeInteger(count) && count <= limit,
    remaining: Math.max(0, limit - count),
    retryAfter: 60,
  };
}

export async function enforceSessionAttemptRateLimit(sourceKey, options = {}) {
  const env = options.env || process.env;
  const limit = Number(env.SIGNET_SESSION_ATTEMPT_LIMIT_PER_IP_PER_MINUTE || 120);
  if (!Number.isSafeInteger(limit) || limit < 1) {
    throw new RedisConfigurationError("SIGNET_SESSION_ATTEMPT_LIMIT_PER_IP_PER_MINUTE is invalid");
  }
  const key = signetRedisKey("rate:session-attempt-ip", sourceKey, env);
  const count = await incrementWindow(key, 60, options);
  return {
    allowed: Number.isSafeInteger(count) && count <= limit,
    remaining: Math.max(0, limit - count),
    retryAfter: 60,
  };
}

export async function enforceParticipantSessionRateLimit(participantId, options = {}) {
  const env = options.env || process.env;
  const limit = Number(env.SIGNET_PARTICIPANT_SESSION_LIMIT_PER_MINUTE || 12);
  if (!Number.isSafeInteger(limit) || limit < 1) {
    throw new RedisConfigurationError("SIGNET_PARTICIPANT_SESSION_LIMIT_PER_MINUTE is invalid");
  }
  const key = signetRedisKey("rate:session", participantId, env);
  const count = await incrementWindow(key, 60, options);
  return {
    allowed: Number.isSafeInteger(count) && count <= limit,
    remaining: Math.max(0, limit - count),
    retryAfter: 60,
  };
}

export async function enforceGlobalRateLimit(kind, options = {}) {
  const env = options.env || process.env;
  const limits = {
    session: Number(env.SIGNET_SESSION_LIMIT_PER_MINUTE || 240),
    "session-attempt": Number(env.SIGNET_GLOBAL_SESSION_ATTEMPT_LIMIT_PER_MINUTE || 5_000),
    submit: Number(env.SIGNET_GLOBAL_SUBMIT_LIMIT_PER_MINUTE || 240),
    target: Number(env.SIGNET_GLOBAL_TARGET_LIMIT_PER_MINUTE || 600),
  };
  const limit = limits[kind];
  if (!Number.isSafeInteger(limit) || limit < 1) {
    throw new RedisConfigurationError(`SIGNET ${kind} rate limit is invalid`);
  }
  const key = signetRedisKey(`rate:${kind}`, "global", env);
  const count = await incrementWindow(key, 60, options);
  return {
    allowed: count <= limit,
    remaining: Math.max(0, limit - count),
    retryAfter: 60,
  };
}

export async function acquireSubmissionLease(participantId, options = {}) {
  const env = options.env || process.env;
  const ttl = Number(env.SIGNET_SUBMIT_LEASE_SECONDS || 60);
  const maxConcurrency = Number(env.SIGNET_MAX_CONCURRENCY || 8);
  if (!Number.isSafeInteger(ttl) || ttl < 45 || ttl > 120) {
    throw new RedisConfigurationError("SIGNET_SUBMIT_LEASE_SECONDS must be between 45 and 120");
  }
  if (!Number.isSafeInteger(maxConcurrency) || maxConcurrency < 1 || maxConcurrency > 64) {
    throw new RedisConfigurationError("SIGNET_MAX_CONCURRENCY must be between 1 and 64");
  }
  const token = crypto.randomUUID();
  const participantKey = signetRedisKey("active-submit", participantId, env);
  if (!hasRedis(env)) {
    const now = options.nowMs ?? Date.now();
    pruneLocalLeases(now);
    if (localOperationLeases.has(participantKey)) return null;
    const active = [...localOperationLeases.keys()].filter((key) => key.includes(":active-submit:")).length;
    if (active >= maxConcurrency) return null;
    localOperationLeases.set(participantKey, { token, expiresAt: now + ttl * 1_000 });
    return Object.freeze({ token, participantKey, slot: null, local: true });
  }
  const claimed = await redisCommand(["SET", participantKey, token, "NX", "EX", String(ttl)], options);
  if (claimed !== "OK") return null;
  for (let slot = 0; slot < maxConcurrency; slot += 1) {
    const slotKey = signetRedisKey("active-submit-slot", String(slot), env);
    if (await redisCommand(["SET", slotKey, token, "NX", "EX", String(ttl)], options) === "OK") {
      return Object.freeze({ token, participantKey, slot: slotKey, local: false });
    }
  }
  await deleteOwnedLease(participantKey, token, options);
  return null;
}

export async function releaseSubmissionLease(lease, options = {}) {
  if (!lease) return;
  if (lease.local) {
    const current = localOperationLeases.get(lease.participantKey);
    if (current?.token === lease.token) localOperationLeases.delete(lease.participantKey);
    return;
  }
  await Promise.all([
    deleteOwnedLease(lease.participantKey, lease.token, options),
    lease.slot ? deleteOwnedLease(lease.slot, lease.token, options) : Promise.resolve(),
  ]);
}

async function incrementWindow(key, seconds, options) {
  const env = options.env || process.env;
  if (!hasRedis(env)) {
    const now = options.nowMs ?? Date.now();
    const windowMs = seconds * 1_000;
    let entry = localRateBuckets.get(key);
    if (!entry || entry.expiresAt <= now) entry = { count: 0, expiresAt: now + windowMs };
    entry.count += 1;
    localRateBuckets.set(key, entry);
    if (localRateBuckets.size > 4_096) {
      for (const [candidate, value] of localRateBuckets) {
        if (value.expiresAt <= now) localRateBuckets.delete(candidate);
      }
    }
    return entry.count;
  }
  const script = [
    "local n=redis.call('INCR',KEYS[1]);",
    "if n==1 then redis.call('EXPIRE',KEYS[1],ARGV[1]); end;",
    "return n",
  ].join(" ");
  return Number(await redisCommand(["EVAL", script, "1", key, String(seconds)], options));
}

function hasRedis(env) {
  return Boolean(env.REDIS_URL || env.KV_REST_API_URL || env.UPSTASH_REDIS_REST_URL);
}

function pruneLocalLeases(now) {
  for (const [key, lease] of localOperationLeases) {
    if (lease.expiresAt <= now) localOperationLeases.delete(key);
  }
}

async function deleteOwnedLease(key, token, options) {
  const script = "if redis.call('GET',KEYS[1])==ARGV[1] then return redis.call('DEL',KEYS[1]) else return 0 end";
  return redisCommand(["EVAL", script, "1", key, token], options);
}

export async function recordCompletion(participantId, completion, options = {}) {
  const env = options.env || process.env;
  const generation = eventGeneration(env);
  const value = Object.freeze({ ...completion, eventGeneration: generation });
  const key = signetRedisKey("completion", participantId, env);
  if (env.NODE_ENV !== "production" && !env.REDIS_URL && !env.KV_REST_API_URL && !env.UPSTASH_REDIS_REST_URL) {
    if (!localCompletions.has(key)) localCompletions.set(key, structuredClone(value));
    return structuredClone(localCompletions.get(key));
  }
  const inserted = await redisCommand(["SET", key, JSON.stringify(value), "NX"], options);
  if (inserted === "OK") return value;
  const existing = await redisCommand(["GET", key], options);
  return typeof existing === "string" ? JSON.parse(existing) : value;
}

export async function completionForParticipant(participantId, options = {}) {
  const env = options.env || process.env;
  const key = signetRedisKey("completion", participantId, env);
  if (env.NODE_ENV !== "production" && !env.REDIS_URL && !env.KV_REST_API_URL && !env.UPSTASH_REDIS_REST_URL) {
    const value = localCompletions.get(key);
    return value ? structuredClone(value) : null;
  }
  const existing = await redisCommand(["GET", key], options);
  return typeof existing === "string" ? JSON.parse(existing) : null;
}
