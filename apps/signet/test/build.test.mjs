import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("player interface contains the required accessible surfaces", () => {
  const html = fs.readFileSync(path.join(ROOT, "public/index.html"), "utf8");
  for (const id of [
    "main",
    "target-manifest",
    "source-repository",
    "starter-download",
    "submission-form",
    "transaction-signature",
    "success-result",
  ]) {
    assert.match(html, new RegExp(`id=["']${id}["']`));
  }
  assert.match(html, /aria-live=/);
  assert.match(html, /Skip to checker/);
  assert.match(html, /href="https:\/\/github\.com\/GitBolt\/signet"/);
  assert.match(html, /id="source-repository"[^>]+target="_blank"[^>]+rel="noreferrer"/);
  assert.match(html, /id="starter-download"[^>]+href="\/signet-starter\.tar\.gz"[^>]+download/);
  assert.match(html, /Move the assigned reserve into its destination/);
});

test("public challenge brief does not signpost the earned source-archaeology realization", () => {
  const shell = ["index.html", "app.js"].map((name) => fs.readFileSync(path.join(ROOT, "public", name), "utf8")).join("\n");
  for (const forbidden of ["stale deployment", "silent patch", "unpinned CPI", "vulnerable commit", "read the PR history"]) {
    assert.equal(shell.toLowerCase().includes(forbidden), false, `public shell leaked: ${forbidden}`);
  }
});

test("initial launch and target reads retry bounded checker pressure", () => {
  const script = fs.readFileSync(path.join(ROOT, "public/app.js"), "utf8");
  assert.match(script, /retryBusy: true/);
  assert.match(script, /response\.status !== 429/);
  assert.match(script, /Math\.min\(3, Math\.max\(1/);
  assert.match(script, /const maxAttempts = options\.retryBusy \? 6 : 1/);
  assert.match(script, /attempt <= maxAttempts/);
});

test("starter archive is deterministic, non-empty, and contains no private key material", () => {
  const archive = fs.readFileSync(path.join(ROOT, "public/signet-starter.tar.gz"));
  assert.ok(archive.length > 2_000);
  const tar = zlib.gunzipSync(archive);
  const names = tarNames(tar);
  assert.ok(names.includes("signet-starter/.env.example"));
  assert.ok(names.includes("signet-starter/README.md"));
  assert.ok(names.includes("signet-starter/client/execute.mjs"));
  assert.ok(names.includes("signet-starter/programs/player-strategy/src/lib.rs"));
  assert.equal(names.some((name) => name.endsWith("keypair.json") || name.includes("/.keys/")), false);
});

test("Railway container config uses the hardened root context and production health endpoint", () => {
  const repositoryRoot = path.resolve(ROOT, "../..");
  const dockerfile = fs.readFileSync(path.join(ROOT, "Dockerfile.railway"), "utf8");
  const railway = JSON.parse(fs.readFileSync(path.join(ROOT, "railway.json"), "utf8"));
  const dockerignore = fs.readFileSync(path.join(repositoryRoot, ".dockerignore"), "utf8");

  assert.equal(railway.build.builder, "DOCKERFILE");
  assert.equal(railway.build.dockerfilePath, "apps/signet/Dockerfile.railway");
  assert.equal(railway.deploy.healthcheckPath, "/api/health");
  assert.match(dockerfile, /COPY --chown=node:node packages\/participant-ticket/);
  assert.match(dockerfile, /USER node/);
  assert.match(dockerfile, /HOST=0\.0\.0\.0/);
  assert.doesNotMatch(dockerfile, /COPY\s+\.\s+\./);
  assert.match(dockerignore, /^\*\*\/\.keys$/m);
  assert.match(dockerignore, /^\*\*\/\*-keypair\.json$/m);
  assert.match(dockerignore, /^\*\*\/\.env\.\*$/m);
});

test("the hosted starter archive is never served from a stale deployment cache", () => {
  const server = fs.readFileSync(path.join(ROOT, "src/server.mjs"), "utf8");
  assert.match(server, /\["index\.html", "signet-starter\.tar\.gz"\]/);
  assert.match(server, /cache-control", "no-store"/);
});

function tarNames(tar) {
  const names = [];
  let offset = 0;
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const name = header.subarray(0, 100).toString("utf8").replace(/\0.*$/, "");
    const sizeText = header.subarray(124, 136).toString("utf8").replace(/\0.*$/, "").trim();
    const size = Number.parseInt(sizeText || "0", 8);
    names.push(name);
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  return names;
}
