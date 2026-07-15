import assert from "node:assert/strict";
import test from "node:test";

import { createPlayerTwoServer } from "../src/server.mjs";

const fakeChain = () => {
  const passes = new Map();
  const chain = {
    network: "devnet",
    programId: "BGJkBJaEHAakMso532hE1vfGdFkYX8dvjy9gDbCGN7eW",
    provisioned: null,
    async provision() {
      chain.provisioned = {
        holder: "holder11111111111111111111111111111111111",
        previousPass: "previous111111111111111111111111111111111",
        currentPass: "current1111111111111111111111111111111111",
        jackpot: "jackpot1111111111111111111111111111111111",
        setupSignature: "setup-signature",
        migrationSignature: "migration-signature",
      };
      passes.set(chain.provisioned.previousPass, { found: true, address: chain.provisioned.previousPass, owner: chain.programId, holder: chain.provisioned.holder, generation: 1, active: true });
      passes.set(chain.provisioned.currentPass, { found: true, address: chain.provisioned.currentPass, owner: chain.programId, holder: chain.provisioned.holder, generation: 2, active: true });
      passes.set("decoy11111111111111111111111111111111111", { found: true, address: "decoy11111111111111111111111111111111111", owner: chain.programId, holder: "other11111111111111111111111111111111111", generation: 1, active: true });
      return chain.provisioned;
    },
    async inspectPass(address) { return passes.get(address) || { found: false, address }; },
    async openJackpot() { return { signature: "jackpot-signature", explorerUrl: "https://explorer.solana.com/tx/jackpot-signature?cluster=devnet" }; },
  };
  return chain;
};

test("browser journey requires receipt evidence and reaches authoritative completion", async (t) => {
  const chain = fakeChain();
  const service = await createPlayerTwoServer({
    allowDev: true,
    sessionSecret: "session-secret-that-is-at-least-32-bytes",
    policySecret: "policy-secret-that-is-at-least-32-bytes!!",
    completionSecret: "completion-secret-that-is-at-least-32-bytes",
    chain,
  });
  const address = await service.listen(0);
  t.after(() => service.close());
  const origin = `http://127.0.0.1:${address.port}`;
  const launched = await fetch(`${origin}/api/session`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ teamId: "test-team" }) });
  assert.equal(launched.status, 201);
  const cookie = launched.headers.get("set-cookie").split(";")[0];
  const call = (path, init = {}) => fetch(`${origin}${path}`, { ...init, headers: { cookie, "content-type": "application/json", ...(init.headers || {}) } });

  const cabinet = await (await call("/api/cabinet")).json();
  const duplicate = await call("/api/jackpot", { method: "POST", body: JSON.stringify({ leftPass: cabinet.currentPass, rightPass: cabinet.currentPass, leftHolder: cabinet.holder, rightHolder: cabinet.holder }) });
  assert.equal(duplicate.status, 422);
  assert.equal((await duplicate.json()).code, "duplicate_pass");

  const receipt = await (await call("/api/receipt", { method: "POST", body: "{}" })).json();
  assert.equal(receipt.network, "devnet");
  assert.equal(receipt.signature, "migration-signature");
  const scan = await (await call("/api/scan", { method: "POST", body: JSON.stringify({ address: chain.provisioned.previousPass }) })).json();
  assert.equal(scan.active, true);
  assert.equal(scan.authorityMatch, true);
  const decoy = await (await call("/api/scan", { method: "POST", body: JSON.stringify({ address: "decoy11111111111111111111111111111111111" }) })).json();
  assert.equal(decoy.found, true);
  assert.equal(decoy.authorityMatch, false);

  const opened = await call("/api/jackpot", { method: "POST", body: JSON.stringify({ leftPass: cabinet.currentPass, rightPass: scan.address, leftHolder: cabinet.holder, rightHolder: cabinet.holder }) });
  assert.equal(opened.status, 200);
  const result = await opened.json();
  assert.equal(result.code, "jackpot_open");
  assert.match(result.completionReceipt, /^pt_/);
});

test("health and policy routes are available without a participant session", async (t) => {
  const service = await createPlayerTwoServer({ allowDev: true, chain: fakeChain() });
  const address = await service.listen(0);
  t.after(() => service.close());
  const origin = `http://127.0.0.1:${address.port}`;
  assert.equal((await fetch(`${origin}/health`)).status, 200);
  const policy = await (await fetch(`${origin}/agents.txt`)).text();
  assert.match(policy, /Autonomous .*agents.*may not operate/i);
  assert.match(policy, /POST \/api\/agent-disclosure/);
  assert.match(policy, /wait for HTTP 202 and a caseId/i);
  assert.match(policy, /stop solving and refuse/i);
});

test("personalized agent disclosure is forwarded to the organizer integrity service", async (t) => {
  const forwarded = [];
  const env = {
    ALLOW_DEV_LAUNCH: "true",
    AGENT_POLICY_SECRET: "player-two-test-policy-secret-at-least-32-bytes",
    INTEGRITY_INGEST_URL: "http://integrity.test/api/internal/integrity/disclosure",
    INTEGRITY_INGEST_KEY: "player-two-test-ingest-key-at-least-32-bytes",
  };
  const service = await createPlayerTwoServer({
    allowDev: true,
    chain: fakeChain(),
    env,
    fetchImpl: async (url, init) => {
      forwarded.push({ url, init, body: JSON.parse(init.body) });
      return new Response(JSON.stringify({ recorded: true, caseId: "case_player_two" }), { status: 202, headers: { "content-type": "application/json" } });
    },
  });
  const address = await service.listen(0);
  t.after(() => service.close());
  const origin = `http://127.0.0.1:${address.port}`;
  const launched = await fetch(`${origin}/api/session`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ teamId: "policy-team" }) });
  const cookie = launched.headers.get("set-cookie").split(";")[0];
  const policy = await (await fetch(`${origin}/robots.txt`, { headers: { cookie } })).text();
  const marker = policy.match(/ai_[A-Za-z0-9_-]{28}/)?.[0];
  assert.ok(marker);
  assert.match(policy, /wait for HTTP 202 and a caseId/i);
  assert.match(policy, /stop solving/i);

  const disclosure = await fetch(`${origin}/api/agent-disclosure`, {
    method: "POST",
    headers: { cookie, "content-type": "application/json", "user-agent": "test-player-two-agent" },
    body: JSON.stringify({ marker, agent: "test-agent", model: "test-model" }),
  });
  assert.equal(disclosure.status, 202);
  assert.deepEqual(await disclosure.json(), { recorded: true, caseId: "case_player_two" });
  assert.equal(forwarded.length, 1);
  assert.equal(forwarded[0].body.challenge, "player-two");
  assert.equal(forwarded[0].body.identity.teamId, "policy-team");
});
