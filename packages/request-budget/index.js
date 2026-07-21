import { isIP } from "node:net";

const FIXED_WINDOW_SCRIPT = `
local allowed = 1
local retry_ms = 0
local counts = {}
for index, key in ipairs(KEYS) do
  local offset = (index - 1) * 3
  local cost = tonumber(ARGV[offset + 1])
  local limit = tonumber(ARGV[offset + 2])
  local ttl = tonumber(ARGV[offset + 3])
  local count = tonumber(redis.call('GET', key) or '0')
  local remaining = redis.call('PTTL', key)
  if remaining < 0 then
    redis.call('DEL', key)
    count = 0
    remaining = ttl
  end
  if count + cost > limit then
    allowed = 0
    if remaining > retry_ms then retry_ms = remaining end
  end
  table.insert(counts, count)
end
if allowed == 1 then
  counts = {}
  for index, key in ipairs(KEYS) do
    local offset = (index - 1) * 3
    local cost = tonumber(ARGV[offset + 1])
    local ttl = tonumber(ARGV[offset + 3])
    local count = redis.call('INCRBY', key, cost)
    if count == cost or redis.call('PTTL', key) < 0 then redis.call('PEXPIRE', key, ttl) end
    table.insert(counts, count)
  end
end
local result = { allowed, retry_ms }
for _, count in ipairs(counts) do table.insert(result, count) end
return result
`;

const KEY_PATTERN = /^[A-Za-z0-9:_-]{1,300}$/;

export class RequestBudgetExceededError extends Error {
  constructor(retryAfterSeconds) {
    super("request budget exceeded");
    this.name = "RequestBudgetExceededError";
    this.status = 429;
    this.retryAfter = Math.max(1, Number(retryAfterSeconds) || 1);
  }
}

export class RequestBudgetStorageError extends Error {
  constructor(cause) {
    super("request budget storage is unavailable", { cause });
    this.name = "RequestBudgetStorageError";
    this.status = 503;
  }
}

function headerValue(request, name) {
  const value = request?.headers?.get?.(name) ?? request?.headers?.[name];
  return Array.isArray(value) ? value[value.length - 1] : value;
}

function normalizedIp(value) {
  let candidate = String(value || "").split(",").at(-1)?.trim() || "";
  if (candidate.startsWith("[") && candidate.includes("]")) {
    candidate = candidate.slice(1, candidate.indexOf("]"));
  } else if (/^\d{1,3}(?:\.\d{1,3}){3}:\d+$/.test(candidate)) {
    candidate = candidate.slice(0, candidate.lastIndexOf(":"));
  }
  return isIP(candidate) ? candidate : "";
}

export function trustedClientAddress(request) {
  // Railway supplies x-real-ip. The other headers support the trusted edges used
  // by Vercel, Cloudflare, and local proxy tests. The socket is only a fallback.
  for (const name of ["x-real-ip", "x-vercel-forwarded-for", "cf-connecting-ip", "x-forwarded-for"]) {
    const address = normalizedIp(headerValue(request, name));
    if (address) return address;
  }
  return normalizedIp(request?.socket?.remoteAddress) || "unknown";
}

export async function consumeFixedWindowBudget({
  execute,
  prefix,
  buckets,
  now: _now = Date.now(),
}) {
  if (typeof execute !== "function") throw new TypeError("request budget executor is required");
  if (!KEY_PATTERN.test(String(prefix || ""))) throw new TypeError("request budget prefix is invalid");
  if (!Array.isArray(buckets) || buckets.length === 0) throw new TypeError("request budget buckets are required");

  const keys = [];
  const argumentsList = [];
  for (const bucket of buckets) {
    const key = String(bucket?.key || "");
    const limit = Number(bucket?.limit);
    const cost = Number(bucket?.cost ?? 1);
    const windowMs = Number(bucket?.windowMs ?? 60_000);
    if (!KEY_PATTERN.test(key)) throw new TypeError("request budget key is invalid");
    if (!Number.isSafeInteger(limit) || limit < 1) throw new TypeError("request budget limit is invalid");
    if (!Number.isSafeInteger(cost) || cost < 1 || cost > limit) throw new TypeError("request budget cost is invalid");
    if (!Number.isSafeInteger(windowMs) || windowMs < 1_000 || windowMs > 86_400_000) {
      throw new TypeError("request budget window is invalid");
    }
    // Keep one stable key whose expiry begins with the first request. A
    // wall-clock bucket can be crossed deliberately to receive two complete
    // budgets within milliseconds of a minute boundary.
    keys.push(`${prefix}:${key}`);
    argumentsList.push(String(cost), String(limit), String(windowMs));
  }

  let result;
  try {
    result = await execute(["EVAL", FIXED_WINDOW_SCRIPT, String(keys.length), ...keys, ...argumentsList]);
  } catch (error) {
    throw new RequestBudgetStorageError(error);
  }
  if (!Array.isArray(result) || result.length !== buckets.length + 2) {
    throw new RequestBudgetStorageError(new Error("request budget response is malformed"));
  }
  const allowed = Number(result[0]);
  const retryMs = Number(result[1]);
  const counts = result.slice(2).map(Number);
  if (![0, 1].includes(allowed) || !Number.isFinite(retryMs) || counts.some((count) => !Number.isFinite(count))) {
    throw new RequestBudgetStorageError(new Error("request budget response is malformed"));
  }
  if (!allowed) throw new RequestBudgetExceededError(Math.ceil(Math.max(1, retryMs) / 1_000));
  return Object.freeze({ allowed: true, counts: Object.freeze(counts) });
}

export function createMemoryBudgetExecutor() {
  const entries = new Map();
  return async (command) => {
    if (!Array.isArray(command) || command[0] !== "EVAL") throw new Error("unsupported memory budget command");
    const keyCount = Number(command[2]);
    const keys = command.slice(3, 3 + keyCount);
    const args = command.slice(3 + keyCount);
    const now = Date.now();
    let allowed = 1;
    let retryMs = 0;
    const counts = [];
    const candidates = [];
    for (let index = 0; index < keyCount; index += 1) {
      const cost = Number(args[index * 3]);
      const limit = Number(args[index * 3 + 1]);
      const ttl = Number(args[index * 3 + 2]);
      const key = keys[index];
      let entry = entries.get(key);
      if (!entry || entry.expiresAt <= now) entry = { count: 0, expiresAt: now + ttl };
      candidates.push({ key, entry, cost });
      counts.push(entry.count);
      if (entry.count + cost > limit) {
        allowed = 0;
        retryMs = Math.max(retryMs, entry.expiresAt - now);
      }
    }
    if (allowed) {
      counts.length = 0;
      for (const candidate of candidates) {
        candidate.entry.count += candidate.cost;
        entries.set(candidate.key, candidate.entry);
        counts.push(candidate.entry.count);
      }
    }
    if (entries.size > 10_000) {
      for (const [key, entry] of entries) if (entry.expiresAt <= now) entries.delete(key);
    }
    return [allowed, Math.max(0, retryMs), ...counts];
  };
}

export function retryAfterHeaders(error) {
  return error instanceof RequestBudgetExceededError
    ? { "retry-after": String(error.retryAfter), "cache-control": "no-store" }
    : { "cache-control": "no-store" };
}
