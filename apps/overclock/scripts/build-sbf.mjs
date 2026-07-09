import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import { copyFile, mkdir, readFile, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const buildDir = join(root, "native", "target", "deploy");
const artifactName = "overclock_vault.so";
const builtArtifact = join(buildDir, artifactName);
const playerDist = join(root, "player-kit", "dist");
const playerArtifact = join(playerDist, artifactName);

// Never leave a stale attachment behind after a failed build.
await rm(playerDist, { recursive: true, force: true });

const build = spawnSync(
  "cargo",
  [
    "build-sbf",
    "--manifest-path",
    join(root, "native", "program", "Cargo.toml"),
    "--sbf-out-dir",
    buildDir,
  ],
  { cwd: root, stdio: "inherit" },
);
if (build.error) throw build.error;
if (build.status !== 0) process.exit(build.status ?? 1);

const bytes = await readFile(builtArtifact);
if (bytes.length < 64 || !bytes.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]))) {
  throw new Error("cargo build-sbf did not produce an ELF artifact");
}
// ELF e_machine 0x0107 is Solana's SBF architecture identifier.
if (bytes[18] !== 0x07 || bytes[19] !== 0x01) {
  throw new Error("built ELF does not identify as Solana SBF");
}
const leaked = bytes
  .toString("latin1")
  .match(/unix|timestamp|elapsed|interest|last_ts|reserve|vault|balance/i);
if (leaked) throw new Error(`SBF strings gate found forbidden challenge term: ${leaked[0]}`);

// Publish only the stripped ELF. cargo-build-sbf also emits a deployment keypair; that organizer
// material must never enter the player attachment directory.
await mkdir(playerDist, { recursive: true });
await copyFile(builtArtifact, playerArtifact);

const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
console.log(`wrote player-kit/dist/${artifactName} (${bytes.length} bytes, sha256 ${sha256})`);
