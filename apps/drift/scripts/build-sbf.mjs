import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const buildDir = join(root, "native", "target", "deploy");
const builtArtifactName = "drift_vault.so";
const playerArtifactName = "drift_vault.so";
const builtArtifact = join(buildDir, builtArtifactName);
const playerDist = join(root, "player-kit", "dist");
const playerArtifact = join(playerDist, playerArtifactName);
const serverArtifacts = join(root, "server-artifacts");

// Never leave a stale attachment behind after a failed build.
await rm(playerDist, { recursive: true, force: true });

async function buildVariant(feature, destination) {
  const args = [
    "build-sbf",
    "--manifest-path",
    join(root, "native", "program", "Cargo.toml"),
    "--sbf-out-dir",
    buildDir,
    ...(feature ? ["--features", feature] : []),
  ];
  const build = spawnSync("cargo", args, { cwd: root, stdio: "inherit" });
  if (build.error) throw build.error;
  if (build.status !== 0) process.exit(build.status ?? 1);
  const bytes = await readFile(builtArtifact);
  validateArtifact(bytes);
  await writeFile(destination, bytes);
  return bytes;
}

function validateArtifact(bytes) {
  if (bytes.length < 64 || !bytes.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]))) {
    throw new Error("cargo build-sbf did not produce an ELF artifact");
  }
  if (bytes[18] !== 0x07 || bytes[19] !== 0x01) throw new Error("built ELF does not identify as Solana SBF");
  const leaked = bytes.toString("latin1").match(/unix|timestamp|elapsed|interest|last_ts|reserve|vault|balance|clock/i);
  if (leaked) throw new Error(`SBF strings gate found forbidden challenge term: ${leaked[0]}`);
}

await mkdir(serverArtifacts, { recursive: true });
const bytes = await buildVariant(null, join(serverArtifacts, "drift_vault_v0.so"));
await buildVariant("variant-1", join(serverArtifacts, "drift_vault_v1.so"));
await buildVariant("variant-2", join(serverArtifacts, "drift_vault_v2.so"));

// Publish only the stripped ELF. cargo-build-sbf also emits a deployment keypair; that organizer
// material must never enter the player attachment directory.
await mkdir(playerDist, { recursive: true });
await writeFile(playerArtifact, bytes);

const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
console.log(`wrote player-kit/dist/${playerArtifactName} (${bytes.length} bytes, sha256 ${sha256})`);
