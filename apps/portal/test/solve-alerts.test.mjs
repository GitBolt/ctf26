import assert from "node:assert/strict";
import test from "node:test";

import { verifiedSolveCount } from "../app/leaderboard/solve-alerts.mjs";

test("verified solve count totals challenge completions without using score changes", () => {
  assert.equal(verifiedSolveCount({
    challengeValues: {
      imprint: { solveCount: 3, points: 700 },
      signet: { solveCount: 2, points: 800 },
      "reward-sniper": { solveCount: 0, points: 1_000 },
    },
  }), 5);
});

test("verified solve count safely ignores missing and malformed values", () => {
  assert.equal(verifiedSolveCount(null), 0);
  assert.equal(verifiedSolveCount({
    challengeValues: {
      imprint: { solveCount: -1 },
      signet: { solveCount: "two" },
      drift: {},
    },
  }), 0);
});
