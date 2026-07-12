import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { issueParticipantTicket } from "@ctf26/participant-ticket";

import { createRewardSniperServer } from "../src/server.mjs";

const TICKET_SECRET = "reward-sniper-test-ticket-secret-000000000000";
const INTEGRITY_KEY = "reward-sniper-test-integrity-key-000000000000";

test("production image contains only the live UI, not the separately distributed player package", async () => {
  const dockerfile = await fs.readFile(new URL("../Dockerfile", import.meta.url), "utf8");
  assert.match(dockerfile, /COPY apps\/reward-sniper\/web\/index\.html \.\/web\/index\.html/);
  assert.match(dockerfile, /COPY apps\/reward-sniper\/web\/main\.js \.\/web\/main\.js/);
  assert.match(dockerfile, /COPY apps\/reward-sniper\/web\/style\.css \.\/web\/style\.css/);
  assert.doesNotMatch(dockerfile, /COPY apps\/reward-sniper \.\//);
  assert.doesNotMatch(dockerfile, /player-kit|PLAYER_GUIDE|sdk\.mjs/);
});

test("browser uses a shared authoritative service without receiving voucher authority", async (context) => {
  const app = createRewardSniperServer({ seed: "api-test", autoPhases: false });
  const baseUrl = await app.listen();
  context.after(() => app.close());

  const health = await request(baseUrl, "/api/health");
  assert.equal(health.status, 200);
  assert.equal(health.body.ok, true);

  const indexResponse = await fetch(`${baseUrl}/`);
  const index = await indexResponse.text();
  assert.equal(indexResponse.status, 200);
  assert.match(index, /Sniper ticket/);
  assert.doesNotMatch(index, /best inferred bin/);

  const nestedIndex = await fetch(`${baseUrl}/web/`);
  assert.equal(nestedIndex.status, 200);
  assert.match(await nestedIndex.text(), /Reward Sniper/);

  const browserScript = await (await fetch(`${baseUrl}/main.js`)).text();
  assert.doesNotMatch(browserScript, /node:crypto|market\.mjs|simulateBestTicket|issueVoucher/);
  assert.doesNotMatch(browserScript, /localStorage|accessToken|authorization/i);
  assert.doesNotMatch(index, /Player guide|Player kit|PLAYER_GUIDE|reward-sniper-player-kit/);
  assert.equal((await fetch(`${baseUrl}/sdk.mjs`)).status, 404);
  assert.equal((await fetch(`${baseUrl}/PLAYER_GUIDE.md`)).status, 404);
  assert.equal((await fetch(`${baseUrl}/reward-sniper-player-kit.tar.gz`)).status, 404);
  assert.equal((await fetch(`${baseUrl}/src/market.mjs`)).status, 404);

  const unauthorized = await request(baseUrl, "/api/market");
  assert.equal(unauthorized.status, 401);

  const firstSession = await request(baseUrl, "/api/session", {
    method: "POST",
    body: { teamId: "team-browser-a" },
  });
  assert.equal(firstSession.status, 201);
  assert.equal(firstSession.body.teamId, "team-browser-a");
  assert.equal(Object.hasOwn(firstSession.body, "accessToken"), false);
  assert.equal(firstSession.body.eventId, health.body.eventId);

  const firstHeaders = cookieHeaders(firstSession);
  const initialState = await request(baseUrl, "/api/market", { headers: firstHeaders });
  assert.equal(initialState.status, 200);
  assert.equal(initialState.body.phase, "commit");
  assert.equal(initialState.body.team.liquidityBalance, 3_000);
  assert.equal(Object.hasOwn(initialState.body.bins[0], "staleTicks"), false);
  assert.equal(Object.hasOwn(initialState.body.bins[0], "window"), false);
  assert.equal(initialState.body.eventId, health.body.eventId);
  assert.equal(Array.isArray(initialState.body.team.telemetry.rewardSamples), true);
  assert.equal(hasKey(initialState.body, "rewardRate"), false);
  assert.equal(hasKey(initialState.body, "secret"), false);
  assert.equal(hasKey(initialState.body, "voucherSecret"), false);

  const chosenBin = initialState.body.bins[0].id;
  const oversizedOrder = await request(baseUrl, "/api/order", {
    method: "POST",
    headers: firstHeaders,
    body: { type: "ticket", binId: chosenBin, liquidity: 1_001, nonce: "oversized-order-nonce" },
  });
  assert.equal(oversizedOrder.status, 400);

  const nonce = "browser-commit-nonce";
  const orderResponse = await request(baseUrl, "/api/order", {
    method: "POST",
    headers: firstHeaders,
    body: { type: "ticket", binId: chosenBin, liquidity: 900, nonce },
  });
  assert.equal(orderResponse.status, 201);
  assert.equal(hasKey(orderResponse.body, "secret"), false);
  assert.equal(hasKey(orderResponse.body, "voucherSecret"), false);
  const action = orderResponse.body.action;

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
  const secondHeaders = cookieHeaders(secondSession);

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
  assert.equal(hasKey(settledState.body, "fairReward"), false);

  const scores = await request(baseUrl, "/api/scoreboard");
  assert.equal(scores.body[0].teamId, "team-browser-a");
  assert.ok(scores.body[0].escrow > 0);
  assert.equal(scores.body[0].rank, 1);
});

test("production sessions require one-time audience-bound portal tickets", async (context) => {
  const app = createRewardSniperServer({
    seed: "ticket-auth",
    autoPhases: false,
    ticketSecret: TICKET_SECRET,
    allowDevSessions: false,
    integrityAdminKey: INTEGRITY_KEY,
  });
  const baseUrl = await app.listen();
  context.after(() => app.close());

  const localBypass = await request(baseUrl, "/api/session", {
    method: "POST",
    body: { teamId: "team-bypass" },
  });
  assert.equal(localBypass.status, 401);

  const ticket = issueParticipantTicket(
    { audience: "reward-sniper", participantId: "player-a", teamId: "team-portal-a", email: "player-a@example.test" },
    TICKET_SECRET,
    { jti: "reward-sniper-auth-jti-1" },
  );
  const launched = await request(baseUrl, "/api/session", { method: "POST", body: { ticket } });
  assert.equal(launched.status, 201);
  assert.equal(launched.body.teamId, "team-portal-a");
  assert.equal(launched.body.launchMode, "portal");
  assert.equal(Object.hasOwn(launched.body, "accessToken"), false);
  await request(baseUrl, "/api/market", { headers: cookieHeaders(launched) });
  const identityReport = await request(baseUrl, "/api/admin/integrity", {
    headers: { authorization: `Bearer ${INTEGRITY_KEY}` },
  });
  assert.equal(identityReport.body.profiles[0].email, "player-a@example.test");

  const replay = await request(baseUrl, "/api/session", { method: "POST", body: { ticket } });
  assert.equal(replay.status, 409);

  const relaunchTicket = issueParticipantTicket(
    { audience: "reward-sniper", participantId: "player-a", teamId: "team-portal-a" },
    TICKET_SECRET,
    { jti: "reward-sniper-auth-jti-2" },
  );
  const relaunched = await request(baseUrl, "/api/session", {
    method: "POST",
    body: { ticket: relaunchTicket },
  });
  assert.equal(relaunched.status, 200);
  assert.notEqual(relaunched.headers.get("set-cookie"), launched.headers.get("set-cookie"));

  const wrongAudience = issueParticipantTicket(
    { audience: "imprint", participantId: "player-a", teamId: "team-portal-a" },
    TICKET_SECRET,
    { jti: "reward-sniper-auth-jti-3" },
  );
  const rejected = await request(baseUrl, "/api/session", {
    method: "POST",
    body: { ticket: wrongAudience },
  });
  assert.equal(rejected.status, 401);
});

test("rehearsal sessions require both the server switch and its secret key", async (context) => {
  const rehearsalKey = "reward-sniper-rehearsal-key-0000000000000000";
  const app = createRewardSniperServer({
    seed: "rehearsal-auth",
    autoPhases: false,
    ticketSecret: TICKET_SECRET,
    allowDevSessions: false,
    allowDirectTestAccess: true,
    directTestAccessKey: rehearsalKey,
  });
  const baseUrl = await app.listen();
  context.after(() => app.close());

  const missingKey = await request(baseUrl, "/api/session", {
    method: "POST",
    body: { directTest: true, teamId: "test-team" },
  });
  assert.equal(missingKey.status, 401);

  const wrongKey = await request(baseUrl, "/api/session", {
    method: "POST",
    body: { directTest: true, teamId: "test-team", testKey: `${rehearsalKey}-wrong` },
  });
  assert.equal(wrongKey.status, 401);

  const launched = await request(baseUrl, "/api/session", {
    method: "POST",
    body: { directTest: true, teamId: "test-team", testKey: rehearsalKey },
  });
  assert.equal(launched.status, 201);
  assert.equal(launched.body.launchMode, "direct-test");
});

test("bounded rehearsal clock waits for the first participant session", async (context) => {
  const app = createRewardSniperServer({
    seed: "first-session-clock",
    autoPhases: true,
    startOnFirstSession: true,
    practiceRounds: 1,
    scoredRounds: 3,
    commitDurationMs: 60_000,
    revealDurationMs: 60_000,
  });
  const baseUrl = await app.listen();
  context.after(() => app.close());

  const before = await request(baseUrl, "/api/health");
  assert.equal(before.body.phaseEndsAt, null);
  assert.equal(before.body.eventStage, "practice");

  const session = await request(baseUrl, "/api/session", { method: "POST", body: { teamId: "clock-team" } });
  const market = await request(baseUrl, "/api/market", {
    headers: cookieHeaders(session),
  });
  assert.equal(typeof market.body.eventStartedAt, "number");
  assert.equal(typeof market.body.phaseEndsAt, "number");
  assert.equal(market.body.event.stage, "practice");
});

test("scheduled events authenticate players in a waiting room but reject early orders", async (context) => {
  const eventStartsAt = Date.now() + 60_000;
  const app = createRewardSniperServer({
    seed: "scheduled-waiting-room",
    autoPhases: true,
    eventStartsAt,
    practiceRounds: 1,
    scoredRounds: 3,
  });
  const baseUrl = await app.listen();
  context.after(() => app.close());

  const session = await request(baseUrl, "/api/session", { method: "POST", body: { teamId: "waiting-team" } });
  const headers = cookieHeaders(session);
  const market = await request(baseUrl, "/api/market", { headers });
  assert.equal(market.body.eventStartedAt, null);
  assert.equal(market.body.eventStartsAt, eventStartsAt);
  assert.equal(market.body.phaseEndsAt, null);

  const earlyOrder = await request(baseUrl, "/api/order", {
    method: "POST",
    headers,
    body: { type: "ticket", binId: 0, liquidity: 100, nonce: "too-early" },
  });
  assert.equal(earlyOrder.status, 409);
  assert.equal(earlyOrder.body.error, "event has not started");
});

test("event configuration cannot combine participant-triggered and scheduled starts", () => {
  assert.throws(
    () => createRewardSniperServer({ startOnFirstSession: true, eventStartsAt: Date.now() + 60_000 }),
    /choose either first-session start or a scheduled event start/,
  );
});

test("browser sessions resume from an HttpOnly cookie without reusing the launch ticket", async (context) => {
  const app = createRewardSniperServer({
    seed: "cookie-resume",
    autoPhases: false,
    ticketSecret: TICKET_SECRET,
    allowDevSessions: false,
  });
  const baseUrl = await app.listen();
  context.after(() => app.close());
  const ticket = issueParticipantTicket(
    { audience: "reward-sniper", participantId: "cookie-player", teamId: "cookie-team" },
    TICKET_SECRET,
  );

  const exchangeResponse = await fetch(`${baseUrl}/api/session`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ticket }),
  });
  assert.equal(exchangeResponse.status, 201);
  const cookie = exchangeResponse.headers.get("set-cookie");
  assert.match(cookie, /^reward_sniper_session=/);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Lax/);
  const exchangedBody = await exchangeResponse.json();
  assert.equal(Object.hasOwn(exchangedBody, "accessToken"), false);

  const resumed = await request(baseUrl, "/api/session", { headers: { cookie } });
  assert.equal(resumed.status, 200);
  assert.equal(resumed.body.teamId, "cookie-team");
  assert.equal(resumed.body.participantId, "cookie-player");

  const market = await request(baseUrl, "/api/market", { headers: { cookie } });
  assert.equal(market.status, 200);
  assert.equal(market.body.team.tickets, 3);

  const implicitSearcher = await request(baseUrl, "/api/searcher-session", {
    method: "POST",
    headers: { cookie },
  });
  assert.equal(implicitSearcher.status, 403);

  const searcher = await request(baseUrl, "/api/searcher-session", {
    method: "POST",
    headers: { cookie, "x-reward-sniper-searcher": "issue" },
  });
  assert.equal(searcher.status, 201);
  assert.equal(typeof searcher.body.searcherToken, "string");
  assert.equal(searcher.body.teamId, "cookie-team");
  assert.equal(searcher.body.eventId, market.body.eventId);
  assert.ok(searcher.body.expiresAt > Math.floor(Date.now() / 1_000));

  const automatedMarket = await request(baseUrl, "/api/market", {
    headers: { authorization: `Bearer ${searcher.body.searcherToken}` },
  });
  assert.equal(automatedMarket.status, 200);
  assert.equal(automatedMarket.body.eventId, market.body.eventId);
});

