#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(
  fs.readFileSync(path.join(root, "packaging/challenges.json"), "utf8"),
);
const npm = process.platform === "win32" ? "npm.cmd" : "npm";

for (const challenge of manifest.challenges) {
  const appPath = path.resolve(root, challenge.appPath || "");
  if (!appPath.startsWith(`${root}${path.sep}`) || !fs.existsSync(path.join(appPath, "package.json"))) {
    throw new Error(`${challenge.id}: invalid challenge appPath`);
  }

  const result = spawnSync(npm, ["--prefix", challenge.appPath, "test"], {
    cwd: root,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}
