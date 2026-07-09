#!/usr/bin/env node
import { createLocalnet, referenceRewindExploit, runExploit } from "../src/runtime.mjs";

const command = process.argv[2] || "target";
const teamId = process.env.TEAM_ID || "team-local";

if (command === "target") {
  const net = createLocalnet(teamId);
  console.log(
    JSON.stringify(
      {
        teamId,
        rate: net.rate.toString(),
        reserve: net.vault.reserve.toString(),
        threshold: net.threshold.toString(),
        attackerStartingBalance: net.initialAttackerBalance.toString(),
        artifact: "player-kit/dist/overclock_vault.so",
        execution: "javascript-model-oracle-only",
        productionReady: false,
      },
      null,
      2,
    ),
  );
} else if (command === "demo-exploit") {
  const net = createLocalnet(teamId);
  const steps = referenceRewindExploit(net);
  console.log(JSON.stringify({ steps, modelResult: runExploit(net, steps) }, bigintReplacer, 2));
} else if (command === "run") {
  const steps = JSON.parse(process.env.EXPLOIT_STEPS || "[]");
  const net = createLocalnet(teamId);
  console.log(JSON.stringify(runExploit(net, steps), bigintReplacer, 2));
} else {
  console.error("usage: npm run play -- [target|demo-exploit|run]");
  process.exit(1);
}

function bigintReplacer(_key, value) {
  return typeof value === "bigint" ? value.toString() : value;
}
