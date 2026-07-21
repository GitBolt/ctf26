import crypto from "node:crypto";
import assert from "node:assert/strict";
import test from "node:test";

import { CHALLENGES } from "../app/lib/challenges.mjs";
import { cachedPortalHealth, portalHealth } from "../app/lib/health.mjs";
import { participantIdForEmail } from "../app/lib/registration.mjs";

const REWARD_CONFIG_HASH = "a".repeat(64);

function healthyEnv() {
  const env = {
    NODE_ENV: "production",
    ALLOW_OPEN_REGISTRATION: "true",
    LEADERBOARD_SCORING_MODE: "staging",
    ALLOW_STAGING_SCORING: "true",
    LEADERBOARD_EVENT_GENERATION: "event-a",
    REWARD_SNIPER_EVENT_ID: "reward-event-a",
    REWARD_SNIPER_SCORING_CONFIG_HASH: REWARD_CONFIG_HASH,
    CENTRAL_SESSION_SECRET: "session-secret-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
    PARTICIPANT_ID_SECRET: "participant-secret-xxxxxxxxxxxxxxxxxxxxxxxxxxxx",
    GOOGLE_CLIENT_ID: "client.apps.googleusercontent.com",
    GOOGLE_CLIENT_SECRET: "google-client-secret-xxxxxxxxxxxxxxxx",
    CENTRAL_BASE_URL: "https://portal.example",
    REWARD_SNIPER_ADMIN_URL: "https://reward-admin.example",
    REWARD_SNIPER_ADMIN_KEY: "reward-admin-key-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
    CTF_ADMIN_EMAILS: "owner@example.test,reviewer@example.test",
    REDIS_URL: "redis://redis.example:6379",
  };
  for (const challenge of CHALLENGES) {
    env[challenge.urlEnv] = `https://${challenge.key}.example`;
    env[`CHALLENGE_TICKET_SECRET_${challenge.audience.replaceAll("-", "_").toUpperCase()}`] = `ticket-${challenge.key}-${"x".repeat(40)}`;
  }
  return env;
}

function healthyFetch(calls = [], options = {}) {
  const participantIds = options.participantIds || [];
  const fieldSize = options.fieldSize || 50;
  const eventStartsAt = options.eventStartsAt || "2026-07-20T00:00:00.000Z";
  const eventEndsAt = options.eventEndsAt || "2026-07-30T00:00:00.000Z";
  return async (input, options = {}) => {
    const url = new URL(input);
    calls.push({ url, options });
    if (url.hostname === "reward-admin.example" && url.pathname === "/api/admin/integrity") {
      return Response.json({ event: {
        eventId: "reward-event-a",
        eventGeneration: "event-a",
        scoringConfigHash: REWARD_CONFIG_HASH,
      }, cases: [] });
    }
    if (url.pathname === "/api/scoreboard") {
      return Response.json(participantIds.map((participantId) => ({ participantId, score: 0 })), { headers: {
        "x-reward-event-id": "reward-event-a",
        "x-reward-event-generation": "event-a",
        "x-reward-event-stage": "live",
        "x-reward-scoring-config": REWARD_CONFIG_HASH,
        "x-reward-event-start-at": eventStartsAt,
        "x-reward-event-end-at": eventEndsAt,
      } });
    }
    if (url.pathname === "/api/completion") {
      return Response.json({ completed: false, eventGeneration: "event-a" });
    }
    if (url.pathname === "/api/health" || url.pathname === "/health") {
      return Response.json({
        ok: true,
        ...(url.hostname === "reward-sniper.example" ? {
          eventId: "reward-event-a",
          eventGeneration: "event-a",
          scoringConfigHash: REWARD_CONFIG_HASH,
          eventStartsAt,
          eventEndsAt,
        } : {}),
        ...(url.hostname === "imprint.example" ? { eventGeneration: "event-a", participantCount: fieldSize } : {}),
        ...(url.hostname === "signet.example" ? {
          targetInventory: {
            count: fieldSize,
            participantIdsSha256: crypto.createHash("sha256").update(JSON.stringify([...participantIds].sort())).digest("hex"),
          },
        } : {}),
        ...(["after-hours.example", "player-two.example", "second-key.example"].includes(url.hostname)
          ? { capacity: { expectedParticipants: fieldSize } }
          : {}),
        ...(url.hostname === "evidence-room.example" ? { chain: { expectedParticipants: fieldSize } } : {}),
      });
    }
    return Response.json({ error: "unexpected readiness probe" }, { status: 404 });
  };
}