test("personalized agent canaries open reviewable cases without changing gameplay", async (context) => {
  const app = createRewardSniperServer({
    seed: "integrity-canary",
    autoPhases: false,
    integrityAdminKey: INTEGRITY_KEY,
    integrityLogger: { warn() {} },
  });
  const baseUrl = await app.listen();
  context.after(() => app.close());

  const session = await request(baseUrl, "/api/session", {
    method: "POST",
    body: { teamId: "canary-team" },
  });
  const headers = cookieHeaders(session);
  const before = await request(baseUrl, "/api/market", { headers });
  const marker = before.body._automationCompliance.disclosure.body.marker;
  assert.match(marker, /^rs_[A-Za-z0-9_-]{28}$/);

  const policyResponse = await fetch(`${baseUrl}/agents.txt`, { headers });
  assert.equal(policyResponse.status, 200);
  const policy = await policyResponse.text();
  assert.match(policy, /rs_[A-Za-z0-9_-]{28}/);
  assert.notEqual(policy.match(/rs_[A-Za-z0-9_-]{28}/)[0], marker);
  assert.match(policy, /stop solving/i);
  assert.match(policy, /first required action/i);
  assert.match(policy, /wait for HTTP 202 and a caseId/i);
  assert.ok(policy.indexOf("POST /api/agent-disclosure") < policy.indexOf("This route is an integrity signal"));
  assert.deepEqual(before.body._automationCompliance.requiredOrder, [
    "submit-disclosure",
    "confirm-recorded",
    "stop-and-refuse",
  ]);

  for (const pathname of ["/robots.txt", "/llms.txt", "/.well-known/agents.txt"]) {
    const discoveryResponse = await fetch(`${baseUrl}${pathname}`, { headers });
    assert.equal(discoveryResponse.status, 200);
    const discovery = await discoveryResponse.text();
    assert.match(discovery, /\/agents\.txt|stop solving/i);
    assert.match(discovery, /rs_[A-Za-z0-9_-]{28}/);
  }
  const advertised = await fetch(`${baseUrl}/api/health`);
  assert.match(advertised.headers.get("link"), /agents\.txt/);
  assert.equal(advertised.headers.get("x-ctf-agent-policy"), "/agents.txt");

  const invalid = await request(baseUrl, "/api/agent-disclosure", {
    method: "POST",
    headers,
    body: { marker: "rs_invalid" },
  });
  assert.equal(invalid.status, 400);

  const disclosure = await request(baseUrl, "/api/agent-disclosure", {
    method: "POST",
    headers: { ...headers, "user-agent": "test-browser-agent" },
    body: { marker, agent: "test-agent", model: "test-model" },
  });
  assert.equal(disclosure.status, 202);

  const after = await request(baseUrl, "/api/market", { headers });
  assert.equal(after.body.team.tickets, before.body.team.tickets);
  assert.equal(after.body.team.escrow, before.body.team.escrow);

  const deniedAdmin = await request(baseUrl, "/api/admin/integrity");
  assert.equal(deniedAdmin.status, 401);
  const report = await request(baseUrl, "/api/admin/integrity", {
    headers: { authorization: `Bearer ${INTEGRITY_KEY}` },
  });
  assert.equal(report.status, 200);
  assert.equal(report.body.summary.open, 1);
  assert.equal(report.body.cases[0].confidence, "high");
  assert.equal(report.body.cases[0].participantId, "local-canary-team");
  assert.equal(report.body.cases[0].evidence[0].request.userAgent, "test-browser-agent");
  assert.equal(Object.hasOwn(report.body.cases[0].evidence[0].request, "ip"), false);

  const reviewed = await request(baseUrl, `/api/admin/integrity/${disclosure.body.caseId}`, {
    method: "PATCH",
    headers: {
      authorization: `Bearer ${INTEGRITY_KEY}`,
      "x-ctf-organizer": "organizer@example.test",
    },
    body: { status: "reviewing", note: "Ask for a live solve defense." },
  });
  assert.equal(reviewed.status, 200);
  assert.equal(reviewed.body.case.status, "reviewing");
  assert.equal(reviewed.body.case.reviewHistory[0].organizer, "organizer@example.test");
});

