#!/usr/bin/env node
import { pathToFileURL } from "node:url";

import { issueParticipantTicket } from "../packages/participant-ticket/index.js";

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

export function createTestLaunch(env = process.env, options = {}) {
  const audience = identifier(env.TICKET_AUDIENCE, "TICKET_AUDIENCE");
  const participantId = identifier(env.PARTICIPANT_ID, "PARTICIPANT_ID");
  const teamId = identifier(env.TEAM_ID || participantId, "TEAM_ID");
  const secret = env.TICKET_SECRET || env.PARTICIPANT_TICKET_SECRET || env.CHALLENGE_TICKET_SECRET;
  if (!secret) throw new Error("TICKET_SECRET (or the service ticket-secret variable) is required");

  const destination = new URL(required(env.CHALLENGE_URL, "CHALLENGE_URL"));
  if (!['https:', 'http:'].includes(destination.protocol) || destination.username || destination.password) {
    throw new Error("CHALLENGE_URL must be an HTTP(S) URL without credentials");
  }
  if (destination.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(destination.hostname)) {
    throw new Error("CHALLENGE_URL must use HTTPS outside local development");
  }
  if (destination.searchParams.has("ticket")) throw new Error("CHALLENGE_URL must not already contain a ticket");

  const ttlSeconds = integer(env.TICKET_TTL_SECONDS || "600", "TICKET_TTL_SECONDS");
  const ticket = issueParticipantTicket(
    { audience, eventId: "ctf26", participantId, teamId },
    secret,
    { ttlSeconds, now: options.now },
  );
  destination.searchParams.set("ticket", ticket);
  return destination.toString();
}

function required(value, name) {
  const normalized = String(value || "").trim();
  if (!normalized) throw new Error(`${name} is required`);
  return normalized;
}

function identifier(value, name) {
  const normalized = required(value, name);
  if (!IDENTIFIER.test(normalized)) throw new Error(`${name} is not a valid identifier`);
  return normalized;
}

function integer(value, name) {
  const normalized = required(value, name);
  if (!/^\d+$/.test(normalized)) throw new Error(`${name} must be an integer`);
  return Number(normalized);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.stdout.write(`${createTestLaunch()}\n`);
  } catch (error) {
    process.stderr.write(`Cannot issue test launch: ${error.message}\n`);
    process.exitCode = 1;
  }
}