function officialEnv() {
  const env = healthyEnv();
  const emails = ["one@example.test", "two@example.test"];
  env.ALLOW_OPEN_REGISTRATION = "false";
  env.PARTICIPANT_ROSTER_JSON = JSON.stringify(emails.map((email, index) => ({ email, displayName: `Player ${index + 1}` })));
  env.LEADERBOARD_FIELD_SIZE = "2";
  env.LEADERBOARD_REGISTERED_COUNT = "2";
  env.LEADERBOARD_SCORING_MODE = "live";
  env.LEADERBOARD_PRIZE_POOL_USD = "4000";
  env.LEADERBOARD_MIN_INDIVIDUAL_AWARD_USD = "10";
  env.LEADERBOARD_SCORING_START_AT = "2026-07-20T00:00:00.000Z";
  env.LEADERBOARD_SCORING_END_AT = "2026-07-30T00:00:00.000Z";
  env.LEADERBOARD_CHECKED_IN_PARTICIPANT_IDS = JSON.stringify(emails.map((email) => participantIdForEmail(email, env)).sort());
  return env;
}

test("portal health covers every challenge and shared launch dependency", async () => {
  const commands = [];
  const calls = [];
  const health = await portalHealth({
    env: healthyEnv(),
    redisCommand: async (command) => { commands.push(command); return "PONG"; },
    fetchImpl: healthyFetch(calls),
  });
  assert.deepEqual(health, {
    ok: true,
    challenges: 10,
    registration: "open-staging",
    storage: "redis",
    scoring: "staging",
    checkedInParticipants: 0,
    organizers: { count: 2, required: 2, ready: true },
    dependencies: {
      health: 10,
      completions: 8,
      rewardScoreboard: "ready",
      rewardIntegrity: "ready",
    },
  });
  assert.deepEqual(commands, [["PING"]]);
  assert.equal(calls.filter(({ url }) => url.pathname === "/api/health" || url.pathname === "/health").length, 10);
  assert.equal(calls.filter(({ url }) => url.pathname === "/api/completion").length, 8);
  assert.equal(calls.every(({ options }) => options.signal instanceof AbortSignal), true);
  const completionCalls = calls.filter(({ url }) => url.pathname === "/api/completion");
  assert.equal(completionCalls.every(({ url }) => url.searchParams.get("participantId") === "portal-readiness"), true);
  assert.equal(completionCalls.every(({ options }) => /^Bearer .{32,}$/.test(options.headers.authorization)), true);
  const integrityCall = calls.find(({ url }) => url.pathname === "/api/admin/integrity");
  assert.match(integrityCall.options.headers.authorization, /^Bearer .{32,}$/);
});

test("portal readiness coalesces concurrent probes and reuses the short cache", async () => {
  const calls = [];
  const cache = { value: null, expiresAt: 0, inFlight: null };
  const options = {
    env: healthyEnv(),
    cache,
    redisCommand: async () => "PONG",
    fetchImpl: healthyFetch(calls),
  };
  const [first, second] = await Promise.all([
    cachedPortalHealth(options),
    cachedPortalHealth(options),
  ]);
  const third = await cachedPortalHealth(options);
  assert.equal(first, second);
  assert.equal(second, third);
  assert.equal(calls.length, 20);
});

test("official readiness requires two distinct configured organizers", async () => {
  const env = officialEnv();
  env.CTF_ADMIN_EMAILS = "owner@example.test";
  await assert.rejects(() => portalHealth({
    env,
    redisCommand: async () => "PONG",
    fetchImpl: healthyFetch(),
  }), /official readiness requires at least two/);
});