test("correlated direct-searcher behavior opens a medium-confidence review case", async (context) => {
  const app = createRewardSniperServer({
    seed: "integrity-behavior",
    autoPhases: false,
    integrityAdminKey: INTEGRITY_KEY,
    integrityLogger: { warn() {} },
  });
  const baseUrl = await app.listen();
  context.after(() => app.close());

  const session = await request(baseUrl, "/api/session", {
    method: "POST",
    body: { teamId: "behavior-team" },
  });
  const cookie = cookieHeaders(session).cookie;
  const searcher = await request(baseUrl, "/api/searcher-session", {
    method: "POST",
    headers: { cookie, "x-reward-sniper-searcher": "issue" },
  });
  const headers = { authorization: `Bearer ${searcher.body.searcherToken}` };
  const market = await request(baseUrl, "/api/market", { headers });
  const nonce = "integrity-behavior-nonce";
  const order = await request(baseUrl, "/api/order", {
    method: "POST",
    headers,
    body: { type: "ticket", binId: market.body.bins[0].id, liquidity: 900, nonce },
  });
  app.advancePhase();
  const reveal = await request(baseUrl, "/api/reveal", {
    method: "POST",
    headers,
    body: { action: order.body.action, nonce },
  });
  assert.equal(reveal.status, 202);

  const report = await request(baseUrl, "/api/admin/integrity", {
    headers: { authorization: `Bearer ${INTEGRITY_KEY}` },
  });
  const behavioralCase = report.body.cases.find((entry) => entry.reasonCode === "autonomous-workflow-pattern");
  assert.equal(behavioralCase.confidence, "medium");
  assert.match(behavioralCase.summary, /author-led solve review/);
});

