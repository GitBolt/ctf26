import fs from "node:fs";

import { redisCommand } from "../src/redis.mjs";
import { validateTarget } from "../src/targets.mjs";

const filename = process.argv[2];
if (!filename) throw new Error("usage: npm run publish-targets -- <targets.json>");
const parsed = JSON.parse(fs.readFileSync(filename, "utf8"));
if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || Object.keys(parsed).length === 0) {
  throw new Error("target manifest must be a non-empty object keyed by team id");
}

for (const [teamId, value] of Object.entries(parsed)) {
  const target = validateTarget(value, teamId);
  await redisCommand(["SET", `ctf26:signet:target:${teamId}`, JSON.stringify(target)]);
  console.log(`Published ${target.instanceId} for ${teamId}`);
}
