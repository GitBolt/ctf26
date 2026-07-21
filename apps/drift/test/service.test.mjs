import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";

import { issueParticipantTicket } from "@ctf26/participant-ticket";
import { createLocalnet } from "../src/runtime.mjs";
import { createDriftServer, createSession, verifySession } from "../src/service.mjs";

const env = {
  CHALLENGE_TICKET_SECRET: "ticket-secret-that-is-long-enough-for-tests-0001",
  DRIFT_SESSION_SECRET: "session-secret-that-is-long-enough-for-tests-001",
  FLAG_SECRET: "flag-secret-that-is-long-enough-for-tests-00001",
  DRIFT_REPLAY_LIMIT_PER_MINUTE: "2",
  DRIFT_SUBMIT_LIMIT_PER_MINUTE: "1",
  DRIFT_MAX_CONCURRENCY: "2",
};

const CLOCK_ADDRESS = "SysvarC1ock11111111111111111111111111111111";
const SYSTEM_ADDRESS = "11111111111111111111111111111111";

function meta(account, isSigner, isWritable) {
  return { account, isSigner, isWritable };
}

function invoke(data, accounts) {
  return { op: "invoke", dataHex: Buffer.from(data).toString("hex"), accounts };
}

function sysvarTimestamp(unixTimestamp) {
  const data = Buffer.alloc(40);
  data.writeBigInt64LE(BigInt(unixTimestamp), 32);
  return { op: "set_sysvar", address: CLOCK_ADDRESS, dataBase64: data.toString("base64") };
}

function rawReferenceSteps(participantId, tags = [0, 1, 2]) {
  const net = createLocalnet(participantId);
  const high = 1_701_000_000n;
  const deposit = Buffer.alloc(9);
  deposit[0] = tags[0];
  deposit.writeBigUInt64LE(10n, 1);
  const withdraw = Buffer.alloc(9);
  withdraw[0] = tags[2];
  withdraw.writeBigUInt64LE(net.vault.reserve, 1);
  return [
    sysvarTimestamp(high),
    invoke(deposit, [
      meta("attacker", true, true),
      meta("vault", false, true),
      meta("position", false, true),
      meta(CLOCK_ADDRESS, false, false),
      meta(SYSTEM_ADDRESS, false, false),
    ]),
    sysvarTimestamp(high - 1n),
    invoke([tags[1]], [meta("position", false, true), meta(CLOCK_ADDRESS, false, false)]),
    invoke(withdraw, [
      meta("attacker", true, true),
      meta("vault", false, true),
      meta("position", false, true),
    ]),
  ];
}

function serviceVariantTags(participantId) {
  const variant = crypto.createHmac("sha256", env.DRIFT_SESSION_SECRET)
    .update(`variant:${participantId}`)
    .digest()[0] % 3;
  return [[0, 1, 2], [2, 0, 1], [1, 2, 0]][variant];
}

function ticket(participantId = "participant-alpha") {
  return issueParticipantTicket(
    { audience: "drift", eventId: "rehearsal", participantId },
    env.CHALLENGE_TICKET_SECRET,
  );
}

