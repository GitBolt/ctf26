import { createClient } from "redis";

let activeClient = null;
let activeUrl = null;
let activeConnection = null;

export class LeaderboardStorageError extends Error {
  constructor(message) {
    super(message);
    this.name = "LeaderboardStorageError";
  }
}

function tcpUrl(env) {
  const encoded = String(env.REDIS_URL || "").trim();
  if (!encoded) return null;
  let url;
  try {
    url = new URL(encoded);
  } catch {
    throw new LeaderboardStorageError("REDIS_URL is invalid");
  }
  if (!['redis:', 'rediss:'].includes(url.protocol)) {
    throw new LeaderboardStorageError("REDIS_URL must use redis:// or rediss://");
  }
  return encoded;
}

function restCredentials(env) {
  const url = String(env.KV_REST_API_URL || env.UPSTASH_REDIS_REST_URL || "").replace(/\/$/, "");
  const token = String(env.KV_REST_API_TOKEN || env.UPSTASH_REDIS_REST_TOKEN || "");
  if (!url || !token) {
    throw new LeaderboardStorageError("REDIS_URL or Redis REST credentials are required");
  }
  return { url, token };
}

async function closeActiveClient() {
  const client = activeClient;
  activeClient = null;
  activeUrl = null;
  activeConnection = null;
  if (!client?.isOpen) return;
  try {
    await client.close();
  } catch {
    client.destroy();
  }
}

async function connectedClient(url) {
  if (activeUrl !== url) await closeActiveClient();
  if (!activeClient) {
    activeUrl = url;
    activeClient = createClient({
      url,
      socket: {
        connectTimeout: 5_000,
        reconnectStrategy(retries) {
          return retries >= 4 ? new Error("Redis reconnect limit reached") : Math.min(100 * 2 ** retries, 1_500);
        },
      },
    });
    activeClient.on("error", () => {});
    activeConnection = activeClient.connect().then(() => activeClient).catch((error) => {
      activeClient?.destroy();
      activeClient = null;
      activeUrl = null;
      activeConnection = null;
      throw error;
    });
  }
  if (!activeClient.isReady) await activeConnection;
  return activeClient;
}

export async function leaderboardRedisCommand(command, options = {}) {
  if (!Array.isArray(command) || command.length === 0) {
    throw new LeaderboardStorageError("Redis command must be a non-empty array");
  }
  const env = options.env || process.env;
  const url = tcpUrl(env);
  if (url) {
    const client = options.client || await connectedClient(url);
    return client.sendCommand(command.map((part) => String(part)));
  }

  const { url: restUrl, token } = restCredentials(env);
  const response = await (options.fetchImpl || fetch)(restUrl, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(command),
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) throw new LeaderboardStorageError("Redis REST request failed");
  const body = await response.json();
  if (body.error) throw new LeaderboardStorageError("Redis command failed");
  return body.result;
}
