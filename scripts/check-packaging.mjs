#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { CHALLENGES as portalChallenges } from "../apps/portal/app/lib/challenges.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = path.join(root, "packaging/challenges.json");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const forbiddenPlayerName = [
  /(^|\/)\.env(?:\.|$)/i,
  /answer/i,
  /exploit/i,
  /keypair/i,
  /organizer/i,
  /(^|[-_.])solve(?:[-_.]|$)/i,
  /(^|\/)tests?(\/|$)/i,
  /\.(?:key|pem)$/i,
];

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function resolveRepoPath(relativePath) {
  invariant(
    typeof relativePath === "string" && relativePath.length > 0,
    "manifest paths must be non-empty strings",
  );
  const resolved = path.resolve(root, relativePath);
  invariant(
    resolved.startsWith(`${root}${path.sep}`),
    `path escapes repository root: ${relativePath}`,
  );
  return resolved;
}

function filesUnder(relativePath) {
  const absolutePath = resolveRepoPath(relativePath);
  invariant(fs.existsSync(absolutePath), `declared path does not exist: ${relativePath}`);
  const stat = fs.statSync(absolutePath);
  if (stat.isFile()) return [relativePath];
  invariant(stat.isDirectory(), `declared path is not a file or directory: ${relativePath}`);

  const files = [];
  for (const entry of fs.readdirSync(absolutePath, { withFileTypes: true })) {
    const child = path.posix.join(relativePath, entry.name);
    if (entry.isDirectory()) files.push(...filesUnder(child));
    else if (entry.isFile()) files.push(child);
    else throw new Error(`player path contains a symlink or special file: ${child}`);
  }
  return files;
}

function overlaps(first, second) {
  const firstPath = `${path.resolve(root, first)}${path.sep}`;
  const secondPath = `${path.resolve(root, second)}${path.sep}`;
  return (
    firstPath.startsWith(secondPath) ||
    secondPath.startsWith(firstPath) ||
    path.resolve(root, first) === path.resolve(root, second)
  );
}

function pathCovers(declaredPath, candidatePath) {
  const declared = path.resolve(root, declaredPath);
  const candidate = path.resolve(root, candidatePath);
  return candidate === declared || candidate.startsWith(`${declared}${path.sep}`);
}

invariant(manifest.schemaVersion === 1, "unsupported packaging manifest schema");
invariant(manifest.eventId === "ctf26", "packaging manifest event ID is invalid");
invariant(Array.isArray(manifest.challenges), "packaging manifest has no challenges");

const manifestIds = manifest.challenges.map(({ id }) => id);
const portalIds = portalChallenges.map(({ key }) => key);
invariant(
  new Set(manifestIds).size === manifestIds.length,
  "packaging manifest contains duplicate challenge IDs",
);
invariant(
  JSON.stringify([...manifestIds].sort()) === JSON.stringify([...portalIds].sort()),
  "packaging manifest and portal challenge catalog are out of sync",
);

let playerFileCount = 0;
for (const challenge of manifest.challenges) {
  const portal = portalChallenges.find(({ key }) => key === challenge.id);
  invariant(
    typeof challenge.appPath === "string" && challenge.appPath.startsWith("apps/"),
    `${challenge.id}: appPath must point to an application directory`,
  );
  const appPath = resolveRepoPath(challenge.appPath);
  invariant(fs.statSync(appPath).isDirectory(), `${challenge.id}: appPath is not a directory`);
  invariant(
    fs.existsSync(path.join(appPath, "package.json")),
    `${challenge.id}: appPath has no package.json`,
  );
  invariant(
    challenge.launchAudience === challenge.id,
    `${challenge.id}: launch audience must equal the challenge ID`,
  );
  invariant(
    challenge.portalUrlEnv === portal.urlEnv,
    `${challenge.id}: portal URL environment name is out of sync`,
  );
  invariant(
    ["hosted", "hosted-onchain", "attachment-onchain", "attachment-localnet"].includes(
      challenge.delivery,
    ),
    `${challenge.id}: unknown delivery mode`,
  );

  const playerPaths = challenge.playerPaths || [];
  const generatedPlayerPaths = challenge.generatedPlayerPaths || [];
  const strictPlayerRoots = challenge.strictPlayerRoots || [];
  const organizerPaths = challenge.organizerOnlyPaths || [];
  for (const organizerPath of organizerPaths) {
    invariant(
      fs.existsSync(resolveRepoPath(organizerPath)),
      `${challenge.id}: organizer-only path does not exist: ${organizerPath}`,
    );
  }

  for (const playerPath of playerPaths) {
    for (const organizerPath of organizerPaths) {
      invariant(
        !overlaps(playerPath, organizerPath),
        `${challenge.id}: player and organizer paths overlap: ${playerPath}`,
      );
    }
    for (const file of filesUnder(playerPath)) {
      invariant(
        !forbiddenPlayerName.some((pattern) => pattern.test(file)),
        `${challenge.id}: forbidden player file: ${file}`,
      );
      playerFileCount += 1;
    }
  }

  for (const generatedPath of generatedPlayerPaths) {
    for (const organizerPath of organizerPaths) {
      invariant(
        !overlaps(generatedPath, organizerPath),
        `${challenge.id}: generated player and organizer paths overlap: ${generatedPath}`,
      );
    }
    invariant(
      !forbiddenPlayerName.some((pattern) => pattern.test(generatedPath)),
      `${challenge.id}: forbidden generated player path: ${generatedPath}`,
    );
    const absolutePath = resolveRepoPath(generatedPath);
    if (fs.existsSync(absolutePath)) {
      invariant(
        fs.statSync(absolutePath).isFile(),
        `${challenge.id}: generated player artifact is not a file: ${generatedPath}`,
      );
      if (path.extname(generatedPath) === ".so") {
        const artifact = fs.readFileSync(absolutePath);
        invariant(
          artifact.length > 1024 && artifact.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46])),
          `${challenge.id}: generated .so is not a substantive ELF artifact: ${generatedPath}`,
        );
      }
      playerFileCount += 1;
    }
  }

  const allowedPlayerPaths = [...playerPaths, ...generatedPlayerPaths];
  for (const strictRoot of strictPlayerRoots) {
    for (const file of filesUnder(strictRoot)) {
      invariant(
        allowedPlayerPaths.some((allowedPath) => pathCovers(allowedPath, file)),
        `${challenge.id}: undeclared file exists in strict player root: ${file}`,
      );
    }
  }
}

console.log(
  `packaging manifest ok: ${manifest.challenges.length} challenges, ${playerFileCount} present player files`,
);
