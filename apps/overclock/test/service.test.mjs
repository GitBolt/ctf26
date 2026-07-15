import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";

import { issueParticipantTicket } from "@ctf26/participant-ticket";
import { createLocalnet } from "../src/runtime.mjs";
import { createDriftServer } from "../src/service.mjs";

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

function rawReferenceSteps(teamId) {
  const net = createLocalnet(teamId);
  const high = 1_701_000_000n;
  const deposit = Buffer.alloc(9);
  deposit[0] = 0;
  deposit.writeBigUInt64LE(10n, 1);
  const withdraw = Buffer.alloc(9);
  withdraw[0] = 2;
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
    invoke([1], [meta("position", false, true), meta(CLOCK_ADDRESS, false, false)]),
    invoke(withdraw, [
      meta("attacker", true, true),
      meta("vault", false, true),
      meta("position", false, true),
    ]),
  ];
}

function ticket(teamId = "team-alpha") {
  return issueParticipantTicket(
    { audience: "overclock", eventId: "ctf26", participantId: `${teamId}-player`, teamId },
    env.CHALLENGE_TICKET_SECRET,
  );
}

async function withServer(run) {
  const calls = [];
  const server = createDriftServer({
    env,
    runHarness: async (command, teamId, submission) => {
      calls.push({ command, teamId, submission });
      if (command === "target") return { teamId, productionReady: true };
      if (command === "replay") return { solved: false, teamId, steps: submission.steps.length };
      return { ok: true, flag: "CTF26{drift_test}", teamId };
    },
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  try {
    await run(`http://127.0.0.1:${address.port}`, calls);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

async function session(base, teamId = "team-alpha") {
  const response = await fetch(`${base}/api/session`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ticket: ticket(teamId) }),
  });
  assert.equal(response.status, 200);
  return response.headers.get("set-cookie").split(";", 1)[0];
}

test("service binds target, replay, and flag checks to the ticket team", async () => {
  await withServer(async (base, calls) => {
    const cookie = await session(base, "team-alpha");
    const target = await fetch(`${base}/api/target`, { headers: { cookie } });
    assert.deepEqual(await target.json(), { teamId: "team-alpha", productionReady: true });

    const replay = await fetch(`${base}/api/replay`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ steps: [invoke([1], [meta("position", false, true)])] }),
    });
    assert.deepEqual(await replay.json(), { solved: false, teamId: "team-alpha", steps: 1 });

    const submit = await fetch(`${base}/api/submit`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ steps: [invoke([1], [meta("position", false, true)])] }),
    });
    assert.deepEqual(await submit.json(), { ok: true, flag: "CTF26{drift_test}", teamId: "team-alpha" });
    assert.deepEqual(calls.map(({ command, teamId }) => [command, teamId]), [
      ["target", "team-alpha"],
      ["replay", "team-alpha"],
      ["check", "team-alpha"],
    ]);
  });
});

test("service serves the browser workspace without exposing a launch ticket", async () => {
  await withServer(async (base) => {
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

test("service rejects unauthenticated requests and client-controlled team IDs", async () => {
  await withServer(async (base) => {
    assert.equal((await fetch(`${base}/api/target`)).status, 401);
    const bypass = await fetch(`${base}/api/session`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ directTest: true, teamId: "team-evil" }),
    });
    assert.equal(bypass.status, 400);
    assert.match((await bypass.json()).error, /unexpected fields/);
    const cookie = await session(base, "team-alpha");
    const response = await fetch(`${base}/api/replay`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ teamId: "team-evil", steps: [] }),
    });
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /unexpected fields/);
  });
});

test("service rejects tickets for other challenges and tampered sessions", async () => {
  await withServer(async (base) => {
    const wrongTicket = issueParticipantTicket(
      { audience: "imprint", participantId: "p1", teamId: "team-alpha" },
      env.CHALLENGE_TICKET_SECRET,
    );
    const wrong = await fetch(`${base}/api/session`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ticket: wrongTicket }),
    });
    assert.equal(wrong.status, 400);

    const cookie = await session(base, "team-alpha");
    const tampered = `${cookie}x`;
    assert.equal((await fetch(`${base}/api/target`, { headers: { cookie: tampered } })).status, 401);
  });
});

test("service consumes each launch ticket exactly once", async () => {
  await withServer(async (base) => {
    const launchTicket = ticket("team-once");
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
    const cookie = await session(base, "team-body");
    const response = await fetch(`${base}/api/replay`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ steps: [], padding: "x".repeat(70_000) }),
    });
    assert.equal(response.status, 413);
    assert.equal(calls.length, 0);
  });
});

test("service rate-limits scored submissions independently per team", async () => {
  await withServer(async (base) => {
    const cookie = await session(base, "team-rate");
    const request = () => fetch(`${base}/api/submit`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ steps: [invoke([1], [meta("position", false, true)])] }),
    });
    assert.equal((await request()).status, 200);
    assert.equal((await request()).status, 429);
  });
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
    const cookie = await session(base, "team-exact-service");
    const targetResponse = await fetch(`${base}/api/target`, { headers: { cookie } });
    assert.equal(targetResponse.status, 200);
    const target = await targetResponse.json();
    assert.equal(target.productionReady, true);
    assert.equal(target.execution, "litesvm-exact-sbf");
    assert.match(target.programSha256, /^[0-9a-f]{64}$/);

    assert.equal((await fetch(`${base}/artifact/drift_vault.so`)).status, 401);
    const artifactResponse = await fetch(`${base}/artifact/drift_vault.so`, { headers: { cookie } });
    assert.equal(artifactResponse.status, 200);
    const artifact = Buffer.from(await artifactResponse.arrayBuffer());
    assert.equal(crypto.createHash("sha256").update(artifact).digest("hex"), target.programSha256);

    const guideResponse = await fetch(`${base}/artifact/player-guide.md`, { headers: { cookie } });
    assert.equal(guideResponse.status, 200);
    assert.match(await guideResponse.text(), /## Replay protocol/);

    const steps = rawReferenceSteps("team-exact-service");
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
    () => createDriftServer({ env: { ...env, DRIFT_REQUIRE_SHARED_STATE: "true" }, runHarness: async () => ({}) }),
    /REDIS_URL/,
  );
});