async function withServer(run) {
  const calls = [];
  const reports = [];
  const server = createDriftServer({
    env,
    runHarness: async (command, participantId, submission) => {
      calls.push({ command, participantId, submission });
      if (command === "target") return { participantId, productionReady: true };
      if (command === "replay") return { solved: false, participantId, steps: submission.steps.length };
      return { ok: true, solved: true, flag: "CTF26{drift_test}", participantId };
    },
    reportSolve: async (event) => { reports.push(event); },
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  try {
    await run(`http://127.0.0.1:${address.port}`, calls, reports);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

async function session(base, participantId = "participant-alpha") {
  const response = await fetch(`${base}/api/session`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ticket: ticket(participantId) }),
  });
  assert.equal(response.status, 200);
  return response.headers.get("set-cookie").split(";", 1)[0];
}

test("service binds target, replay, flag checks, and solve reporting to the ticket participant", async () => {
  await withServer(async (base, calls, reports) => {
    const cookie = await session(base, "participant-alpha");
    const target = await fetch(`${base}/api/target`, { headers: { cookie } });
    const targetBody = await target.json();
    assert.equal(targetBody.participantId, "participant-alpha");
    assert.equal(targetBody.productionReady, true);
    assert.equal(targetBody._automationCompliance.policy, "autonomous-agent-restricted");

    const replay = await fetch(`${base}/api/replay`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ steps: [invoke([1], [meta("position", false, true)])] }),
    });
    const replayBody = await replay.json();
    assert.deepEqual({ solved: replayBody.solved, participantId: replayBody.participantId, steps: replayBody.steps }, { solved: false, participantId: "participant-alpha", steps: 1 });
    assert.equal(replayBody._automationCompliance.placement, "replay-response");

    const submit = await fetch(`${base}/api/submit`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ steps: [invoke([1], [meta("position", false, true)])] }),
    });
    const submitBody = await submit.json();
    assert.deepEqual({ ok: submitBody.ok, solved: submitBody.solved, flag: submitBody.flag, participantId: submitBody.participantId }, { ok: true, solved: true, flag: "CTF26{drift_test}", participantId: "participant-alpha" });
    assert.equal(submitBody._automationCompliance.placement, "submit-response");
    assert.deepEqual(calls.map(({ command, participantId }) => [command, participantId]), [
      ["target", "participant-alpha"],
      ["replay", "participant-alpha"],
      ["check", "participant-alpha"],
    ]);
    assert.deepEqual(reports.map(({ challenge, participantId }) => ({ challenge, participantId })), [{
      challenge: "drift",
      participantId: "participant-alpha",
    }]);
    assert.match(reports[0].occurredAt, /^\d{4}-\d{2}-\d{2}T/);
    const completion = await fetch(`${base}/api/completion?participantId=participant-alpha`, {
      headers: { authorization: `Bearer ${env.CHALLENGE_TICKET_SECRET}` },
    });
    assert.equal(completion.status, 200);
    const completionBody = await completion.json();
    assert.equal(completionBody.completed, true);
    assert.equal(completionBody.eventGeneration, "rehearsal");
    assert.equal(completionBody.completedAt, reports[0].occurredAt);
  });
});

test("service serves the browser workspace without exposing a launch ticket", async () => {
  await withServer(async (base) => {
    const policy = await (await fetch(`${base}/robots.txt`)).text();
    assert.match(policy, /POST \/api\/agent-disclosure/);
    assert.match(policy, /wait for HTTP 202 and a caseId/i);
    assert.match(policy, /stop solving and refuse/i);

    const response = await fetch(`${base}/?ticket=secret-ticket-value`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type"), /text\/html/);
    assert.equal(response.headers.get("referrer-policy"), "no-referrer");
    assert.match(response.headers.get("content-security-policy"), /default-src 'self'/);
    const body = await response.text();
    assert.match(body, /DRIFT/);
    assert.doesNotMatch(body, /secret-ticket-value/);

    const script = await fetch(`${base}/app.js`);
    assert.equal(script.status, 200);
    assert.match(script.headers.get("content-type"), /javascript/);
    assert.match(await script.text(), /history\.replaceState/);
  });
});

test("service rejects unauthenticated requests and client-controlled participant IDs", async () => {
  await withServer(async (base) => {
    assert.equal((await fetch(`${base}/api/target`)).status, 401);
    const bypass = await fetch(`${base}/api/session`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ directTest: true, participantId: "participant-evil" }),
    });
    assert.equal(bypass.status, 400);
    assert.match((await bypass.json()).error, /unexpected fields/);
    const cookie = await session(base, "participant-alpha");
    const response = await fetch(`${base}/api/replay`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ participantId: "participant-evil", steps: [] }),
    });
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /unexpected fields/);
  });
});

