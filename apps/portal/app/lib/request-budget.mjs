import crypto from "node:crypto";

import {
  RequestBudgetExceededError,
  RequestBudgetStorageError,
  consumeFixedWindowBudget,
  createMemoryBudgetExecutor,
  retryAfterHeaders,
} from "@ctf26/request-budget";

import { leaderboardRedisCommand } from "./leaderboard-redis.mjs";

const WINDOW_MS = 60_000;
const POLICIES = Object.freeze({
  // The whole field sits behind one venue NAT, so every participant shares an IP
  // bucket. A 120/min ceiling turns kickoff — 50 people opening several
  // challenges at once — into a burst of 429s. The per-participant cap below is
  // the real abuse guard; the IP bucket only needs to stop a single hostile host.
  launch: Object.freeze({ global: 2_400, ip: 1_200, participant: 12 }),
  scoreAttempt: Object.freeze({ global: 12_000, ip: 240 }),
  scoreIngest: Object.freeze({ global: 3_000, ip: 1_200, participant: 30 }),
  completionRecovery: Object.freeze({ global: 1_200, participant: 16 }),
  leaderboardRead: Object.freeze({ global: 3_600, ip: 1_200 }),
  adminMutation: Object.freeze({ global: 240, ip: 60, participant: 30 }),
  adminCritical: Object.freeze({ global: 30, ip: 10, participant: 6 }),
  health: Object.freeze({ global: 120, ip: 12 }),
});

const memoryExecute = createMemoryBudgetExecutor();

function digest(value) {
  return crypto.createHash("sha256").update(String(value || "unknown")).digest("hex").slice(0, 24);
}

function requestAddress(request) {
  for (const name of ["x-vercel-forwarded-for", "cf-connecting-ip", "x-real-ip", "x-forwarded-for"]) {
    const values = String(request?.headers?.get?.(name) || "").split(",");
    const value = values[values.length - 1].trim();
    if (value) return value.slice(0, 128);
  }
  return "unknown";
}

function budgetExecutor(env, options) {
  if (options.execute) return options.execute;
  const hasRedis = Boolean(
    String(env.REDIS_URL || "").trim()
    || (String(env.KV_REST_API_URL || env.UPSTASH_REDIS_REST_URL || "").trim()
      && String(env.KV_REST_API_TOKEN || env.UPSTASH_REDIS_REST_TOKEN || "").trim())
  );
  if (!hasRedis && env.NODE_ENV !== "production") return memoryExecute;
  return (command) => leaderboardRedisCommand(command, { env });
}

export async function consumePortalRequestBudget(name, {
  request,
  participantId,
  cost = 1,
  env = process.env,
  execute,
  now,
} = {}) {
  const policy = POLICIES[name];
  if (!policy) throw new TypeError("unknown portal request budget");
  const buckets = [{ key: `${name}:global`, limit: policy.global, cost, windowMs: WINDOW_MS }];
  if (policy.ip) {
    buckets.push({ key: `${name}:ip:${digest(requestAddress(request))}`, limit: policy.ip, cost, windowMs: WINDOW_MS });
  }
  if (policy.participant) {
    if (!participantId) throw new TypeError("participant identity is required for this request budget");
    buckets.push({ key: `${name}:participant:${digest(participantId)}`, limit: policy.participant, cost, windowMs: WINDOW_MS });
  }
  const generation = String(env.LEADERBOARD_EVENT_GENERATION || env.CTF_EVENT_GENERATION || "rehearsal")
    .replace(/[^A-Za-z0-9_-]/g, "_")
    .slice(0, 64);
  return consumeFixedWindowBudget({
    execute: budgetExecutor(env, { execute }),
    prefix: `ctf26:portal:budget:v1:${generation}`,
    buckets,
    now,
  });
}

export function portalBudgetErrorResponse(error) {
  if (!(error instanceof RequestBudgetExceededError) && !(error instanceof RequestBudgetStorageError)) return null;
  const status = error instanceof RequestBudgetExceededError ? 429 : 503;
  const message = status === 429
    ? "too many requests; wait for the current rate window"
    : "request controls are temporarily unavailable";
  return Response.json({ error: message }, { status, headers: retryAfterHeaders(error) });
}

export { POLICIES as PORTAL_REQUEST_BUDGETS };
