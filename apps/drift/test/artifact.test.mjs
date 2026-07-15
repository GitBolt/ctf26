import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

const dist = new URL("../player-kit/dist/", import.meta.url);

test("player artifact directory contains only a genuine stripped-target SBF ELF", async () => {
  assert.deepEqual(await readdir(dist), ["drift_vault.so"]);

  const bytes = await readFile(new URL("drift_vault.so", dist));
  assert.ok(bytes.length > 10_000);
  assert.deepEqual([...bytes.subarray(0, 4)], [0x7f, 0x45, 0x4c, 0x46]);
  assert.equal(bytes.readUInt16LE(18), 0x0107);

  const ascii = bytes.toString("latin1");
  assert.doesNotMatch(ascii, /unix|timestamp|elapsed|interest|last_ts|reserve|vault|balance|clock/i);

  // The runtime account dependency must remain discoverable from bytecode even though its base58
  // spelling and semantic name are intentionally absent from player-facing text.
  const requiredRuntimeAddress = Buffer.from(
    "06a7d51718c774c928566398691d5eb68b5eb8a39b4b6d5c73555b2100000000",
    "hex",
  );
  const first = bytes.indexOf(requiredRuntimeAddress);
  assert.notEqual(first, -1);
  assert.equal(bytes.indexOf(requiredRuntimeAddress, first + 1), -1);
});

test("player manifest commits to the exact published ELF without organizer files", async () => {
  const kit = new URL("../player-kit/", import.meta.url);
  const entries = (await readdir(kit)).sort();
  assert.deepEqual(entries, ["README.md", "client.mjs", "dist", "manifest.json"]);
  const bytes = await readFile(new URL("dist/drift_vault.so", kit));
  const manifest = JSON.parse(await readFile(new URL("manifest.json", kit), "utf8"));
  assert.equal(manifest.challenge, "DRIFT");
  assert.equal(manifest.artifact, "dist/drift_vault.so");
  assert.equal(manifest.bytes, bytes.length);
  assert.equal(manifest.sha256, crypto.createHash("sha256").update(bytes).digest("hex"));
});

test("browser workspace is accessible, responsive, and contains no rehearsal bypass", async () => {
  const web = new URL("../web/", import.meta.url);
  const [html, css, script] = await Promise.all([
    readFile(new URL("index.html", web), "utf8"),
    readFile(new URL("styles.css", web), "utf8"),
    readFile(new URL("app.js", web), "utf8"),
  ]);

  assert.match(html, /<main\b/);
  assert.match(html, /aria-live="polite"/);
  assert.match(html, /<label[^>]+for="trace-input"/);
  assert.match(html, /raw <code>invoke<\/code> and <code>set_sysvar<\/code>/);
  assert.doesNotMatch(html, /Clock|set_clock|deposit|accrue|withdraw/i);
  assert.match(html, /id="workspace"[^>]+hidden/);
  assert.match(css, /:focus-visible/);
  assert.match(css, /@media \(max-width:/);
  assert.match(css, /prefers-reduced-motion/);
  assert.doesNotMatch(`${html}\n${script}`, /directTest|test_team|dummy|simulator/i);
  assert.match(script, /searchParams\.delete\("ticket"\)/);
});
