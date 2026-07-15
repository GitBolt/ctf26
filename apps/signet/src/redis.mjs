import { createClient } from "redis";

export class RedisConfigurationError extends Error {
  constructor(message) {
    super(message);
    this.name = "RedisConfigurationError";
  }
}

let activeTcpClient = null;
let activeTcpUrl = null;
let activeTcpConnection = null;

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
  const key = `ctf26:signet:launch:${record.eventId}:${record.jti}`;
  const result = await redisCommand(
    ["SET", key, record.teamId, "NX", "EXAT", String(record.expiresAt)],
    options,
  );
  return result === "OK";
}

export async function enforceSubmissionRateLimit(teamId, options = {}) {
  const key = `ctf26:signet:submit:${teamId}`;
  const script = [
    "local n=redis.call('INCR',KEYS[1]);",
    "if n==1 then redis.call('EXPIRE',KEYS[1],ARGV[1]); end;",
    "return n",
  ].join(" ");
  const count = Number(await redisCommand(["EVAL", script, "1", key, "60"], options));
  return { allowed: Number.isSafeInteger(count) && count <= 12, remaining: Math.max(0, 12 - count) };
}