test("official readiness binds every funded inventory to the checked-in field", async () => {
  const env = officialEnv();
  const participantIds = JSON.parse(env.LEADERBOARD_CHECKED_IN_PARTICIPANT_IDS);
  const baseFetch = healthyFetch([], { participantIds, fieldSize: 2 });
  await assert.rejects(() => portalHealth({
    env,
    redisCommand: async () => "PONG",
    fetchImpl: async (input, options) => {
      const url = new URL(input);
      if (url.hostname === "after-hours.example" && url.pathname === "/health") {
        return Response.json({ ok: true, capacity: { expectedParticipants: 1 } });
      }
      return baseFetch(input, options);
    },
  }), /AFTER HOURS capacity does not cover/);
});

test("official readiness requires Reward Sniper to contain the same individual field", async () => {
  const env = officialEnv();
  await assert.rejects(() => portalHealth({
    env,
    redisCommand: async () => "PONG",
    fetchImpl: healthyFetch([], { participantIds: ["someone-else"], fieldSize: 2 }),
  }), /Reward Sniper scoreboard does not match/);
});

test("official readiness requires the exact SIGNET target inventory", async () => {
  const env = officialEnv();
  const participantIds = JSON.parse(env.LEADERBOARD_CHECKED_IN_PARTICIPANT_IDS);
  const baseFetch = healthyFetch([], { participantIds, fieldSize: 2 });
  await assert.rejects(() => portalHealth({
    env,
    redisCommand: async () => "PONG",
    fetchImpl: async (input, options) => {
      const url = new URL(input);
      if (url.hostname === "signet.example" && url.pathname === "/api/health") {
        return Response.json({
          ok: true,
          targetInventory: { count: 2, participantIdsSha256: "f".repeat(64) },
        });
      }
      return baseFetch(input, options);
    },
  }), /SIGNET target inventory does not match/);
});

test("official readiness binds Reward Sniper to the canonical scoring window", async () => {
  const env = officialEnv();
  const participantIds = JSON.parse(env.LEADERBOARD_CHECKED_IN_PARTICIPANT_IDS);
  await assert.rejects(() => portalHealth({
    env,
    redisCommand: async () => "PONG",
    fetchImpl: healthyFetch([], {
      participantIds,
      fieldSize: 2,
      eventEndsAt: "2026-07-30T00:00:01.000Z",
    }),
  }), /Reward Sniper scoreboard ends on another event schedule/);
});

test("portal health fails closed for an empty challenge ticket secret", async () => {
  const env = healthyEnv();
  env.CHALLENGE_TICKET_SECRET_EVIDENCE_ROOM = "";
  await assert.rejects(() => portalHealth({ env, redisCommand: async () => "PONG", fetchImpl: healthyFetch() }), /EVIDENCE_ROOM is not configured/);
});

test("portal health fails closed when production registration is accidentally open by omission", async () => {
  const env = healthyEnv();
  delete env.ALLOW_OPEN_REGISTRATION;
  await assert.rejects(() => portalHealth({ env, redisCommand: async () => "PONG", fetchImpl: healthyFetch() }), /registration is closed/);
});

test("portal health fails when Redis is unavailable", async () => {
  await assert.rejects(() => portalHealth({ env: healthyEnv(), redisCommand: async () => { throw new Error("offline"); }, fetchImpl: healthyFetch() }), /offline/);
});

test("portal health fails closed when a challenge dependency is unavailable", async () => {
  const baseFetch = healthyFetch();
  await assert.rejects(() => portalHealth({
    env: healthyEnv(),
    redisCommand: async () => "PONG",
    fetchImpl: async (input, options) => {
      const url = new URL(input);
      if (url.hostname === "drift.example" && url.pathname === "/health") {
        return Response.json({ ok: false }, { status: 503 });
      }
      return baseFetch(input, options);
    },
  }), /DRIFT health returned 503/);
});

test("portal health rejects stale challenge and Reward event dependencies", async () => {
  const baseFetch = healthyFetch();
  await assert.rejects(() => portalHealth({
    env: healthyEnv(),
    redisCommand: async () => "PONG",
    fetchImpl: async (input, options) => {
      const url = new URL(input);
      if (url.hostname === "second-key.example" && url.pathname === "/api/completion") {
        return Response.json({ completed: false, eventGeneration: "old-event" });
      }
      return baseFetch(input, options);
    },
  }), /SECOND KEY completion belongs to another event generation/);
});
