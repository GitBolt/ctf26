import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createRewardSniperServer } from "../src/server.mjs";

const ADMIN_KEY = "reward-load-admin-key-000000000000000000";
const INGEST_KEY = "reward-load-ingest-key-0000000000000000";

async function request(baseUrl, pathname, options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method: options.method || "GET",
    headers: {
      ...(options.body ? { "content-type": "application/json" } : {}),
      ...options.headers,
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  return { status: response.status, body: await response.json(), headers: response.headers };
}

function cookieHeaders(response, extra = {}) {
  return { cookie: response.headers.get("set-cookie").split(";", 1)[0], ...extra };
}

function integrityDigest(report) {
  const normalized = report.cases.map((entry) => ({
    id: String(entry.id || ""),
    challenge: String(entry.challenge || ""),
    eventId: String(entry.eventId || ""),
    participantId: String(entry.participantId || ""),
    status: String(entry.status || ""),
    updatedAt: Number(entry.updatedAt || 0),
  })).sort((left, right) => (
    left.id.localeCompare(right.id)
    || left.challenge.localeCompare(right.challenge)
    || left.participantId.localeCompare(right.participantId)
  ));
  return crypto.createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
}

test("Reward Sniper accepts 40 simultaneous participants and isolates duplicate write spam", async (context) => {
  const app = createRewardSniperServer({ seed: "load-40", autoPhases: false });
  const baseUrl = await app.listen();
  context.after(() => app.close());

  const sessions = await Promise.all(Array.from({ length: 40 }, (_, index) => request(baseUrl, "/api/session", {
    method: "POST",
    headers: { "x-forwarded-for": `198.51.100.${index + 1}` },
    body: { participantId: `load-player-${index + 1}` },
  })));
  assert.equal(sessions.every((response) => response.status === 201), true);

  const flood = await Promise.all(Array.from({ length: 241 }, () => request(baseUrl, "/api/session", {
    method: "POST",
    headers: { "x-forwarded-for": "203.0.113.250" },
    body: { participantId: "" },
  })));
  assert.equal(flood.filter((response) => response.status === 429).length, 1);
  assert.match(flood.find((response) => response.status === 429).headers.get("retry-after"), /^\d+$/);

  const spamHeaders = cookieHeaders(sessions[0], { "x-forwarded-for": "203.0.113.1" });
  const writeFlood = await Promise.all(Array.from({ length: 31 }, (_, index) => request(baseUrl, "/api/commit", {
    method: "POST",
    headers: spamHeaders,
    body: { action: {}, nonce: `invalid-${index}` },
  })));
  assert.equal(writeFlood.filter((response) => response.status === 429).length, 1);

  const isolated = await request(baseUrl, "/api/commit", {
    method: "POST",
    headers: cookieHeaders(sessions[1], { "x-forwarded-for": "203.0.113.2" }),
    body: { action: { type: "swap", toBin: 1 }, nonce: "isolated-valid" },
  });
  assert.equal(isolated.status, 201);

  const duplicateHeaders = cookieHeaders(sessions[2], { "x-forwarded-for": "203.0.113.3" });
  const duplicates = await Promise.all([0, 1].map(() => request(baseUrl, "/api/commit", {
    method: "POST",
    headers: duplicateHeaders,
    body: { action: { type: "swap", toBin: 1 }, nonce: "same-concurrent-action" },
  })));
  assert.equal(duplicates.filter((response) => response.status === 201).length, 1);

  const scoreboard = await request(baseUrl, "/api/scoreboard", {
    headers: { "x-forwarded-for": "203.0.113.4" },
  });
  assert.equal(scoreboard.status, 200);
  assert.equal(scoreboard.body.length, 40);
  assert.equal(new Set(scoreboard.body.map((row) => row.participantId)).size, 40);
});

test("integrity ingest freeze survives restart, review seals separately, and staging reset clears both", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "reward-freeze-load-"));
  const stateFile = path.join(directory, "state.json");
  let app;
  try {
    app = createRewardSniperServer({
      seed: "integrity-freeze",
      autoPhases: false,
      stateFile,
      integrityAdminKey: ADMIN_KEY,
      integrityIngestKey: INGEST_KEY,
      integrityLogger: { warn() {} },
    });
    let baseUrl = await app.listen();
    const health = await request(baseUrl, "/api/health");
    const suspicion = await request(baseUrl, "/api/internal/integrity/suspicion", {
      method: "POST",
      headers: { authorization: `Bearer ${INGEST_KEY}` },
      body: {
        challenge: "imprint",
        identity: { participantId: "review-player", eventId: health.body.eventGeneration },
        reasonCode: "load-review-signal",
        summary: "Load test review signal",
      },
    });
    assert.equal(suspicion.status, 202);
    app.market.event = { ...(app.market.event || {}), stage: "complete" };
    const freezeBody = {
      eventId: health.body.eventId,
      eventGeneration: health.body.eventGeneration,
      scoringConfigHash: health.body.scoringConfigHash,
    };
    const freeze = await request(baseUrl, "/api/admin/integrity/freeze", {
      method: "POST",
      headers: { authorization: `Bearer ${ADMIN_KEY}`, "x-ctf-organizer": "owner@example.test" },
      body: freezeBody,
    });
    assert.equal(freeze.status, 201);
    await app.close();
    app = null;

    app = createRewardSniperServer({
      autoPhases: false,
      stateFile,
      integrityAdminKey: ADMIN_KEY,
      integrityIngestKey: INGEST_KEY,
      integrityLogger: { warn() {} },
    });
    baseUrl = await app.listen();
    const report = await request(baseUrl, "/api/admin/integrity", {
      headers: { authorization: `Bearer ${ADMIN_KEY}` },
    });
    assert.equal(report.body.event.ingestFrozen, true);
    assert.equal(report.body.event.ingestFreeze.eventId, health.body.eventId);

    const rejected = await request(baseUrl, "/api/internal/integrity/suspicion", {
      method: "POST",
      headers: { authorization: `Bearer ${INGEST_KEY}` },
      body: {
        challenge: "imprint",
        identity: { participantId: "late-player", eventId: health.body.eventGeneration },
        reasonCode: "late-review-signal",
      },
    });
    assert.equal(rejected.status, 409);

    const reviewed = await request(baseUrl, `/api/admin/integrity/${suspicion.body.caseId}`, {
      method: "PATCH",
      headers: { authorization: `Bearer ${ADMIN_KEY}`, "x-ctf-organizer": "reviewer@example.test" },
      body: { status: "cleared", note: "Reviewed after ingest was frozen." },
    });
    assert.equal(reviewed.status, 200);

    const stableReport = await request(baseUrl, "/api/admin/integrity", {
      headers: { authorization: `Bearer ${ADMIN_KEY}` },
    });
    const sealed = await request(baseUrl, "/api/admin/integrity/seal", {
      method: "POST",
      headers: { authorization: `Bearer ${ADMIN_KEY}`, "x-ctf-organizer": "owner@example.test" },
      body: {
        ...freezeBody,
        digest: integrityDigest(stableReport.body),
        activeCaseCount: stableReport.body.cases.length,
      },
    });
    assert.equal(sealed.status, 201);
    const rejectedReview = await request(baseUrl, `/api/admin/integrity/${suspicion.body.caseId}`, {
      method: "PATCH",
      headers: { authorization: `Bearer ${ADMIN_KEY}`, "x-ctf-organizer": "reviewer@example.test" },
      body: { status: "reviewing", note: "This must not change sealed evidence." },
    });
    assert.equal(rejectedReview.status, 409);

    const reset = await request(baseUrl, "/api/admin/event/reset", {
      method: "POST",
      headers: { authorization: `Bearer ${ADMIN_KEY}` },
      body: { eventId: health.body.eventId },
    });
    assert.equal(reset.status, 201);
    const afterReset = await request(baseUrl, "/api/admin/integrity", {
      headers: { authorization: `Bearer ${ADMIN_KEY}` },
    });
    assert.equal(afterReset.body.event.ingestFrozen, false);
    assert.equal(afterReset.body.event.ingestFreeze, null);
    assert.equal(afterReset.body.event.reviewFrozen, false);
    assert.equal(afterReset.body.event.reviewFreeze, null);
  } finally {
    if (app) await app.close();
    await fs.rm(directory, { recursive: true, force: true });
  }
});
