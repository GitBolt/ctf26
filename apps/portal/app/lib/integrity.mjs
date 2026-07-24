function configuration() {
  const baseUrl = String(process.env.REWARD_SNIPER_ADMIN_URL || "").replace(/\/$/, "");
  const key = String(process.env.REWARD_SNIPER_ADMIN_KEY || "");
  if (!baseUrl || !key) throw new Error("Reward Sniper integrity administration is not configured");
  return { baseUrl, key };
}

function ingestConfiguration(env = process.env) {
  const baseUrl = String(env.REWARD_SNIPER_ADMIN_URL || "").replace(/\/$/, "");
  const key = String(env.INTEGRITY_INGEST_KEY || env.REWARD_SNIPER_ADMIN_KEY || "");
  if (!baseUrl || Buffer.byteLength(key) < 32) {
    throw new Error("integrity signal ingest is not configured");
  }
  return { baseUrl, key };
}

async function request(pathname, options = {}) {
  const { baseUrl, key } = configuration();
  const response = await fetch(`${baseUrl}${pathname}`, {
    ...options,
    cache: "no-store",
    signal: options.signal || AbortSignal.timeout(10_000),
    headers: {
      authorization: `Bearer ${key}`,
      ...(options.body ? { "content-type": "application/json" } : {}),
      ...options.headers,
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `integrity service returned ${response.status}`);
  return body;
}

export function rewardIntegrityReport() {
  return request("/api/admin/integrity");
}

export function freezeRewardIntegrityIngest(config, organizer) {
  return request("/api/admin/integrity/freeze", {
    method: "POST",
    headers: { "x-ctf-organizer": organizer },
    body: JSON.stringify({
      eventId: config.rewardEventId,
      eventGeneration: config.eventGeneration,
      scoringConfigHash: config.rewardScoringConfigHash,
    }),
  });
}

export function sealRewardIntegrityReview(config, organizer, review) {
  if (!/^[a-f0-9]{64}$/.test(String(review?.digest || ""))) {
    throw new Error("integrity review digest is invalid");
  }
  if (!Number.isSafeInteger(review?.activeCaseCount) || review.activeCaseCount < 0) {
    throw new Error("integrity review case count is invalid");
  }
  return request("/api/admin/integrity/seal", {
    method: "POST",
    headers: { "x-ctf-organizer": organizer },
    body: JSON.stringify({
      eventId: config.rewardEventId,
      eventGeneration: config.eventGeneration,
      scoringConfigHash: config.rewardScoringConfigHash,
      digest: review.digest,
      activeCaseCount: review.activeCaseCount,
    }),
  });
}

export function resetRewardSniperEvent(eventId, organizer) {
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(eventId)) throw new Error("invalid Reward Sniper event ID");
  return request("/api/admin/event/reset", {
    method: "POST",
    headers: { "x-ctf-organizer": organizer },
    body: JSON.stringify({ eventId }),
  });
}

export async function recordFastSolveReview(candidate, eventGeneration, options = {}) {
  const participantId = String(candidate?.participantId || "");
  const generation = String(eventGeneration || "");
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(participantId)) {
    throw new Error("fast-solve participant ID is invalid");
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(generation)) {
    throw new Error("fast-solve event generation is invalid");
  }
  const { baseUrl, key } = ingestConfiguration(options.env || process.env);
  const response = await (options.fetchImpl || fetch)(`${baseUrl}/api/internal/integrity/suspicion`, {
    method: "POST",
    cache: "no-store",
    headers: {
      authorization: `Bearer ${key}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      challenge: candidate.challenge,
      identity: {
        participantId,
        email: candidate.email,
        eventId: generation,
      },
      reasonCode: "challenge-solved-unusually-fast",
      confidence: "medium",
      summary: candidate.timing === "before-launch"
        ? `The accepted completion predates this participant's first recorded challenge launch by ${Math.abs(candidate.elapsedSeconds)} seconds.`
        : `The first recorded completion arrived ${candidate.elapsedSeconds} seconds after this participant first opened the challenge.`,
      evidence: {
        details: {
          signals: [candidate.timing === "before-launch" ? "completion-before-recorded-launch" : "completion-inside-fast-solve-window"],
          elapsedSeconds: candidate.elapsedSeconds,
          timing: candidate.timing,
          reviewThresholdSeconds: candidate.thresholdSeconds,
          launchedAt: candidate.launchedAt,
          completedAt: candidate.completedAt,
          sourceId: candidate.sourceId,
        },
      },
      timeline: [
        { at: new Date(candidate.launchedAt).valueOf(), action: "challenge-launched" },
        { at: new Date(candidate.completedAt).valueOf(), action: "completion-accepted" },
      ],
    }),
    signal: options.signal || AbortSignal.timeout(2_500),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `integrity signal ingest returned ${response.status}`);
  return body;
}
