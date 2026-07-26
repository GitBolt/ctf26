import crypto from "node:crypto";
import { createClient } from "redis";

import { eventGeneration } from "@ctf26/leaderboard";
import { parseCredentialEntry } from "./credential-roster.mjs";

const PARTICIPANT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const DEFAULT_PREFIX = "ctf26:imprint:state:v2";
let sharedStorePromise;

function participantId(value) {
  const normalized = String(value || "").trim();
  if (!PARTICIPANT_ID_PATTERN.test(normalized)) {
    throw new Error("invalid IMPRINT participant ID");
  }
  return normalized;
}

function configuration(env) {
  const redisUrl = String(env.REDIS_URL || "").trim();
  if (env.NODE_ENV === "production" && !redisUrl) {
    throw new Error("REDIS_URL is required for IMPRINT state");
  }
  const prefix = String(
    env.IMPRINT_STATE_REDIS_PREFIX || DEFAULT_PREFIX
  ).trim();
  if (!/^[A-Za-z0-9:_-]{1,128}$/.test(prefix)) {
    throw new Error("IMPRINT_STATE_REDIS_PREFIX is invalid");
  }
  return Object.freeze({
    generation: eventGeneration(env),
    prefix,
    redisUrl,
  });
}

function memoryStore(config) {
  const credentials = new Map();
  const credentialOwners = new Map();
  const publicKeyOwners = new Map();
  const leases = new Map();
  return Object.freeze({
    mode: "memory",
    async credentialForParticipant(value) {
      const record = credentials.get(participantId(value));
      return record ? parseCredentialEntry(record, value) : null;
    },
    async saveCredential(value, record) {
      const id = participantId(value);
      const parsed = parseCredentialEntry(record, id);
      const existing = credentials.get(id);
      if (existing) return parseCredentialEntry(existing, id);
      if (credentialOwners.has(parsed.credentialId)) {
        throw new Error(
          "this passkey is already assigned to another participant"
        );
      }
      const publicKeyHex = parsed.passkeyPubkey.toString("hex");
      if (publicKeyOwners.has(publicKeyHex)) {
        throw new Error(
          "this passkey is already assigned to another participant"
        );
      }
      credentials.set(id, record);
      credentialOwners.set(parsed.credentialId, id);
      publicKeyOwners.set(publicKeyHex, id);
      return parsed;
    },
    async withLease(name, value, task) {
      const key = `${name}:${participantId(value)}`;
      if (leases.has(key))
        throw new Error("IMPRINT provisioning is already in progress");
      leases.set(key, true);
      try {
        return await task();
      } finally {
        leases.delete(key);
      }
    },
    async health() {
      return true;
    },
    async close() {},
  });
}

async function redisStore(config, suppliedRedis) {
  const redis = suppliedRedis || createClient({ url: config.redisUrl });
  if (!suppliedRedis) {
    redis.on("error", (error) =>
      console.error("IMPRINT state Redis", error.message)
    );
    await redis.connect();
  }
  const key = (...parts) =>
    [config.prefix, config.generation, ...parts].join(":");

  return Object.freeze({
    mode: "redis",
    async credentialForParticipant(value) {
      const id = participantId(value);
      const raw = await redis.get(key("credential", id));
      if (!raw) return null;
      return parseCredentialEntry(JSON.parse(raw), id);
    },
    async saveCredential(value, record) {
      const id = participantId(value);
      const parsed = parseCredentialEntry(record, id);
      const publicKeyHex = parsed.passkeyPubkey.toString("hex");
      const script = [
        "local current=redis.call('GET',KEYS[1])",
        "if current then return current end",
        "local credentialOwner=redis.call('GET',KEYS[2])",
        "if credentialOwner and credentialOwner~=ARGV[1] then return 'credential-conflict' end",
        "local keyOwner=redis.call('GET',KEYS[3])",
        "if keyOwner and keyOwner~=ARGV[1] then return 'public-key-conflict' end",
        "redis.call('SET',KEYS[1],ARGV[2])",
        "redis.call('SET',KEYS[2],ARGV[1])",
        "redis.call('SET',KEYS[3],ARGV[1])",
        "return ARGV[2]",
      ].join("\n");
      const stored = await redis.eval(script, {
        keys: [
          key("credential", id),
          key("credential-owner", parsed.credentialId),
          key("public-key-owner", publicKeyHex),
        ],
        arguments: [id, JSON.stringify(record)],
      });
      if (
        stored === "credential-conflict" ||
        stored === "public-key-conflict"
      ) {
        throw new Error(
          "this passkey is already assigned to another participant"
        );
      }
      return parseCredentialEntry(JSON.parse(stored), id);
    },
    async withLease(name, value, task) {
      const id = participantId(value);
      const leaseKey = key("lease", name, id);
      const token = crypto.randomUUID();
      if ((await redis.set(leaseKey, token, { NX: true, EX: 120 })) !== "OK") {
        throw new Error("IMPRINT provisioning is already in progress");
      }
      try {
        return await task();
      } finally {
        await redis
          .eval(
            "if redis.call('GET',KEYS[1])==ARGV[1] then return redis.call('DEL',KEYS[1]) else return 0 end",
            { keys: [leaseKey], arguments: [token] }
          )
          .catch(() => {});
      }
    },
    async health() {
      return String(await redis.ping()).toUpperCase() === "PONG";
    },
    async close() {
      if (!suppliedRedis && redis.isOpen) await redis.quit();
    },
  });
}

export async function createImprintStateStore(env = process.env, options = {}) {
  const config = configuration(env);
  if (!config.redisUrl && !options.redis) return memoryStore(config);
  return redisStore(config, options.redis);
}

export function imprintStateStore(env = process.env) {
  if (env !== process.env) return createImprintStateStore(env);
  sharedStorePromise ||= createImprintStateStore(env);
  return sharedStorePromise;
}
