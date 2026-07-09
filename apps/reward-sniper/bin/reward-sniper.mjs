#!/usr/bin/env node
import {
  advanceTick,
  beginRevealPhase,
  claimWithSniperTicket,
  commitAction,
  createMarket,
  inspectMarket,
  issueVoucher,
  registerTeam,
  revealAction,
  resolveTick,
  scoreboard,
  simulateBestTicket,
} from "../src/market.mjs";

const command = process.argv[2] || "demo";
const market = createMarket("cli-round");
registerTeam(market, "team-a", "delayed-bin-touch");
registerTeam(market, "team-b", "noisy-reward-rate");

if (command === "inspect") {
  console.log(JSON.stringify(inspectMarket(market, "team-a"), null, 2));
} else if (command === "best") {
  console.log(JSON.stringify(simulateBestTicket(market, "team-a"), null, 2));
} else if (command === "ticket") {
  const best = simulateBestTicket(market, "team-a");
  const voucher = issueVoucher(market, "team-a", { binId: best.binId, nonce: "cli-ticket" });
  console.log(JSON.stringify(claimWithSniperTicket(market, "team-a", best.binId, 900, voucher), null, 2));
} else if (command === "commit-reveal") {
  const best = simulateBestTicket(market, "team-a");
  const voucher = issueVoucher(market, "team-a", { binId: best.binId, nonce: "cli-commit" });
  const action = { type: "ticket", binId: best.binId, liquidity: 900, voucher };
  const nonce = "commit-secret";
  console.log("commit", commitAction(market, "team-a", action, nonce));
  console.log("phase", beginRevealPhase(market));
  console.log("reveal", revealAction(market, "team-a", action, nonce));
  console.log("batch", resolveTick(market));
  console.log("scoreboard", scoreboard(market));
} else {
  console.log("reward sniper local round");
  for (let i = 0; i < 3; i += 1) {
    const best = simulateBestTicket(market, "team-a");
    const voucher = issueVoucher(market, "team-a", { binId: best.binId, nonce: `demo-ticket-${i}` });
    const result = claimWithSniperTicket(market, "team-a", best.binId, 700 + i * 100, voucher);
    console.log(`tick ${market.tick} bin ${best.binId}`, result);
    advanceTick(market, 3);
  }
  console.table(scoreboard(market));
}