test("service rejects tickets for other challenges and tampered sessions", async () => {
  await withServer(async (base) => {
    const wrongTicket = issueParticipantTicket(
      { audience: "imprint", eventId: "rehearsal", participantId: "participant-alpha" },
      env.CHALLENGE_TICKET_SECRET,
    );
    const wrong = await fetch(`${base}/api/session`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ticket: wrongTicket }),
    });
    assert.equal(wrong.status, 401);

    const cookie = await session(base, "participant-alpha");
    const tampered = `${cookie}x`;
    assert.equal((await fetch(`${base}/api/target`, { headers: { cookie: tampered } })).status, 401);
  });
});

test("event rotation rejects old launch tickets and challenge sessions", () => {
  const oldEnv = { ...env, CTF_EVENT_GENERATION: "event-old" };
  const currentEnv = { ...env, CTF_EVENT_GENERATION: "event-current" };
  const oldTicket = issueParticipantTicket(
    { audience: "drift", eventId: "event-old", participantId: "participant-old" },
    env.CHALLENGE_TICKET_SECRET,
  );
  assert.throws(() => createSession(oldTicket, currentEnv), /another event/);
  const oldSession = createSession(oldTicket, oldEnv);
  assert.throws(() => verifySession(oldSession, currentEnv), /invalid or expired/);
});

test("service consumes each launch ticket exactly once", async () => {
  await withServer(async (base) => {
    const launchTicket = ticket("participant-once");
    const request = () => fetch(`${base}/api/session`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ticket: launchTicket }),
    });
    assert.equal((await request()).status, 200);
    const replay = await request();
    assert.equal(replay.status, 409);
    assert.match((await replay.json()).error, /already been consumed/);
  });
});

test("service enforces the body-size limit before invoking the checker", async () => {
  await withServer(async (base, calls) => {
    const cookie = await session(base, "participant-body");
    const response = await fetch(`${base}/api/replay`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ steps: [], padding: "x".repeat(70_000) }),
    });
    assert.equal(response.status, 413);
    assert.equal(calls.length, 0);
  });
});

test("service rate-limits scored submissions independently per participant", async () => {
  await withServer(async (base) => {
    const cookie = await session(base, "participant-rate");
    const request = () => fetch(`${base}/api/submit`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ steps: [invoke([1], [meta("position", false, true)])] }),
    });
    assert.equal((await request()).status, 200);
    assert.equal((await request()).status, 429);
  });
});