test("replaying a browser-scoped cookie token through Bearer API automation is reviewable", async (context) => {
  const app = createRewardSniperServer({
    seed: "integrity-browser-token-replay",
    autoPhases: false,
    integrityAdminKey: INTEGRITY_KEY,
    integrityLogger: { warn() {} },
  });
  const baseUrl = await app.listen();
  context.after(() => app.close());

  const session = await request(baseUrl, "/api/session", {
    method: "POST",
    body: { teamId: "replayed-browser-team" },
  });
  const cookie = cookieHeaders(session).cookie;
  const browserToken = decodeURIComponent(cookie.slice(cookie.indexOf("=") + 1));
  const headers = { authorization: `Bearer ${browserToken}` };
  const market = await request(baseUrl, "/api/market", { headers });
  const nonce = "browser-token-replay-nonce";
  const order = await request(baseUrl, "/api/order", {
    method: "POST",
    headers,
    body: { type: "ticket", binId: market.body.bins[0].id, liquidity: 900, nonce },
  });
  app.advancePhase();
  await request(baseUrl, "/api/reveal", {
    method: "POST",
    headers,
    body: { action: order.body.action, nonce },
  });

  const report = await request(baseUrl, "/api/admin/integrity", {
    headers: { authorization: `Bearer ${INTEGRITY_KEY}` },
  });
  const behavioralCase = report.body.cases.find((entry) => entry.reasonCode === "autonomous-workflow-pattern");
  assert.equal(behavioralCase.confidence, "medium");
  const signals = behavioralCase.evidence[0].details.signals;
  assert.ok(signals.includes("browser-session-token-replayed-as-bearer"));
  assert.ok(signals.includes("repeated-direct-browser-token-actions"));
});

