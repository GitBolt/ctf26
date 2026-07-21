import LeaderboardLive from "./LeaderboardLive";

import { leaderboardSnapshot } from "@/lib/leaderboard-service.mjs";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Live leaderboard | stCTF v2",
  description: "Live scores, ranks, and projected rewards for the Superteam Solana Security CTF.",
};

export default async function LeaderboardPage() {
  const initialSnapshot = await leaderboardSnapshot().catch(() => null);
  return (
    <main className="shell leaderboard-shell">
      <nav className="topbar" aria-label="Event">
        <a className="wordmark" href="/" aria-label="CTF26 challenge room">
          <span aria-hidden="true">[ st</span><strong>CTF</strong><span aria-hidden="true"> ]</span>
        </a>
        <div className="topbar-public-actions">
          <a className="topbar-link" href="/">Challenge room</a>
        </div>
      </nav>
      <LeaderboardLive initialSnapshot={initialSnapshot} />
    </main>
  );
}
