const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TEAM_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

function normalizeEmail(value) {
  const email = String(value || "").trim().toLowerCase();
  if (!EMAIL_PATTERN.test(email)) throw new Error("registration roster contains an invalid email");
  return email;
}

function normalizeTeamId(value) {
  const teamId = String(value || "").trim();
  if (!TEAM_ID_PATTERN.test(teamId)) throw new Error("registration roster contains an invalid team ID");
  return teamId;
}

export function participantRoster(env = process.env) {
  const encoded = String(env.PARTICIPANT_ROSTER_JSON || "").trim();
  if (!encoded) return null;

  let parsed;
  try {
    parsed = JSON.parse(encoded);
  } catch {
    throw new Error("PARTICIPANT_ROSTER_JSON must be valid JSON");
  }

  const roster = new Map();
  const add = (emailValue, teamValue) => {
    const email = normalizeEmail(emailValue);
    const teamId = normalizeTeamId(teamValue);
    if (roster.has(email)) throw new Error(`registration roster contains duplicate email ${email}`);
    roster.set(email, Object.freeze({ email, teamId }));
  };

  if (Array.isArray(parsed)) {
    for (const entry of parsed) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        throw new Error("registration roster entries must be objects");
      }
      add(entry.email, entry.teamId);
    }
  } else if (parsed && typeof parsed === "object") {
    for (const [email, teamId] of Object.entries(parsed)) add(email, teamId);
  } else {
    throw new Error("PARTICIPANT_ROSTER_JSON must be an object or array");
  }

  if (roster.size === 0) throw new Error("registration roster must not be empty");
  return roster;
}

export function registrationForEmail(email, fallbackTeamId, env = process.env) {
  const normalizedEmail = normalizeEmail(email);
  const roster = participantRoster(env);
  if (!roster) {
    return Object.freeze({ email: normalizedEmail, teamId: normalizeTeamId(fallbackTeamId) });
  }
  return roster.get(normalizedEmail) || null;
}