test("direct non-browser automation with an extracted browser cookie is reviewable", async (context) => {
  const app = createRewardSniperServer({
    seed: "integrity-cookie-automation",
    autoPhases: false,
    integrityAdminKey: INTEGRITY_KEY,
    integrityLogger: { warn() {} },
  });
  const baseUrl = await app.listen();
  context.after(() => app.close());

  const session = await request(baseUrl, "/api/session", {
    method: "POST",
    body: { teamId: "cookie-automation-team" },
  });
  const headers = { cookie: cookieHeaders(session).cookie, "user-agent": "node-fetch-searcher" };
  let market;
  for (let index = 0; index < 7; index += 1) market = await request(baseUrl, "/api/market", { headers });

  for (let index = 0; index < 2; index += 1) {
    const nonce = `cookie-automation-${index}`;
    const order = await request(baseUrl, "/api/order", {
      method: "POST",
      headers,
      body: { type: "ticket", binId: market.body.bins[index].id, liquidity: 700, nonce },
    });
    app.advancePhase();
    await request(baseUrl, "/api/reveal", {
      method: "POST",
      headers,
      body: { action: order.body.action, nonce },
    });
    app.advancePhase();
  }

  const report = await request(baseUrl, "/api/admin/integrity", {
    headers: { authorization: `Bearer ${INTEGRITY_KEY}` },
  });
  const behavioralCase = report.body.cases.find((entry) => entry.reasonCode === "autonomous-workflow-pattern");
  assert.equal(behavioralCase.confidence, "medium");
  const signals = behavioralCase.evidence[0].details.signals;
  assert.ok(signals.includes("browser-cookie-used-by-non-browser-client"));
  assert.ok(signals.includes("browser-actions-without-correlated-ui-controls"));
  assert.ok(signals.includes("subsecond-market-polling"));
});

