import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

const dist = new URL("../player-kit/dist/", import.meta.url);

test("player artifact directory contains only a genuine stripped-target SBF ELF", async () => {
  assert.deepEqual(await readdir(dist), ["overclock_vault.so"]);

  const bytes = await readFile(new URL("overclock_vault.so", dist));
  assert.ok(bytes.length > 10_000);
  assert.deepEqual([...bytes.subarray(0, 4)], [0x7f, 0x45, 0x4c, 0x46]);
  assert.equal(bytes.readUInt16LE(18), 0x0107);

  const ascii = bytes.toString("latin1");
  assert.doesNotMatch(ascii, /unix|timestamp|elapsed|interest|last_ts|reserve|vault|balance/i);
});
