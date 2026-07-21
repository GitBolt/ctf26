import crypto from "node:crypto";

import { ALL_CHALLENGE_KEYS, BINARY_CHALLENGE_KEYS } from "@ctf26/leaderboard";

import { LeaderboardStorageError, leaderboardRedisCommand } from "./leaderboard-redis.mjs";

const KEY_PREFIX = "ctf26:leaderboard:v2";
const CHALLENGE_KEYS = new Set(ALL_CHALLENGE_KEYS);
const PARTICIPANT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const LIFECYCLE_PHASES = Object.freeze(["staging", "live", "recovery", "freezing", "frozen"]);

function pairs(value) {
  if (!value) return [];
  if (!Array.isArray(value) && typeof value === "object") return Object.entries(value);
  if (!Array.isArray(value) || value.length % 2 !== 0) {
    throw new LeaderboardStorageError("Redis hash response is malformed");
  }
  const entries = [];
  for (let index = 0; index < value.length; index += 2) entries.push([value[index], value[index + 1]]);
  return entries;
}

function parseRecords(value) {
  return pairs(value).map(([, encoded]) => {
    try {
      const parsed = JSON.parse(String(encoded));
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
      return parsed;
    } catch {
      throw new LeaderboardStorageError("Stored leaderboard record is malformed");
    }
  });
}

function parseSnapshot(value) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(String(value));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || !Array.isArray(parsed.rows)) {
      throw new Error("not a leaderboard snapshot");
    }
    return parsed;
  } catch {
    throw new LeaderboardStorageError("Stored public leaderboard snapshot is malformed");
  }
}

function parseLifecycle(value) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(String(value));
    if (
      !parsed
      || typeof parsed !== "object"
      || Array.isArray(parsed)
      || !LIFECYCLE_PHASES.includes(parsed.phase)
      || typeof parsed.launchPaused !== "boolean"
      || !/^[0-9a-f]{64}$/.test(String(parsed.configHash || ""))
      || !Number.isSafeInteger(parsed.revision)
      || parsed.revision < 0
    ) {
      throw new Error("invalid lifecycle");
    }
    return Object.freeze(parsed);
  } catch {
    throw new LeaderboardStorageError("Stored event lifecycle is malformed");
  }
}

function parseEligibilityLedger(value) {
  if (!Array.isArray(value) || value.length < 2) {
    throw new LeaderboardStorageError("Stored eligibility ledger is malformed");
  }
  const revision = Number(value[0]);
  if (!Number.isSafeInteger(revision) || revision < 0) {
    throw new LeaderboardStorageError("Stored eligibility revision is malformed");
  }
  let freeze = null;
  let decisions;
  try {
    freeze = value[1] ? JSON.parse(String(value[1])) : null;
    decisions = value.slice(2).map((encoded) => JSON.parse(String(encoded)));
  } catch {
    throw new LeaderboardStorageError("Stored eligibility ledger is malformed");
  }
  if (
    (freeze !== null && (!freeze || typeof freeze !== "object" || Array.isArray(freeze)))
    || !Array.isArray(decisions)
    || decisions.some((decision) => !decision || typeof decision !== "object" || Array.isArray(decision))
  ) {
    throw new LeaderboardStorageError("Stored eligibility ledger is malformed");
  }
  return Object.freeze({
    revision,
    frozen: freeze !== null,
    freeze: freeze ? Object.freeze(freeze) : null,
    decisions: Object.freeze(decisions),
  });
}

function parseScriptResult(result, messages, fallback) {
  const [code, encoded] = Array.isArray(result) ? result : [];
  if (code !== "ok" && code !== "existing") {
    throw new LeaderboardStorageError(messages[code] || fallback);
  }
  try {
    return JSON.parse(String(encoded));
  } catch {
    throw new LeaderboardStorageError(`${fallback}: Redis returned malformed data`);
  }
}

