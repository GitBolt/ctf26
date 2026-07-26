import crypto from "node:crypto";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PARTICIPANT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

function normalizeEmail(value) {
  const email = String(value || "").trim().toLowerCase();
  if (!EMAIL_PATTERN.test(email)) throw new Error("participant roster contains an invalid email");
  return email;
}

function participantIdSecret(env) {
  const value = String(env.PARTICIPANT_ID_SECRET || "");
  if (Buffer.byteLength(value) < 32) {
    throw new Error("PARTICIPANT_ID_SECRET must contain at least 32 bytes");
  }
  return value;
}

function normalizeDisplayName(value, participantId) {
  const displayName = String(value || participantId).trim();
  if (!displayName || displayName.length > 80 || /[\u0000-\u001f\u007f]/.test(displayName)) {
    throw new Error("participant roster contains an invalid display name");
  }
  return displayName;
}

function normalizeParticipation(value) {
  const participation = String(value || "scored").trim().toLowerCase();
  if (participation !== "scored" && participation !== "practice") {
    throw new Error("participant roster contains an invalid participation mode");
  }
  return participation;
}

function assertRosterFields(entry, allowed) {
  if (Object.keys(entry).some((field) => !allowed.has(field))) {
    throw new Error("participant roster entry contains unsupported fields");
  }
}

export function participantIdForEmail(email, env = process.env) {
  return crypto
    .createHmac("sha256", participantIdSecret(env))
    .update(normalizeEmail(email))
    .digest("hex")
    .slice(0, 16);
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
  const participantByDisplayName = new Map();
  const add = (emailValue, displayNameValue, participationValue) => {
    const email = normalizeEmail(emailValue);
    const participantId = participantIdForEmail(email, env);
    const displayName = normalizeDisplayName(displayNameValue, participantId);
    const participation = normalizeParticipation(participationValue);
    if (roster.has(email)) throw new Error(`participant roster contains duplicate email ${email}`);
    const displayKey = displayName.toLocaleLowerCase("en-US");
    if (participantByDisplayName.has(displayKey)) {
      throw new Error(`participant roster contains duplicate display name ${displayName}`);
    }
    participantByDisplayName.set(displayKey, participantId);
    roster.set(email, Object.freeze({ email, participantId, displayName, participation }));
  };

  if (Array.isArray(parsed)) {
    for (const entry of parsed) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        throw new Error("participant roster entries must be objects");
      }
      assertRosterFields(entry, new Set(["email", "participantId", "displayName", "handle", "participation"]));
      const email = normalizeEmail(entry.email);
      const derived = participantIdForEmail(email, env);
      if (entry.participantId !== undefined && String(entry.participantId) !== derived) {
        throw new Error(`participantId for ${email} does not match the stable derived ID`);
      }
      add(email, entry.displayName || entry.handle, entry.participation);
    }
  } else if (parsed && typeof parsed === "object") {
    for (const [email, value] of Object.entries(parsed)) {
      if (value && typeof value === "object" && !Array.isArray(value)) {
        assertRosterFields(value, new Set(["participantId", "displayName", "handle", "participation"]));
        const derived = participantIdForEmail(email, env);
        if (value.participantId !== undefined && String(value.participantId) !== derived) {
          throw new Error(`participantId for ${normalizeEmail(email)} does not match the stable derived ID`);
        }
        add(email, value.displayName || value.handle, value.participation);
      } else {
        add(email, value, undefined);
      }
    }
  } else {
    throw new Error("PARTICIPANT_ROSTER_JSON must be an object or array");
  }

  if (roster.size === 0) throw new Error("participant roster must not be empty");
  return roster;
}

export function registrationForEmail(email, fallbackParticipantId, env = process.env) {
  const normalizedEmail = normalizeEmail(email);
  const participantId = participantIdForEmail(normalizedEmail, env);
  if (fallbackParticipantId !== undefined && String(fallbackParticipantId) !== participantId) {
    throw new Error("registration participant ID does not match the stable derived ID");
  }
  const roster = participantRoster(env);
  if (!roster) {
    if (env.NODE_ENV === "production" && env.ALLOW_OPEN_REGISTRATION !== "true") return null;
    return Object.freeze({ email: normalizedEmail, participantId, displayName: participantId });
  }
  return roster.get(normalizedEmail) || null;
}

export function isParticipantId(value) {
  return PARTICIPANT_ID_PATTERN.test(String(value || ""));
}
