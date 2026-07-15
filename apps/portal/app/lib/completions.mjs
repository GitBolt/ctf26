const TEAM_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

function requiredSecret(env, name, label) {
  const secret = String(env[name] || "");
  if (Buffer.byteLength(secret) < 32) {
    throw new Error(`${label} completion status is not configured`);
  }
  return secret;
}

function completionUrl(env, teamId, urlEnv) {
  const configured = String(env[urlEnv] || "").trim();
  if (!configured) throw new Error(`${urlEnv} is not configured`);
  const url = new URL("/api/completion", configured);
  url.searchParams.set("teamId", teamId);
  return url;
}

async function challengeCompletion(user, definition, options = {}) {
  const env = options.env || process.env;
  const fetchImpl = options.fetchImpl || fetch;
  const teamId = String(user?.team_id || user?.participant_id || "");
  if (!TEAM_ID_PATTERN.test(teamId)) throw new Error("invalid team ID");

  const response = await fetchImpl(completionUrl(env, teamId, definition.urlEnv), {
    cache: "no-store",
    headers: {
      accept: "application/json",
      authorization: `Bearer ${requiredSecret(env, definition.secretEnv, definition.label)}`,
    },
    signal: options.signal,
  });
  if (!response.ok) throw new Error(`${definition.label} completion service returned ${response.status}`);
  const result = await response.json();
  if (result?.completed !== true) return null;
  return Object.freeze({
    challenge: definition.challenge,
    completedAt: String(result.completedAt || ""),
  });
}

export function lastStopCompletion(user, options = {}) {
  return challengeCompletion(user, {
    challenge: "last-stop",
    label: "LAST STOP",
    urlEnv: "LAST_STOP_URL",
    secretEnv: "CHALLENGE_TICKET_SECRET_LAST_STOP",
  }, options);
}

export function stGenesisCompletion(user, options = {}) {
  return challengeCompletion(user, {
    challenge: "st-genesis-airdrop",
    label: "$ST GENESIS AIRDROP",
    urlEnv: "ST_GENESIS_AIRDROP_URL",
    secretEnv: "CHALLENGE_TICKET_SECRET_ST_GENESIS_AIRDROP",
  }, options);
}