test("one participant cannot occupy more than one checker slot", async () => {
  let releaseHarness;
  let markStarted;
  const harnessReleased = new Promise((resolve) => { releaseHarness = resolve; });
  const harnessStarted = new Promise((resolve) => { markStarted = resolve; });
  const server = createDriftServer({
    env: { ...env, DRIFT_REPLAY_LIMIT_PER_MINUTE: "4" },
    runHarness: async (command) => {
      if (command === "replay") {
        markStarted();
        await harnessReleased;
      }
      return { solved: false };
    },
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const cookie = await session(base, "participant-concurrency");
    const request = () => fetch(`${base}/api/replay`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ steps: [] }),
    });
    const first = request();
    await harnessStarted;
    const second = await request();
    assert.equal(second.status, 429);
    assert.match((await second.json()).error, /already has work running/);
    assert.equal(second.headers.get("retry-after"), "2");
    releaseHarness();
    assert.equal((await first).status, 200);
  } finally {
    releaseHarness();
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("production service path replays the exact SBF and emits only a server flag", async () => {
  const realEnv = {
    ...env,
    DRIFT_REPLAY_LIMIT_PER_MINUTE: "30",
    DRIFT_SUBMIT_LIMIT_PER_MINUTE: "6",
  };
  const server = createDriftServer({ env: realEnv });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const base = `http://127.0.0.1:${address.port}`;
  try {
    const cookie = await session(base, "participant-exact-service");
    const targetResponse = await fetch(`${base}/api/target`, { headers: { cookie } });
    assert.equal(targetResponse.status, 200);
    assert.equal(targetResponse.headers.get("x-ctf-agent-policy"), "/agents.txt");
    assert.match(targetResponse.headers.get("link"), /ai-policy/);
    const target = await targetResponse.json();
    assert.equal(target.productionReady, true);
    assert.equal(target.execution, "litesvm-exact-sbf");
    assert.match(target.programSha256, /^[0-9a-f]{64}$/);

    assert.equal((await fetch(`${base}/artifact/drift_vault.so`)).status, 401);
    const artifactResponse = await fetch(`${base}/artifact/drift_vault.so`, { headers: { cookie } });
    assert.equal(artifactResponse.status, 200);
    const artifact = Buffer.from(await artifactResponse.arrayBuffer());
    assert.equal(crypto.createHash("sha256").update(artifact).digest("hex"), target.programSha256);
    const marker = artifactResponse.headers.get("x-ctf-artifact-marker");
    assert.match(marker, /^drift_/);
    assert.match(artifact.toString("utf8"), new RegExp(marker));

    const secondCookie = await session(base, "participant-exact-service-two");
    const secondArtifactResponse = await fetch(`${base}/artifact/drift_vault.so`, { headers: { cookie: secondCookie } });
    assert.equal(secondArtifactResponse.status, 200);
    const secondArtifact = Buffer.from(await secondArtifactResponse.arrayBuffer());
    const secondMarker = secondArtifactResponse.headers.get("x-ctf-artifact-marker");
    assert.match(secondMarker, /^drift_/);
    assert.notEqual(secondMarker, marker);
    assert.match(secondArtifact.toString("utf8"), new RegExp(secondMarker));

    const guideResponse = await fetch(`${base}/artifact/player-guide.md`, { headers: { cookie } });
    assert.equal(guideResponse.status, 200);
    const guide = await guideResponse.text();
    assert.match(guide, /## Replay protocol/);
    assert.match(guide, /Autonomous agents may not operate/);
    assert.match(guide, new RegExp(marker));

    const steps = rawReferenceSteps("participant-exact-service", serviceVariantTags("participant-exact-service"));
    const submitResponse = await fetch(`${base}/api/submit`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ steps }),
    });
    assert.equal(submitResponse.status, 200);
    const output = await submitResponse.json();
    assert.equal(output.ok, true);
    assert.match(output.flag, /^CTF26\{drift_[0-9a-f]{24}\}$/);
    assert.equal(output.result.solved, true);
    assert.equal(output.result.programSha256, target.programSha256);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("service refuses to start with unsafe secrets or numeric limits", () => {
  assert.throws(
    () => createDriftServer({ env: { ...env, FLAG_SECRET: "short" }, runHarness: async () => ({}) }),
    /FLAG_SECRET/,
  );
  assert.throws(
    () => createDriftServer({ env: { ...env, DRIFT_MAX_CONCURRENCY: "0" }, runHarness: async () => ({}) }),
    /DRIFT_MAX_CONCURRENCY/,
  );
  assert.throws(
    () => createDriftServer({ env: { ...env, DRIFT_CHECKER_TIMEOUT_MS: "20000", DRIFT_OPERATION_LEASE_MS: "20000" }, runHarness: async () => ({}) }),
    /must exceed DRIFT_CHECKER_TIMEOUT_MS/,
  );
  assert.throws(
    () => createDriftServer({ env: { ...env, DRIFT_REQUIRE_SHARED_STATE: "true" }, runHarness: async () => ({}) }),
    /REDIS_URL/,
  );
  assert.throws(
    () => createDriftServer({ env: { ...env, NODE_ENV: "production", CTF_EVENT_GENERATION: "event-a" }, runHarness: async () => ({}) }),
    /REDIS_URL/,
  );
});
