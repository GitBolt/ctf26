import crypto from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const kit = join(root, "player-kit");
const artifact = join(kit, "dist", "drift_vault.so");
const entries = (await readdir(kit)).sort();
for (const required of ["README.md", "client.mjs", "dist"]) {
  if (!entries.includes(required)) throw new Error(`player kit is missing ${required}`);
}
for (const forbidden of ["native", "src", "test", "Cargo.toml", "Cargo.lock"]) {
  if (entries.includes(forbidden)) throw new Error(`player kit leaks organizer material: ${forbidden}`);
}
const bytes = await readFile(artifact);
const manifest = {
  challenge: "DRIFT",
  artifact: "dist/drift_vault.so",
  sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
  bytes: bytes.length,
};
await writeFile(join(kit, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`verified DRIFT player kit (${manifest.sha256})`);
