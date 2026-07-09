import assert from "node:assert/strict";
import test from "node:test";

import { createRewardSniperServer } from "../src/server.mjs";

test("browser uses a shared authoritative service without receiving voucher authority", async (context) => {
  const app = createRewardSniperServer({ seed: "api-test", autoPhases: false });
  const baseUrl = await app.listen();
  context.after(() => app.close());

  const indexResponse = await fetch(`${baseUrl}/`);
  const index = await indexResponse.text();
  assert.equal(indexResponse.status, 200);
  assert.match(index, /prepare ticket voucher/);
  assert.doesNotMatch(index, /best inferred bin/);

  const browserScript = await (await fetch(`${baseUrl}/main.js`)).text();
  assert.doesNotMatch(browserScript, /node:crypto|market\.mjs|simulateBestTicket|issueVoucher/);
  assert.equal((await fetch(`${baseUrl}/src/market.mjs`)).status, 404);

  const unauthorized = await request(baseUrl, "/api/market");
  assert.equal(unauthorized.status, 401);

  const firstSession = await request(baseUrl, "/api/session", {
    method: "POST",
    body: { teamId: "team-browser-a" },
  });
  assert.equal(firstSession.status, 201);
  assert.equal(firstSession.body.teamId, "team-browser-a");
  assert.equal(typeof firstSession.body.accessToken, "string");

  const firstHeaders = { authorization: `Bearer ${firstSession.body.accessToken}` };
  const initialState = await request(baseUrl, "/api/market", { headers: firstHeaders });
  assert.equal(initialState.status, 200);
  assert.equal(initialState.body.phase, "commit");
  assert.equal(initialState.body.team.liquidityBalance, 3_000);
  assert.equal(hasKey(initialState.body, "secret"), false);
  assert.equal(hasKey(initialState.body, "voucherSecret"), false);

  const chosenBin = initialState.body.bins[0].id;
  const voucherResponse = await request(baseUrl, "/api/voucher", {
    method: "POST",
    headers: firstHeaders,
    body: { binId: chosenBin },
  });
  assert.equal(voucherResponse.status, 201);
  assert.equal(hasKey(voucherResponse.body, "secret"), false);
  assert.equal(hasKey(voucherResponse.body, "voucherSecret"), false);

  const action = {
    type: "ticket",
    binId: chosenBin,
    liquidity: 900,
    voucher: voucherResponse.body.voucher,
  };
  const nonce = "browser-commit-nonce";
  const commit = await request(baseUrl, "/api/commit", {
    method: "POST",
    headers: firstHeaders,
    body: { action, nonce },
  });
  assert.equal(commit.status, 201);

  const earlyReveal = await request(baseUrl, "/api/reveal", {
    method: "POST",
    headers: firstHeaders,
    body: { action, nonce },
  });
  assert.equal(earlyReveal.status, 400);
  assert.match(earlyReveal.body.error, /reveal phase is not open/);

  const secondSession = await request(baseUrl, "/api/session", {
    method: "POST",
    body: { teamId: "team-browser-b" },
  });
  const secondHeaders = { authorization: `Bearer ${secondSession.body.accessToken}` };

  const phaseTransition = app.advancePhase();
  assert.equal(phaseTransition.phase, "reveal");

  const lateCommit = await request(baseUrl, "/api/commit", {
    method: "POST",
    headers: secondHeaders,
    body: {
      action: { type: "swap", toBin: 1 },
      nonce: "late-action-nonce",
    },
  });
  assert.equal(lateCommit.status, 400);
  assert.match(lateCommit.body.error, /commit phase is not open/);

  const reveal = await request(baseUrl, "/api/reveal", {
    method: "POST",
    headers: firstHeaders,
    body: { action, nonce },
  });
  assert.equal(reveal.status, 202);
  assert.equal(reveal.body.result.accepted, true);

  const queuedState = await request(baseUrl, "/api/market", { headers: firstHeaders });
  const queuedScores = await request(baseUrl, "/api/scoreboard");
  assert.equal(queuedState.body.team.escrow, 0);
  assert.ok(queuedScores.body.every((row) => row.escrow === 0));

  const batch = app.advancePhase();
  assert.equal(batch.results[0].status, "resolved");
  const settledState = await request(baseUrl, "/api/market", { headers: firstHeaders });
  assert.equal(settledState.body.tick, initialState.body.tick + 1);
  assert.equal(settledState.body.phase, "commit");
  assert.ok(settledState.body.team.escrow > 0);

  const scores = await request(baseUrl, "/api/scoreboard");
  assert.equal(scores.body[0].teamId, "team-browser-a");
  assert.ok(scores.body[0].escrow > 0);
});

async function request(baseUrl, pathname, options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method: options.method ?? "GET",
    headers: {
      ...(options.body ? { "content-type": "application/json" } : {}),
      ...options.headers,
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const body = await response.json();
  return { status: response.status, body };
}

function hasKey(value, key) {
  if (!value || typeof value !== "object") return false;
  if (Object.hasOwn(value, key)) return true;
  return Object.values(value).some((child) => hasKey(child, key));
}