export function createLeaderboardStore(options = {}) {
  const command = options.command || ((parts) => leaderboardRedisCommand(parts, options));
  const env = options.env || process.env;
  const generation = String(env.LEADERBOARD_EVENT_GENERATION || "").trim();
  if (generation && !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(generation)) {
    throw new Error("LEADERBOARD_EVENT_GENERATION is invalid");
  }
  const prefix = generation ? `${KEY_PREFIX}:${generation}` : KEY_PREFIX;
  const key = (suffix) => `${prefix}:${suffix}`;
  // Redis owns the eligibility freeze. Keeping this check at the storage
  // boundary allows organizers to resolve a stable case set after integrity
  // intake closes but before the final eligibility snapshot is acquired.
  const assertEligibilityLifecycleWritable = () => {};
  const readEligibilityLedger = async () => {
    const script = [
      "local result={redis.call('GET',KEYS[2]) or '0',redis.call('GET',KEYS[3]) or ''};",
      "for _,raw in ipairs(redis.call('HVALS',KEYS[1])) do table.insert(result,raw) end;",
      "return result;",
    ].join(" ");
    return parseEligibilityLedger(await command([
      "EVAL", script, "3",
      key("eligibility-decisions"), key("eligibility-revision"), key("eligibility-freeze"),
    ]));
  };

  return Object.freeze({
    async assertEventConfig(configHash) {
      if (!/^[0-9a-f]{64}$/.test(String(configHash || ""))) throw new Error("leaderboard config hash is invalid");
      await command(["SET", key("event-config-hash"), configHash, "NX"]);
      const stored = String((await command(["GET", key("event-config-hash")])) || "");
      if (stored !== configHash) {
        throw new LeaderboardStorageError("Leaderboard event configuration changed after initialization");
      }
      return stored;
    },

    async assertFastSolveConfig(seconds) {
      if (!Number.isSafeInteger(seconds) || seconds < 60 || seconds > 3_600) {
        throw new Error("fast-solve review threshold is invalid");
      }
      await command(["SET", key("fast-solve-review-seconds"), String(seconds), "NX"]);
      const stored = Number(await command(["GET", key("fast-solve-review-seconds")]));
      if (stored !== seconds) {
        throw new LeaderboardStorageError("Fast-solve review threshold changed after event initialization");
      }
      return stored;
    },

    async initializeEventLifecycle(metadata = {}) {
      const phase = String(metadata.phase || "");
      const configHash = String(metadata.configHash || "");
      const organizer = String(metadata.organizer || "system").trim().toLowerCase();
      if (!LIFECYCLE_PHASES.includes(phase)) throw new Error("event lifecycle phase is invalid");
      if (!/^[0-9a-f]{64}$/.test(configHash)) throw new Error("leaderboard config hash is invalid");
      const lifecycle = {
        phase,
        launchPaused: Boolean(metadata.launchPaused),
        official: phase !== "staging",
        configHash,
        revision: 0,
        updatedBy: organizer || "system",
        updatedAt: new Date().toISOString(),
      };
      await command(["SET", key("event-lifecycle"), JSON.stringify(lifecycle), "NX"]);
      const stored = parseLifecycle(await command(["GET", key("event-lifecycle")]));
      if (!stored || stored.configHash !== configHash) {
        throw new LeaderboardStorageError("Event lifecycle belongs to another immutable configuration");
      }
      return stored;
    },

    async eventLifecycle() {
      return parseLifecycle(await command(["GET", key("event-lifecycle")]));
    },

    async advanceEventLifecycle({ phase, configHash, organizer }) {
      const target = String(phase || "");
      const expectedHash = String(configHash || "");
      const actor = String(organizer || "").trim().toLowerCase();
      if (!LIFECYCLE_PHASES.includes(target) || target === "staging") throw new Error("event lifecycle target is invalid");
      if (!/^[0-9a-f]{64}$/.test(expectedHash)) throw new Error("leaderboard config hash is invalid");
      if (!actor) throw new Error("organizer identity is required");
      const script = [
        "local raw=redis.call('GET',KEYS[1]); if not raw then return {'missing'} end;",
        "local l=cjson.decode(raw); if l.configHash~=ARGV[2] then return {'mismatch'} end;",
        "local rank={staging=1,live=2,recovery=3,freezing=4,frozen=5};",
        "if l.phase==ARGV[1] then return {'existing',raw} end;",
        "if not rank[l.phase] or rank[ARGV[1]]~=rank[l.phase]+1 then return {'invalid-transition'} end;",
        "l.phase=ARGV[1]; l.official=true; l.launchPaused=(ARGV[1]~='live'); l.revision=(tonumber(l.revision) or 0)+1; l.updatedBy=ARGV[3]; l.updatedAt=ARGV[4];",
        "local encoded=cjson.encode(l); redis.call('SET',KEYS[1],encoded); redis.call('DEL',KEYS[2]); if ARGV[1]~='freezing' then redis.call('DEL',KEYS[3]) end; return {'ok',encoded};",
      ].join(" ");
      return Object.freeze(parseScriptResult(await command([
        "EVAL", script, "3",
        key("event-lifecycle"), key("public-snapshot:fresh"), key("public-snapshot:latest"),
        target, expectedHash, actor, new Date().toISOString(),
      ]), {
        missing: "event lifecycle has not been initialized",
        mismatch: "event lifecycle belongs to another immutable configuration",
        "invalid-transition": "event lifecycle can only advance one phase at a time",
      }, "event lifecycle could not advance"));
    },

    async setEventLaunchPaused({ paused, configHash, organizer }) {
      const expectedHash = String(configHash || "");
      const actor = String(organizer || "").trim().toLowerCase();
      if (typeof paused !== "boolean") throw new Error("launch pause must be true or false");
      if (!/^[0-9a-f]{64}$/.test(expectedHash)) throw new Error("leaderboard config hash is invalid");
      if (!actor) throw new Error("organizer identity is required");
      const script = [
        "local raw=redis.call('GET',KEYS[1]); if not raw then return {'missing'} end;",
        "local l=cjson.decode(raw); if l.configHash~=ARGV[2] then return {'mismatch'} end;",
        "if l.phase~='staging' and l.phase~='live' then return {'closed'} end;",
        "local requested=(ARGV[1]=='1'); if l.launchPaused==requested then return {'existing',raw} end;",
        "l.launchPaused=requested; l.revision=(tonumber(l.revision) or 0)+1; l.updatedBy=ARGV[3]; l.updatedAt=ARGV[4];",
        "local encoded=cjson.encode(l); redis.call('SET',KEYS[1],encoded); return {'ok',encoded};",
      ].join(" ");
      return Object.freeze(parseScriptResult(await command([
        "EVAL", script, "1", key("event-lifecycle"),
        paused ? "1" : "0", expectedHash, actor, new Date().toISOString(),
      ]), {
        missing: "event lifecycle has not been initialized",
        mismatch: "event lifecycle belongs to another immutable configuration",
        closed: "new challenge sessions are already closed for this phase",
      }, "launch pause could not be updated"));
    },

    async recordChallengeLaunch({ participantId, challenge, email = "", launchedAt = new Date().toISOString() }) {
      const identity = String(participantId || "");
      if (!PARTICIPANT_ID_PATTERN.test(identity)) throw new Error("invalid participant ID");
      if (!CHALLENGE_KEYS.has(challenge)) throw new Error("invalid challenge launch");
      const timestamp = new Date(launchedAt);
      if (Number.isNaN(timestamp.valueOf())) throw new Error("invalid challenge launch time");
      const normalizedEmail = String(email || "").trim().toLowerCase().slice(0, 254);
      const launch = Object.freeze({
        participantId: identity,
        challenge,
        email: normalizedEmail,
        launchedAt: timestamp.toISOString(),
      });
      const launchKey = key(`challenge-launches:${challenge}`);
      const created = Number(await command([
        "HSETNX",
        launchKey,
        identity,
        JSON.stringify(launch),
      ])) === 1;
      if (created) return launch;
      const encoded = await command(["HGET", launchKey, identity]);
      try {
        const existing = JSON.parse(String(encoded || ""));
        if (
          existing?.participantId !== identity
          || existing?.challenge !== challenge
          || Number.isNaN(new Date(existing?.launchedAt).valueOf())
        ) {
          throw new Error("invalid launch");
        }
        return Object.freeze(existing);
      } catch {
        throw new LeaderboardStorageError("Stored challenge launch is malformed");
      }
    },

    async challengeLaunch(challenge, participantId) {
      const identity = String(participantId || "");
      if (!PARTICIPANT_ID_PATTERN.test(identity)) throw new Error("invalid participant ID");
      if (!CHALLENGE_KEYS.has(challenge)) throw new Error("invalid challenge launch");
      const encoded = await command(["HGET", key(`challenge-launches:${challenge}`), identity]);
      if (!encoded) return null;
      try {
        const launch = JSON.parse(String(encoded));
        if (
          launch?.participantId !== identity
          || launch?.challenge !== challenge
          || Number.isNaN(new Date(launch?.launchedAt).valueOf())
        ) {
          throw new Error("invalid launch");
        }
        return Object.freeze(launch);
      } catch {
        throw new LeaderboardStorageError("Stored challenge launch is malformed");
      }
    },

    async completionRecoveryReady(challenge, participantId) {
      const identity = String(participantId || "");
      if (!PARTICIPANT_ID_PATTERN.test(identity)) throw new Error("invalid participant ID");
      if (!CHALLENGE_KEYS.has(challenge)) throw new Error("invalid completion challenge");
      return !(await command(["GET", key(`completion-backoff:${challenge}:${identity}`)]));
    },

    async deferCompletionRecovery(challenge, participantId, seconds = 30) {
      const identity = String(participantId || "");
      if (!PARTICIPANT_ID_PATTERN.test(identity)) throw new Error("invalid participant ID");
      if (!CHALLENGE_KEYS.has(challenge)) throw new Error("invalid completion challenge");
      if (!Number.isSafeInteger(seconds) || seconds < 5 || seconds > 300) {
        throw new Error("completion recovery backoff must be between 5 and 300 seconds");
      }
      await command(["SET", key(`completion-backoff:${challenge}:${identity}`), "1", "EX", String(seconds)]);
    },

    async clearCompletionRecoveryBackoff(challenge, participantId) {
      const identity = String(participantId || "");
      if (!PARTICIPANT_ID_PATTERN.test(identity)) throw new Error("invalid participant ID");
      if (!CHALLENGE_KEYS.has(challenge)) throw new Error("invalid completion challenge");
      await command(["DEL", key(`completion-backoff:${challenge}:${identity}`)]);
    },

    async recordFastSolveReview(candidate) {
      const participantId = String(candidate?.participantId || "");
      const challenge = String(candidate?.challenge || "");
      if (!PARTICIPANT_ID_PATTERN.test(participantId)) throw new Error("invalid participant ID");
      if (!CHALLENGE_KEYS.has(challenge)) throw new Error("invalid fast-solve challenge");
      const review = Object.freeze({
        ...candidate,
        participantId,
        challenge,
        eventGeneration: generation || "rehearsal",
        deliveryStatus: "pending",
        recordedAt: new Date().toISOString(),
        deliveredAt: null,
        caseId: null,
      });
      const field = `${challenge}:${participantId}`;
      const reviewKey = key("integrity-fast-solves");
      const result = Number(await command([
        "EVAL",
        "if redis.call('EXISTS',KEYS[1])==1 or redis.call('EXISTS',KEYS[2])==1 or redis.call('EXISTS',KEYS[3])==1 then return -1 end; return redis.call('HSETNX',KEYS[4],ARGV[1],ARGV[2])",
        "4",
        key("finalization-lock"),
        key("eligibility-freeze"),
        key("public-snapshot:final"),
        reviewKey,
        field,
        JSON.stringify(review),
      ]));
      if (result === -1) throw new LeaderboardStorageError("integrity review intake is frozen");
      const created = result === 1;
      if (created) return review;
      const encoded = await command(["HGET", reviewKey, field]);
      try {
        const existing = JSON.parse(String(encoded || ""));
        if (existing?.challenge !== challenge || existing?.participantId !== participantId) {
          throw new Error("invalid review");
        }
        return Object.freeze(existing);
      } catch {
        throw new LeaderboardStorageError("Stored fast-solve review is malformed");
      }
    },

    async markFastSolveReviewDelivered(challenge, participantId, caseId) {
      const identity = String(participantId || "");
      if (!PARTICIPANT_ID_PATTERN.test(identity)) throw new Error("invalid participant ID");
      if (!CHALLENGE_KEYS.has(challenge)) throw new Error("invalid fast-solve challenge");
      if (!/^rsic_[A-Za-z0-9_-]{8,64}$/.test(String(caseId || ""))) throw new Error("invalid integrity case ID");
      const field = `${challenge}:${identity}`;
      const result = await command([
        "EVAL",
        "local raw=redis.call('HGET',KEYS[1],ARGV[1]); if not raw then return nil end; local r=cjson.decode(raw); r.deliveryStatus='delivered'; r.caseId=ARGV[2]; r.deliveredAt=ARGV[3]; local encoded=cjson.encode(r); redis.call('HSET',KEYS[1],ARGV[1],encoded); return encoded",
        "1",
        key("integrity-fast-solves"),
        field,
        String(caseId),
        new Date().toISOString(),
      ]);
      if (!result) throw new LeaderboardStorageError("Fast-solve review was not found");
      try {
        return Object.freeze(JSON.parse(String(result)));
      } catch {
        throw new LeaderboardStorageError("Stored fast-solve review is malformed");
      }
    },

    async fastSolveReviews() {
      return parseRecords(await command(["HGETALL", key("integrity-fast-solves")]));
    },

    async recordSolve(event) {
      const result = await command([
        "EVAL",
        "if redis.call('EXISTS',KEYS[1])==1 or redis.call('EXISTS',KEYS[2])==1 or redis.call('EXISTS',KEYS[3])==1 then return -1 end; return redis.call('HSETNX',KEYS[4],ARGV[1],ARGV[2])",
        "4",
        key("finalization-lock"),
        key("eligibility-freeze"),
        key("public-snapshot:final"),
        key(`solves:${event.challenge}`),
        event.participantId,
        JSON.stringify(event),
      ]);
      if (Number(result) === -1) throw new LeaderboardStorageError("score ingest is frozen");
      if (Number(result) === 1) await command(["DEL", key("public-snapshot:fresh")]);
      return Number(result) === 1;
    },

    async upsertProfile(user) {
      const participantId = String(user?.participant_id || "");
      if (!PARTICIPANT_ID_PATTERN.test(participantId)) throw new Error("invalid participant ID");
      const displayName = String(user?.leaderboard_name || participantId).trim().slice(0, 80) || participantId;
      const profile = {
        participantId,
        displayName,
        updatedAt: new Date().toISOString(),
      };
      await command(["HSET", key("profiles"), participantId, JSON.stringify(profile)]);
      await command(["DEL", key("public-snapshot:fresh")]);
      return profile;
    },

    async profiles() {
      return parseRecords(await command(["HGETALL", key("profiles")]));
    },

    async recordRulesAcknowledgment(user, rulesVersion) {
      const participantId = String(user?.participant_id || "");
      if (!PARTICIPANT_ID_PATTERN.test(participantId)) throw new Error("invalid participant ID");
      const record = {
        participantId,
        rulesVersion: String(rulesVersion),
        acknowledgedAt: new Date().toISOString(),
      };
      await command(["HSET", key("rules-acknowledgments"), participantId, JSON.stringify(record)]);
      return record;
    },

    async rulesAcknowledgments() {
      return parseRecords(await command(["HGETALL", key("rules-acknowledgments")]));
    },

    async proposeEligibilityDecision({ participantId, status, reason, organizer }) {
      assertEligibilityLifecycleWritable();
      if (!PARTICIPANT_ID_PATTERN.test(String(participantId || ""))) throw new Error("invalid participant ID");
      if (!new Set(["eligible", "held", "disqualified"]).has(status)) throw new Error("invalid eligibility status");
      const normalizedReason = String(reason || "").trim();
      if (normalizedReason.length < 8 || normalizedReason.length > 500) throw new Error("eligibility reason must contain 8 to 500 characters");
      const proposer = String(organizer || "").trim().toLowerCase();
      if (!proposer.includes("@")) throw new Error("invalid organizer identity");
      const proposal = {
        id: `elig_${crypto.randomUUID().replaceAll("-", "")}`,
        participantId: String(participantId),
        status,
        reason: normalizedReason,
        proposer,
        proposedAt: new Date().toISOString(),
        state: "proposed",
      };
      const script = [
        "if redis.call('EXISTS',KEYS[1])==1 then return {'frozen'} end; if redis.call('EXISTS',KEYS[6])==1 then return {'finalizing'} end;",
        "if redis.call('HSETNX',KEYS[2],ARGV[1],ARGV[2])~=1 then return {'duplicate'} end;",
        "redis.call('INCR',KEYS[3]); redis.call('DEL',KEYS[4]); redis.call('DEL',KEYS[5]);",
        "return {'ok',ARGV[2]};",
      ].join(" ");
      const result = await command([
        "EVAL", script, "6",
        key("eligibility-freeze"), key("eligibility-proposals"), key("eligibility-revision"), key("public-snapshot:fresh"), key("public-snapshot:latest"), key("finalization-lock"),
        proposal.id, JSON.stringify(proposal),
      ]);
      parseScriptResult(result, {
        frozen: "eligibility ledger is frozen",
        finalizing: "final leaderboard sealing is in progress",
        duplicate: "eligibility proposal could not be recorded",
      }, "eligibility proposal could not be recorded");
      return proposal;
    },

    async approveEligibilityDecision(proposalId, organizer) {
      assertEligibilityLifecycleWritable();
      if (!/^elig_[0-9a-f]{32}$/.test(String(proposalId || ""))) throw new Error("invalid eligibility proposal ID");
      const approver = String(organizer || "").trim().toLowerCase();
      if (!approver.includes("@")) throw new Error("invalid organizer identity");
      const script = [
        "if redis.call('EXISTS',KEYS[1])==1 then return {'frozen'} end; if redis.call('EXISTS',KEYS[8])==1 then return {'finalizing'} end;",
        "local raw=redis.call('HGET',KEYS[2],ARGV[1]); if not raw then return {'missing'} end;",
        "local p=cjson.decode(raw); if p.state~='proposed' then return {'closed'} end;",
        "if p.proposer==ARGV[2] then return {'same-organizer'} end;",
        "p.state='approved'; p.approver=ARGV[2]; p.approvedAt=ARGV[3];",
        "local encoded=cjson.encode(p); redis.call('HSET',KEYS[2],ARGV[1],encoded);",
        "redis.call('HSET',KEYS[3],p.participantId,encoded); redis.call('RPUSH',KEYS[4],encoded); redis.call('LTRIM',KEYS[4],-1000,-1);",
        "redis.call('INCR',KEYS[5]); redis.call('DEL',KEYS[6]); redis.call('DEL',KEYS[7]); return {'ok',encoded};",
      ].join(" ");
      const result = await command([
        "EVAL", script, "8",
        key("eligibility-freeze"), key("eligibility-proposals"), key("eligibility-decisions"), key("eligibility-audit"), key("eligibility-revision"), key("public-snapshot:fresh"), key("public-snapshot:latest"), key("finalization-lock"),
        String(proposalId), approver, new Date().toISOString(),
      ]);
      return parseScriptResult(result, {
        frozen: "eligibility ledger is frozen",
        finalizing: "final leaderboard sealing is in progress",
        missing: "eligibility proposal was not found",
        closed: "eligibility proposal is already closed",
        "same-organizer": "a second organizer must approve the decision",
      }, "eligibility proposal could not be approved");
    },

    async rejectEligibilityProposal(proposalId, organizer) {
      assertEligibilityLifecycleWritable();
      if (!/^elig_[0-9a-f]{32}$/.test(String(proposalId || ""))) throw new Error("invalid eligibility proposal ID");
      const reviewer = String(organizer || "").trim().toLowerCase();
      if (!reviewer.includes("@")) throw new Error("invalid organizer identity");
      const script = [
        "if redis.call('EXISTS',KEYS[1])==1 then return {'frozen'} end; if redis.call('EXISTS',KEYS[7])==1 then return {'finalizing'} end;",
        "local raw=redis.call('HGET',KEYS[2],ARGV[1]); if not raw then return {'missing'} end;",
        "local p=cjson.decode(raw); if p.state~='proposed' then return {'closed'} end;",
        "if p.proposer==ARGV[2] then return {'same-organizer'} end;",
        "p.state='rejected'; p.reviewer=ARGV[2]; p.reviewedAt=ARGV[3];",
        "local encoded=cjson.encode(p); redis.call('HSET',KEYS[2],ARGV[1],encoded); redis.call('RPUSH',KEYS[3],encoded); redis.call('LTRIM',KEYS[3],-1000,-1);",
        "redis.call('INCR',KEYS[4]); redis.call('DEL',KEYS[5]); redis.call('DEL',KEYS[6]); return {'ok',encoded};",
      ].join(" ");
      const result = await command([
        "EVAL", script, "7",
        key("eligibility-freeze"), key("eligibility-proposals"), key("eligibility-audit"), key("eligibility-revision"), key("public-snapshot:fresh"), key("public-snapshot:latest"), key("finalization-lock"),
        String(proposalId), reviewer, new Date().toISOString(),
      ]);
      return parseScriptResult(result, {
        frozen: "eligibility ledger is frozen",
        finalizing: "final leaderboard sealing is in progress",
        missing: "eligibility proposal was not found",
        closed: "eligibility proposal is already closed",
        "same-organizer": "a second organizer must reject the proposal",
      }, "eligibility proposal could not be rejected");
    },

    async eligibilityDecisions() {
      return (await readEligibilityLedger()).decisions;
    },

    async eligibilityProposals() {
      return parseRecords(await command(["HGETALL", key("eligibility-proposals")]));
    },

    async eligibilityLedger() {
      return readEligibilityLedger();
    },

    async acquireFinalizationLock(token, ttlSeconds = 120) {
      if (!/^[0-9a-f-]{36}$/.test(String(token || ""))) throw new Error("finalization lock token is invalid");
      if (!Number.isSafeInteger(ttlSeconds) || ttlSeconds < 30 || ttlSeconds > 300) {
        throw new Error("finalization lock lifetime is invalid");
      }
      const result = await command(["SET", key("finalization-lock"), String(token), "NX", "EX", String(ttlSeconds)]);
      if (String(result || "").toUpperCase() !== "OK") {
        throw new LeaderboardStorageError("another organizer is finalizing the leaderboard");
      }
      return Object.freeze({ token: String(token), ttlSeconds });
    },

    async releaseFinalizationLock(token) {
      return command([
        "EVAL",
        "if redis.call('GET',KEYS[1])==ARGV[1] then return redis.call('DEL',KEYS[1]) else return 0 end",
        "1",
        key("finalization-lock"),
        String(token || ""),
      ]);
    },

    async assertIntegrityReviewWritable() {
      const blocked = Number(await command([
        "EVAL",
        "if redis.call('EXISTS',KEYS[1])==1 or redis.call('EXISTS',KEYS[2])==1 then return 1 else return 0 end",
        "2",
        key("finalization-lock"),
        key("eligibility-freeze"),
      ]));
      if (blocked) throw new LeaderboardStorageError("integrity review is frozen for finalization");
      return true;
    },

    async acquireEligibilityFreeze(metadata = {}) {
      const configHash = String(metadata.configHash || "");
      const eventGeneration = String(metadata.eventGeneration || "");
      const rewardEventId = String(metadata.rewardEventId || "");
      const organizer = String(metadata.organizer || "").trim().toLowerCase();
      if (!/^[0-9a-f]{64}$/.test(configHash)) throw new Error("leaderboard config hash is invalid");
      if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(eventGeneration)) throw new Error("event generation is invalid");
      if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(rewardEventId)) throw new Error("Reward Sniper event ID is invalid");
      if (!organizer.includes("@")) throw new Error("invalid organizer identity");
      const freeze = {
        token: crypto.randomUUID(),
        configHash,
        eventGeneration,
        rewardEventId,
        organizer,
        acquiredAt: new Date().toISOString(),
      };
      const script = [
        "local existing=redis.call('GET',KEYS[1]);",
        "if existing then local f=cjson.decode(existing); if f.configHash~=ARGV[2] or f.eventGeneration~=ARGV[3] or f.rewardEventId~=ARGV[4] then return {'mismatch'} end; return {'existing',existing} end;",
        "for _,raw in ipairs(redis.call('HVALS',KEYS[2])) do local p=cjson.decode(raw); if p.state=='proposed' then return {'open-proposals'} end end;",
        "for _,raw in ipairs(redis.call('HVALS',KEYS[3])) do local d=cjson.decode(raw); if d.state=='approved' and d.status=='held' then return {'held'} end end;",
        "local f={token=ARGV[1],configHash=ARGV[2],eventGeneration=ARGV[3],rewardEventId=ARGV[4],organizer=ARGV[5],acquiredAt=ARGV[6],revision=tonumber(redis.call('GET',KEYS[4]) or '0')};",
        "local encoded=cjson.encode(f); redis.call('SET',KEYS[1],encoded); return {'ok',encoded};",
      ].join(" ");
      return Object.freeze(parseScriptResult(await command([
        "EVAL", script, "4",
        key("eligibility-freeze"), key("eligibility-proposals"), key("eligibility-decisions"), key("eligibility-revision"),
        freeze.token, configHash, eventGeneration, rewardEventId, organizer, freeze.acquiredAt,
      ]), {
        mismatch: "eligibility ledger is frozen for another event configuration",
        "open-proposals": "approve or reject every eligibility proposal before finalization",
        held: "resolve every eligibility hold before finalization",
      }, "eligibility ledger could not be frozen"));
    },

    async solves() {
      const values = await Promise.all(BINARY_CHALLENGE_KEYS.map((challenge) => (
        command(["HGETALL", key(`solves:${challenge}`)])
      )));
      return values.flatMap(parseRecords);
    },

    async cachePerformance(rows, metadata = {}) {
      const snapshot = {
        rows,
        eventId: String(metadata.eventId || ""),
        eventGeneration: String(metadata.eventGeneration || ""),
        scoringConfigHash: String(metadata.scoringConfigHash || ""),
        stage: String(metadata.stage || ""),
        updatedAt: new Date().toISOString(),
      };
      await command(["SET", key("reward-sniper"), JSON.stringify(snapshot)]);
      return snapshot;
    },

    async cachedPerformance() {
      const encoded = await command(["GET", key("reward-sniper")]);
      if (!encoded) return null;
      try {
        const parsed = JSON.parse(String(encoded));
        if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.rows)) throw new Error("invalid snapshot");
        return parsed;
      } catch {
        throw new LeaderboardStorageError("Stored Reward Sniper snapshot is malformed");
      }
    },

    async freshPublicSnapshot() {
      return parseSnapshot(await command(["GET", key("public-snapshot:fresh")]));
    },

    async latestPublicSnapshot() {
      return parseSnapshot(await command(["GET", key("public-snapshot:latest")]));
    },

    async acquirePublicSnapshotRefresh(token) {
      return String(await command([
        "SET",
        key("public-snapshot:refresh"),
        String(token),
        "NX",
        "EX",
        "10",
      ]) || "").toUpperCase() === "OK";
    },

    async releasePublicSnapshotRefresh(token) {
      return command([
        "EVAL",
        "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end",
        "1",
        key("public-snapshot:refresh"),
        String(token),
      ]);
    },

    async cachePublicSnapshot(snapshot) {
      const encoded = JSON.stringify(snapshot);
      const revision = Number(snapshot?.eligibilityRevision);
      if (!Number.isSafeInteger(revision) || revision < 0) throw new Error("snapshot eligibility revision is invalid");
      const cached = await command([
        "EVAL",
        "if tonumber(redis.call('GET',KEYS[1]) or '0')~=tonumber(ARGV[1]) then return 0 end; redis.call('SET',KEYS[2],ARGV[2],'EX',4); redis.call('SET',KEYS[3],ARGV[2],'EX',86400); return 1",
        "3", key("eligibility-revision"), key("public-snapshot:fresh"), key("public-snapshot:latest"),
        String(revision), encoded,
      ]);
      if (Number(cached) !== 1) throw new LeaderboardStorageError("Eligibility changed while the public leaderboard was being calculated");
      return snapshot;
    },

    async finalPublicSnapshot() {
      return parseSnapshot(await command(["GET", key("public-snapshot:final")]));
    },

    async sealFinalPublicSnapshot(snapshot, options = {}) {
      const revision = Number(snapshot?.eligibilityRevision);
      const freezeToken = String(options.freezeToken || "");
      if (!Number.isSafeInteger(revision) || revision < 0) throw new Error("snapshot eligibility revision is invalid");
      if (!freezeToken) throw new Error("eligibility freeze token is required");
      const finalized = {
        ...snapshot,
        scoringMode: "frozen",
        finalizedAt: new Date().toISOString(),
      };
      const script = [
        "local raw=redis.call('GET',KEYS[2]); if not raw then return {'not-frozen'} end;",
        "local f=cjson.decode(raw); if f.token~=ARGV[1] then return {'wrong-freeze'} end;",
        "if f.configHash~=ARGV[3] or f.eventGeneration~=ARGV[4] or f.rewardEventId~=ARGV[5] then return {'mismatch'} end;",
        "if tonumber(redis.call('GET',KEYS[3]) or '0')~=tonumber(ARGV[2]) or tonumber(f.revision)~=tonumber(ARGV[2]) then return {'stale'} end;",
        "local existing=redis.call('GET',KEYS[1]); if existing then return {'existing',existing} end;",
        "redis.call('SET',KEYS[1],ARGV[6]); return {'ok',ARGV[6]};",
      ].join(" ");
      const sealed = parseScriptResult(await command([
        "EVAL", script, "3",
        key("public-snapshot:final"), key("eligibility-freeze"), key("eligibility-revision"),
        freezeToken, String(revision), String(snapshot.configHash || ""), String(snapshot.eventGeneration || ""), String(snapshot.performanceSource?.eventId || ""), JSON.stringify(finalized),
      ]), {
        "not-frozen": "eligibility ledger is not frozen",
        "wrong-freeze": "eligibility freeze ownership changed",
        mismatch: "final leaderboard belongs to another event configuration",
        stale: "eligibility changed before the final leaderboard could be sealed",
      }, "final leaderboard could not be sealed");
      if (
        sealed?.configHash !== snapshot.configHash
        || sealed?.eventGeneration !== snapshot.eventGeneration
        || sealed?.eligibilityRevision !== revision
      ) {
        throw new LeaderboardStorageError("Final leaderboard belongs to another event configuration");
      }
      return sealed;
    },
  });
}
