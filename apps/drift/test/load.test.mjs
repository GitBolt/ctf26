import assert from "node:assert/strict";
import test from "node:test";

import { issueParticipantTicket } from "@ctf26/participant-ticket";
import { createDriftServer } from "../src/service.mjs";

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const TICKET_SECRET = "drift-load-ticket-secret-that-is-long-enough-001";
const env = {
  NODE_ENV: "test",
  CTF_EVENT_GENERATION: "drift-load-event",
  CHALLENGE_TICKET_SECRET: TICKET_SECRET,
  DRIFT_SESSION_SECRET: "drift-load-session-secret-that-is-long-enough-01",
  FLAG_SECRET: "drift-load-flag-secret-that-is-long-enough-0001",
  DRIFT_REPLAY_LIMIT_PER_MINUTE: "100",
  DRIFT_SUBMIT_LIMIT_PER_MINUTE: "100",
  DRIFT_SESSION_LIMIT_PER_MINUTE: "1000",
  DRIFT_GLOBAL_WORK_LIMIT_PER_MINUTE: "10000",
  DRIFT_MAX_CONCURRENCY: "4",
  DRIFT_CHECKER_TIMEOUT_MS: "1000",
  DRIFT_OPERATION_LEASE_MS: "2000",
  DRIFT_HEALTH_CACHE_MS: "15000",
};

test("an invalid-ticket source cannot consume admission for 50 legitimate launches", async (t) => {
  const floodEnv = {
    ...env,
    CTF_EVENT_GENERATION: "drift-session-flood-event",
    DRIFT_SESSION_ATTEMPT_LIMIT_PER_IP_PER_MINUTE: "25",
    // Above 50 legitimate launches plus the 25 attempts admitted from one source,
    // but below the 200-request flood. This fails if rejected source attempts
    // are allowed to consume the global attempt bucket.
    DRIFT_GLOBAL_SESSION_ATTEMPT_LIMIT_PER_MINUTE: "90",
    DRIFT_SESSION_LIMIT_PER_MINUTE: "51",
    DRIFT_PARTICIPANT_SESSION_LIMIT_PER_MINUTE: "2",
  };
  const server = createDriftServer({
    env: floodEnv,
    runHarness: async () => ({ ok: true }),
    reportSolve: async () => {},
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const launch = (ticket, source) => fetch(`${origin}/api/session`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": source },
    body: JSON.stringify({ ticket }),
  });

  const invalid = await Promise.all(Array.from({ length: 200 }, () => launch("not-a-ticket", "198.51.100.9")));
  assert.equal(invalid.filter((response) => response.status === 401).length, 25);
  assert.equal(invalid.filter((response) => response.status === 429).length, 175);

  const tickets = Array.from({ length: 50 }, (_, index) => issueParticipantTicket(
    { audience: "drift", eventId: floodEnv.CTF_EVENT_GENERATION, participantId: `flood-legitimate-${index}` },
    TICKET_SECRET,
    { jti: `drift-flood-legitimate-${index}` },
  ));
  const legitimate = await Promise.all(tickets.map((launchTicket, index) => launch(launchTicket, `203.0.113.${index + 1}`)));
  assert.ok(legitimate.every((response) => response.status === 200));

  const replay = await launch(tickets[0], "203.0.113.1");
  assert.equal(replay.status, 409);
  assert.match((await replay.json()).error, /already been consumed/);
});

test("50 participant sessions stay isolated while checker work and spam are bounded", async (t) => {
  let active = 0;
  let maximum = 0;
  let healthCalls = 0;
  const reports = [];
  const server = createDriftServer({
    env,
    healthCheck: async () => { healthCalls += 1; await wait(10); return true; },
    runHarness: async (command, participantId, submission) => {
      if (command === "target") return { participantId, productionReady: true };
      active += 1;
      maximum = Math.max(maximum, active);
      await wait(30);
      active -= 1;
      if (command === "check") return { ok: true, solved: true, flag: `CTF26{${participantId}}` };
      return { solved: false, participantId, steps: submission.steps.length };
    },
    reportSolve: async (event) => { reports.push(event); },
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  const origin = `http://127.0.0.1:${server.address().port}`;

  const health = await Promise.all(Array.from({ length: 50 }, () => fetch(`${origin}/health`)));
  assert.ok(health.every((response) => response.status === 200));
  assert.equal(healthCalls, 1);

  const participantIds = Array.from({ length: 50 }, (_, index) => `load-participant-${index}`);
  const cookies = new Map();
  await Promise.all(participantIds.map(async (participantId) => {
    const ticket = issueParticipantTicket(
      { audience: "drift", eventId: env.CTF_EVENT_GENERATION, participantId },
      TICKET_SECRET,
      { jti: `drift-load-ticket-${participantId}` },
    );
    const response = await fetch(`${origin}/api/session`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ticket }),
    });
    assert.equal(response.status, 200);
    cookies.set(participantId, response.headers.get("set-cookie").split(";", 1)[0]);
  }));

  for (const participantId of participantIds) {
    const response = await fetch(`${origin}/api/target`, { headers: { cookie: cookies.get(participantId) } });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).participantId, participantId);
  }

  const replay = (participantId) => fetch(`${origin}/api/replay`, {
    method: "POST",
    headers: { cookie: cookies.get(participantId), "content-type": "application/json" },
    body: JSON.stringify({ steps: [] }),
  });
  const firstWave = await Promise.all(participantIds.map(replay));
  assert.equal(firstWave.filter((response) => response.status === 200).length, 4);
  assert.ok(firstWave.filter((response) => response.status === 429).every((response) => response.headers.get("retry-after") === "2"));
  assert.equal(maximum, 4);

  for (let index = 0; index < participantIds.length; index += 1) {
    if (firstWave[index].status === 200) continue;
    const response = await replay(participantIds[index]);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).participantId, participantIds[index]);
  }

  const spamParticipant = participantIds[0];
  const spamWave = await Promise.all(Array.from({ length: 12 }, () => replay(spamParticipant)));
  assert.equal(spamWave.filter((response) => response.status === 200).length, 1);
  assert.ok(spamWave.filter((response) => response.status === 429).every((response) => response.headers.get("retry-after") === "2"));

  const submit = () => fetch(`${origin}/api/submit`, {
    method: "POST",
    headers: { cookie: cookies.get(spamParticipant), "content-type": "application/json" },
    body: JSON.stringify({ steps: [] }),
  });
  assert.equal((await submit()).status, 200);
  assert.equal((await submit()).status, 200);
  assert.equal(reports.length, 2);
  assert.equal(reports[0].sourceId, reports[1].sourceId);
  assert.equal(reports[0].occurredAt, reports[1].occurredAt);
  const completion = await fetch(`${origin}/api/completion?participantId=${spamParticipant}`, {
    headers: { authorization: `Bearer ${TICKET_SECRET}` },
  });
  assert.equal(completion.status, 200);
  assert.equal((await completion.json()).completedAt, reports[0].occurredAt);
});
