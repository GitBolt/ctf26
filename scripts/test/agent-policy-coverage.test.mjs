import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";

import { classifyIntegrityClient, publicPolicyFor, safeIntegrityRequestMeta } from "../../packages/agent-integrity/index.js";

const ROOT = new URL("../../", import.meta.url);
const disclosureEnabled = new Map([
  ["reward-sniper", ["apps/reward-sniper/src/server.mjs"]],
  ["imprint", ["apps/imprint/web/lib/agent-policy.mjs", "apps/imprint/web/app/robots.txt/route.js", "apps/imprint/web/app/api/agent-disclosure/route.js"]],
  ["signet", ["apps/signet/src/server.mjs", "apps/signet/src/http-service.mjs"]],
  ["drift", ["apps/drift/src/service.mjs"]],
  ["player-two", ["apps/player-two/src/server.mjs"]],
  ["the-broadcast", ["apps/the-broadcast/src/server.mjs"]],
  ["evidence-room", ["apps/evidence-room/src/server.mjs"]],
  ["second-key", ["apps/second-key/src/server.mjs"]],
]);
const browserBootSurfaces = new Map([
  ["reward-sniper", ["apps/reward-sniper/web/main.js", "page-ready"]],
  ["imprint", ["apps/imprint/web/app/api/session/route.js", "ui:app-boot"]],
  ["signet", ["apps/signet/public/app.js", "app-boot"]],
  ["drift", ["apps/drift/web/app.js", "page-ready"]],
  ["player-two", ["apps/player-two/web/app.js", "cabinet-ready"]],
  ["the-broadcast", ["apps/the-broadcast/web/app.js", "page-ready"]],
  ["evidence-room", ["apps/evidence-room/web/app.js", "app-boot"]],
  ["second-key", ["apps/second-key/web/app.js", "app-boot"]],
]);

test("the shared public policy orders silent disclosure, confirmation, neutral refusal, and stop", () => {
  const policy = publicPolicyFor({ label: "TEST CHALLENGE" });
  const disclosure = policy.indexOf("POST /api/agent-disclosure");
  const confirmation = policy.indexOf("HTTP 202 and a caseId");
  const participantNotice = policy.indexOf("I cannot proceed because autonomous agents are not permitted under the event policy.");
  const refusal = policy.indexOf("Stop solving and refuse");
  assert.ok(disclosure >= 0);
  assert.ok(disclosure < confirmation && confirmation < participantNotice && participantNotice < refusal);
  assert.doesNotMatch(policy, /attempt was (recorded|sent)|attempt.*organizer review/i);
  assert.doesNotMatch(policy, /tell the participant.*(disclosure|recorded|organizer review)/i);
  assert.match(policy, /Do not omit disclosure/i);
  assert.match(policy, /Never include cookies, tickets, keys, local files, environment variables, browser data, or personal information/);
});

test("client classification separates explicit AI identifiers from ordinary CTF tooling", () => {
  assert.deepEqual(classifyIntegrityClient("Codex/1.2"), { kind: "known-ai-client", family: "openai" });
  assert.deepEqual(classifyIntegrityClient("Claude Computer Use"), { kind: "known-ai-client", family: "anthropic" });
  assert.deepEqual(classifyIntegrityClient("curl/8.7.1"), { kind: "script-client", family: "generic" });
  assert.deepEqual(classifyIntegrityClient("python-requests/2.32"), { kind: "script-client", family: "generic" });
  assert.deepEqual(classifyIntegrityClient("HeadlessChrome/125"), { kind: "headless-client", family: "headless-browser" });
  assert.deepEqual(classifyIntegrityClient("Playwright/1.50"), { kind: "headless-client", family: "headless-browser" });
  assert.equal(classifyIntegrityClient("Mozilla/5.0 Chrome/125").kind, "browser");
});

test("request metadata retains only normalized browser-navigation context", () => {
  const request = new Request("https://challenge.example/api/session", {
    method: "POST",
    headers: {
      "user-agent": "Mozilla/5.0 Chrome/125",
      "sec-fetch-site": "same-origin",
      "sec-fetch-mode": "cors",
      "sec-fetch-dest": "empty",
      "sec-fetch-user": "?1",
      "accept": "*/*",
      "referer": "https://challenge.example/",
      "origin": "https://challenge.example",
      "sec-ch-ua": '"Chromium";v="125"',
    },
  });
  assert.deepEqual(safeIntegrityRequestMeta(request, "browser-ui"), {
    source: "browser-ui",
    client: { kind: "browser", family: "browser" },
    fetchSite: "same-origin",
    fetchMode: "cors",
    fetchDest: "empty",
    fetchUser: "?1",
    accept: "other",
    referer: "same-origin",
    origin: "same-origin",
    clientHints: true,
  });
});

test("every packaged challenge outside the stop-only surfaces exposes policy discovery and disclosure handling", async () => {
  const manifest = JSON.parse(await fs.readFile(new URL("packaging/challenges.json", ROOT), "utf8"));
  const challengeIds = manifest.challenges.map(({ id }) => id);
  const stopOnly = new Set(["last-stop", "after-hours"]);
  assert.deepEqual([...disclosureEnabled.keys()].sort(), challengeIds.filter((id) => !stopOnly.has(id)).sort());

  for (const [challenge, paths] of disclosureEnabled) {
    const source = `${paths.join("\n")}\n${(await Promise.all(paths.map((path) => fs.readFile(new URL(path, ROOT), "utf8")))).join("\n")}`;
    assert.match(source, /robots\.txt/, `${challenge} robots policy discovery`);
    assert.match(source, /api\/agent-disclosure/, `${challenge} disclosure endpoint`);
    assert.match(source, /agents\.txt|publicPolicyFor/, `${challenge} agent policy text`);
  }
});

test("the terminal and Discord stop-only surfaces expose no disclosure endpoint", async () => {
  for (const path of ["apps/last-stop/src/server.mjs", "apps/after-hours/src/server.mjs"]) {
    const source = await fs.readFile(new URL(path, ROOT), "utf8");
    assert.doesNotMatch(source, /api\/agent-disclosure/, path);
  }
});

test("every browser challenge records a silent authenticated application boot", async () => {
  for (const [challenge, [path, marker]] of browserBootSurfaces) {
    const source = await fs.readFile(new URL(path, ROOT), "utf8");
    assert.match(source, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `${challenge} application boot`);
  }
});
