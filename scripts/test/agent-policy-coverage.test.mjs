import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";

import { publicPolicyFor } from "../../packages/agent-integrity/index.js";

const ROOT = new URL("../../", import.meta.url);
const disclosureEnabled = new Map([
  ["reward-sniper", ["apps/reward-sniper/src/server.mjs"]],
  ["imprint", ["apps/imprint/web/lib/agent-policy.mjs", "apps/imprint/web/app/robots.txt/route.js", "apps/imprint/web/app/api/agent-disclosure/route.js"]],
  ["silent-patch", ["apps/silent-patch/src/server.mjs", "apps/silent-patch/src/http-service.mjs"]],
  ["overclock", ["apps/overclock/src/service.mjs"]],
  ["player-two", ["apps/player-two/src/server.mjs"]],
  ["st-genesis-airdrop", ["apps/st-genesis-airdrop/src/server.mjs"]],
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
    assert.doesNotMatch(source, /api\/agent-disclosure|INTEGRITY_INGEST/, path);
  }
});
