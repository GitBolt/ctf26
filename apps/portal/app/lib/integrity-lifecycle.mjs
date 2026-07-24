import { resolveLeaderboardConfig } from "./leaderboard-lifecycle.mjs";
import { createLeaderboardStore } from "./leaderboard-store.mjs";

export async function assertIntegrityWriteAllowed(options = {}) {
  const env = options.env || process.env;
  const store = options.store || createLeaderboardStore({ env });
  const config = await resolveLeaderboardConfig({ env, store });
  if (config.scoringMode === "freezing" || config.scoringMode === "frozen") {
    throw new Error("integrity review is frozen");
  }
  return config;
}
