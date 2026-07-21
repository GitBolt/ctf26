import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { redisCommand, signetRedisKey } from "../src/redis.mjs";
import { createTargetInventory, validateTargetMap } from "../src/targets.mjs";

const PUBLISH_SCRIPT = [
  "for i=2,#KEYS do redis.call('SET',KEYS[i],ARGV[i-1]); end;",
  "redis.call('SET',KEYS[1],ARGV[#ARGV]);",
  "return #KEYS-1",
].join(" ");

export async function publishTargets(targets, {
  env = process.env,
  redisCommandImpl = redisCommand,
  log = console.log,
} = {}) {
  // Perform every structural and per-target validation before the first Redis write.
  const entries = validateTargetMap(targets, { allowPreview: false });
  const inventory = createTargetInventory(entries.map(([participantId]) => participantId), { env });
  const inventoryKey = signetRedisKey("target-inventory", undefined, env);
  const targetKeys = entries.map(([participantId]) => signetRedisKey("target", participantId, env));
  const targetValues = entries.map(([, target]) => JSON.stringify(target));
  const result = Number(await redisCommandImpl([
    "EVAL",
    PUBLISH_SCRIPT,
    String(1 + targetKeys.length),
    inventoryKey,
    ...targetKeys,
    ...targetValues,
    JSON.stringify(inventory),
  ], { env }));
  if (result !== entries.length) throw new Error("target inventory publish did not complete atomically");
  log(`Published ${inventory.count} SIGNET targets with inventory digest ${inventory.participantIdsSha256}.`);
  return inventory;
}

async function main() {
  const filename = process.argv[2];
  if (!filename) throw new Error("usage: npm run publish-targets -- <targets.json>");
  await publishTargets(JSON.parse(fs.readFileSync(filename, "utf8")));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  await main();
}
