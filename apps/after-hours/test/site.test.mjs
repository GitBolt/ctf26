import assert from "node:assert/strict";
import test from "node:test";

import { playerKitArchive } from "../src/player-kit.mjs";
import { handoffHtml } from "../src/server.mjs";

test("handoff presents a server bot invite in a new tab", () => {
  const html = handoffHtml({
    passage: "safe-passage",
    install: "https://discord.com/oauth2/authorize?client_id=1&integration_type=0",
  });
  assert.match(html, /Invite bot to server/);
  assert.match(html, /target="_blank" rel="noopener noreferrer"/);
  assert.match(html, /href="\/player-kit\.zip"/);
  assert.match(html, /\/afterhours start passage:safe-passage/);
  assert.match(html, /class="conversation"/);
  assert.match(html, /Night Counter/);
  assert.match(html, /Message #checkout/);
  assert.doesNotMatch(html, /agent-disclosure|Authorization: Bearer|\/afterhours policy/);
  assert.match(html, /Autonomous AI agents/);
  assert.doesNotMatch(html, /class="steps"|class="receipt"/);
});

test("challenge-hosted player kit contains only the three public files", () => {
  const files = unzipStored(playerKitArchive());
  assert.deepEqual([...files.keys()], [
    "after-hours-player/README.md",
    "after-hours-player/checkout.mjs",
    "after-hours-player/package.json",
  ]);
  const combined = Buffer.concat([...files.values()]).toString("utf8");
  assert.doesNotMatch(combined, /CHALLENGE_TICKET_SECRET|DISCORD_BOT_TOKEN|AFTER_HOURS_FLAG_SECRET/);
  assert.doesNotMatch(combined, /counterfeit|missing mint|mint-blind/i);
});

function unzipStored(bytes) {
  const files = new Map();
  let offset = 0;
  while (offset + 30 <= bytes.length && bytes.readUInt32LE(offset) === 0x04034b50) {
    const method = bytes.readUInt16LE(offset + 8);
    const size = bytes.readUInt32LE(offset + 18);
    const nameLength = bytes.readUInt16LE(offset + 26);
    const extraLength = bytes.readUInt16LE(offset + 28);
    assert.equal(method, 0);
    const nameStart = offset + 30;
    const contentStart = nameStart + nameLength + extraLength;
    const name = bytes.subarray(nameStart, nameStart + nameLength).toString("utf8");
    files.set(name, bytes.subarray(contentStart, contentStart + size));
    offset = contentStart + size;
  }
  return files;
}
