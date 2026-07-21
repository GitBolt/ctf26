import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const archive = fs.readFileSync(path.join(ROOT, "public/packages/reward-sniper-player.zip"));

test("Reward Sniper briefing ZIP is complete and contains no expiring participant ticket", () => {
  const files = unzipStored(archive);
  assert.deepEqual([...files.keys()], [
    "reward-sniper-player/README.md",
    "reward-sniper-player/sdk.mjs",
  ]);
  const guide = files.get("reward-sniper-player/README.md").toString("utf8");
  assert.match(guide, /https:\/\/stctf26\.vercel\.app\/api\/launch\/reward-sniper/);
  assert.doesNotMatch(guide, /fresh launch ticket|short-lived launch ticket|embedded credential/i);
  assert.doesNotMatch(guide, /[?&]ticket=|v1\.eyJ/);
  const sdk = files.get("reward-sniper-player/sdk.mjs").toString("utf8");
  assert.match(sdk, /lockTicket/);
  assert.match(sdk, /searcherToken/);
  assert.doesNotMatch(sdk, /accessToken|localStorage/);
  assert.doesNotMatch(sdk, /launch\(|participant ticket/);
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
