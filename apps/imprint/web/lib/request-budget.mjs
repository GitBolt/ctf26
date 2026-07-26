import crypto from "node:crypto";
import { createClient } from "redis";

import {
  RequestBudgetExceededError,
  RequestBudgetStorageError,
  consumeFixedWindowBudget,
  createMemoryBudgetExecutor,
  retryAfterHeaders,
} from "@ctf26/request-budget";

const WINDOW_MS = 60_000;
const POLICIES = Object.freeze({
  session: Object.freeze({ global: 2_400, ip: 120 }),
  passkeyOptions: Object.freeze({ global: 2_400, ip: 600, participant: 20 }),
  passkeyClaim: Object.freeze({ global: 1_200, ip: 120, participant: 6 }),
  solve: Object.freeze({ global: 1_200, ip: 120, participant: 12 }),
  rpc: Object.freeze({ global: 20_000, ip: 4_000, participant: 1_000 }),
});

const RPC_WEIGHTS = Object.freeze({
  getAccountInfo: 1,
  getLatestBlockhash: 1,
  getMinimumBalanceForRentExemption: 1,
  getMultipleAccounts: 3,
  getSignatureStatuses: 2,
  simulateTransaction: 5,
  sendTransaction: 8,
});

const memoryExecute = createMemoryBudgetExecutor();
let client;
let connection;
let activeUrl;

export class ImprintRequestError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function digest(value) {
  return crypto
    .createHash("sha256")
    .update(String(value || "unknown"))
    .digest("hex")
    .slice(0, 24);
}

function requestAddress(request) {
  for (const name of [
    "x-vercel-forwarded-for",
    "cf-connecting-ip",
    "x-forwarded-for",
  ]) {
    const values = String(request?.headers?.get?.(name) || "").split(",");
    const value = values[values.length - 1].trim();
    if (value) return value.slice(0, 128);
  }
  return "unknown";
}

async function redisExecutor(command, env) {
  const url = String(env.REDIS_URL || "").trim();
  if (!url) throw new Error("REDIS_URL is required for request controls");
  if (activeUrl !== url) {
    if (client?.isOpen) await client.close().catch(() => client.destroy());
    client = undefined;
    connection = undefined;
    activeUrl = url;
  }
  if (!client) {
    client = createClient({
      url,
      socket: {
        connectTimeout: 5_000,
        reconnectStrategy: (retries) =>
          retries >= 4
            ? new Error("Redis reconnect limit reached")
            : Math.min(100 * 2 ** retries, 1_500),
      },
    });
    client.on("error", () => {});
    connection = client.connect().catch((error) => {
      client?.destroy();
      client = undefined;
      connection = undefined;
      throw error;
    });
  }
  if (!client.isReady) await connection;
  return client.sendCommand(command.map(String));
}

function executor(env, override) {
  if (override) return override;
  if (String(env.REDIS_URL || "").trim())
    return (command) => redisExecutor(command, env);
  if (env.NODE_ENV !== "production") return memoryExecute;
  return async () => {
    throw new Error("REDIS_URL is required for production request controls");
  };
}

export async function consumeImprintRequestBudget(
  name,
  { request, participantId, cost = 1, env = process.env, execute, now } = {}
) {
  const policy = POLICIES[name];
  if (!policy) throw new TypeError("unknown IMPRINT request budget");
  const buckets = [
    { key: `${name}:global`, limit: policy.global, cost, windowMs: WINDOW_MS },
  ];
  if (policy.ip)
    buckets.push({
      key: `${name}:ip:${digest(requestAddress(request))}`,
      limit: policy.ip,
      cost,
      windowMs: WINDOW_MS,
    });
  if (policy.participant) {
    if (!participantId)
      throw new TypeError(
        "participant identity is required for this request budget"
      );
    buckets.push({
      key: `${name}:participant:${digest(participantId)}`,
      limit: policy.participant,
      cost,
      windowMs: WINDOW_MS,
    });
  }
  const generation = String(env.CTF_EVENT_GENERATION || "rehearsal")
    .replace(/[^A-Za-z0-9_-]/g, "_")
    .slice(0, 64);
  return consumeFixedWindowBudget({
    execute: executor(env, execute),
    prefix: `ctf26:imprint:budget:v1:${generation}`,
    buckets,
    now,
  });
}

export function imprintRpcCost(calls) {
  if (!Array.isArray(calls) || calls.length === 0)
    throw new TypeError("RPC calls are required");
  return calls.reduce(
    (total, call) => total + (RPC_WEIGHTS[call?.method] || 1),
    0
  );
}

export async function readBoundedText(request, maximumBytes) {
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > maximumBytes)
    throw new ImprintRequestError(413, "request body is too large");
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maximumBytes) {
      await reader.cancel().catch(() => {});
      throw new ImprintRequestError(413, "request body is too large");
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks).toString("utf8");
}

export async function readBoundedJson(request, maximumBytes) {
  const body = await readBoundedText(request, maximumBytes);
  try {
    const value = JSON.parse(body || "{}");
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error();
    return value;
  } catch {
    throw new ImprintRequestError(400, "request body must be a JSON object");
  }
}

export function imprintRequestErrorResponse(error) {
  if (error instanceof ImprintRequestError) {
    return Response.json(
      { error: error.message },
      { status: error.status, headers: { "cache-control": "no-store" } }
    );
  }
  if (
    !(error instanceof RequestBudgetExceededError) &&
    !(error instanceof RequestBudgetStorageError)
  )
    return null;
  const status = error instanceof RequestBudgetExceededError ? 429 : 503;
  return Response.json(
    {
      error:
        status === 429
          ? "too many requests; wait for the current rate window"
          : "request controls are temporarily unavailable",
    },
    { status, headers: retryAfterHeaders(error) }
  );
}

export {
  POLICIES as IMPRINT_REQUEST_BUDGETS,
  RPC_WEIGHTS as IMPRINT_RPC_WEIGHTS,
};
