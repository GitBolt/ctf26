#!/usr/bin/env node
import {
  buildExploit,
  checkSubmission,
  createLatestFixedTarget,
  createLiveTarget,
  executeStrategy,
  publicTarget,
} from "../src/protocol.mjs";

const command = process.argv[2] || "target";
const participantId = process.env.PARTICIPANT_ID || "participant-local";

if (command === "target") {
  console.log(JSON.stringify(publicTarget(createLiveTarget(participantId)), null, 2));
} else if (command === "demo-exploit") {
  const target = createLiveTarget(participantId);
  const exploit = buildExploit({ target, attackerProgramId: "AttackerStrategyDemo111111111111111111111" });
  console.log(JSON.stringify({ exploit, check: checkSubmission({ participantId, exploit }) }, null, 2));
} else if (command === "latest-fails") {
  const target = createLatestFixedTarget(participantId);
  const exploit = buildExploit({ target, attackerProgramId: "AttackerStrategyDemo111111111111111111111" });
  console.log(JSON.stringify({ target, exploit, result: tryRun(target, exploit) }, null, 2));
} else {
  console.error("usage: npm run play -- [target|demo-exploit|latest-fails]");
  process.exit(1);
}

function tryRun(target, exploit) {
  try {
    return executeStrategy(target, exploit);
  } catch (error) {
    return { error: error.message };
  }
}
