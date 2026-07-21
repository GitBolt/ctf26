import assert from "node:assert/strict";
import test from "node:test";

import { handoffHtml } from "../src/server.mjs";

test("handoff presents a server bot invite in a new tab", () => {
  const html = handoffHtml({
    passage: "safe-passage",
    install: "https://discord.com/oauth2/authorize?client_id=1&integration_type=0",
  });
  assert.match(html, /Invite bot to server/);
  assert.match(html, /target="_blank" rel="noopener noreferrer"/);
  assert.doesNotMatch(html, /player-kit|download checkout kit|download the helper/i);
  assert.match(html, /\/afterhours start passage:safe-passage/);
  assert.match(html, /class="conversation"/);
  assert.match(html, /Night Counter/);
  assert.match(html, /Message #checkout/);
  assert.doesNotMatch(html, /agent-disclosure|Authorization: Bearer|\/afterhours policy/);
  assert.match(html, /Autonomous AI agents/);
  assert.doesNotMatch(html, /class="steps"|class="receipt"/);
});