test("organizer reset archives a completed event and preserves integrity evidence", async (context) => {
  const app = createRewardSniperServer({
    seed: "organizer-reset",
    autoPhases: false,
    integrityAdminKey: INTEGRITY_KEY,
    integrityLogger: { warn() {} },
  });
  const baseUrl = await app.listen();
  context.after(() => app.close());

  const session = await request(baseUrl, "/api/session", {
    method: "POST",
    body: { teamId: "reset-team" },
  });
  const headers = cookieHeaders(session);
  const before = await request(baseUrl, "/api/market", { headers });
  const disclosure = await request(baseUrl, "/api/agent-disclosure", {
    method: "POST",
    headers,
    body: { marker: before.body._automationCompliance.disclosure.body.marker, agent: "reset-test" },
  });
  assert.equal(disclosure.status, 202);
  app.market.event = { ...(app.market.event ?? {}), stage: "complete" };

  const denied = await request(baseUrl, "/api/admin/event/reset", {
    method: "POST",
    body: { eventId: before.body.eventId },
  });
  assert.equal(denied.status, 401);
  const reset = await request(baseUrl, "/api/admin/event/reset", {
    method: "POST",
    headers: { authorization: `Bearer ${INTEGRITY_KEY}` },
    body: { eventId: before.body.eventId },
  });
  assert.equal(reset.status, 201);
  assert.notEqual(reset.body.event.eventId, before.body.eventId);
  assert.equal(reset.body.archivedEventId, before.body.eventId);

  const staleSession = await request(baseUrl, "/api/market", { headers });
  assert.equal(staleSession.status, 401);
  const report = await request(baseUrl, "/api/admin/integrity", {
    headers: { authorization: `Bearer ${INTEGRITY_KEY}` },
  });
  assert.equal(report.body.cases.some((entry) => entry.id === disclosure.body.caseId), true);
  assert.equal(report.body.event.archivedEvents, 1);
});

test("durable state restores teams, sessions, scores, and voucher authority", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "reward-sniper-state-"));
  const stateFile = path.join(directory, "state.json");
  let first;
  let second;
  try {
    first = createRewardSniperServer({ seed: "persisted-round", autoPhases: false, stateFile });
    const firstUrl = await first.listen();
    const created = await request(firstUrl, "/api/session", {
      method: "POST",
      body: { teamId: "team-persisted" },
    });
    const headers = cookieHeaders(created);
    const state = await request(firstUrl, "/api/market", { headers });
    const order = await request(firstUrl, "/api/order", {
      method: "POST",
      headers,
      body: {
        type: "ticket",
        binId: state.body.bins[0].id,
        liquidity: 700,
        nonce: "persisted-action-nonce",
      },
    });
    first.advancePhase();
    const reveal = await request(firstUrl, "/api/reveal", {
      method: "POST",
      headers,
      body: { action: order.body.action, nonce: "persisted-action-nonce" },
    });
    assert.equal(reveal.status, 202);
    first.advancePhase();
    await first.close();
    first = null;

    const persistedState = JSON.parse(await fs.readFile(stateFile, "utf8"));
    assert.ok(persistedState.auditLog.some((entry) => entry.action === "order-committed:ticket"));
    assert.ok(persistedState.auditLog.some((entry) => entry.action === "reveal-accepted:ticket"));
    assert.ok(persistedState.auditLog.every((entry) => entry.participantId === "local-team-persisted"));
    assert.equal(Array.isArray(persistedState.integrityCases), true);
    assert.equal(typeof persistedState.integrityProfiles, "object");

    second = createRewardSniperServer({ autoPhases: false, stateFile });
    const secondUrl = await second.listen();
    const restored = await request(secondUrl, "/api/market", { headers });
    assert.equal(restored.status, 200);
    assert.equal(restored.body.team.tickets, 2);
    assert.ok(restored.body.team.escrow > 0);
    const restoredScores = await request(secondUrl, "/api/scoreboard");
    assert.equal(restoredScores.body[0].teamId, "team-persisted");
    assert.equal(restoredScores.body[0].escrow, restored.body.team.escrow);
  } finally {
    if (first) await first.close();
    if (second) await second.close();
    await fs.rm(directory, { recursive: true, force: true });
  }
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
  return { status: response.status, body, headers: response.headers };
}

function cookieHeaders(response) {
  const cookie = response.headers.get("set-cookie");
  assert.equal(typeof cookie, "string");
  return { cookie: cookie.split(";", 1)[0] };
}

function hasKey(value, key) {
  if (!value || typeof value !== "object") return false;
  if (Object.hasOwn(value, key)) return true;
  return Object.values(value).some((child) => hasKey(child, key));
}
