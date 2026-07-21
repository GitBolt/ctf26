"use client";

import { useEffect, useMemo, useRef, useState } from "react";

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const number = new Intl.NumberFormat("en-US");
const time = new Intl.DateTimeFormat("en-IN", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

function prize(snapshot, value) {
  return snapshot.prizePoolPublished ? money.format(value) : "Redacted";
}

function syncLabel(snapshot) {
  if (!snapshot?.generatedAt) return "Waiting for first update";
  if (snapshot.sharedCacheStale) {
    return `Board last synced ${time.format(new Date(snapshot.generatedAt))}`;
  }
  if (snapshot.performanceSource?.stale && snapshot.performanceSource.updatedAt) {
    return `Market last synced ${time.format(new Date(snapshot.performanceSource.updatedAt))}`;
  }
  if (snapshot.performanceSource?.available === false) return "Reward Sniper is not connected";
  return `Updated ${time.format(new Date(snapshot.generatedAt))}`;
}

function LeaderboardRow({ row, snapshot }) {
  return (
    <article className={`leader-row${row.rank && row.rank <= 3 ? ` leader-row-top leader-row-top-${row.rank}` : ""}${!row.rank ? " leader-row-unranked" : ""}`}>
      <div className="leader-rank" aria-label={row.rank ? `Rank ${row.rank}` : "Not yet ranked"}>
        {row.rank ? String(row.rank).padStart(2, "0") : "••"}
      </div>
      <div className="leader-person">
        <strong>{row.displayName}</strong>
      </div>
      <div className="leader-score">
        <strong>{number.format(row.points)}</strong>
        <span>points</span>
      </div>
      <div className="leader-prize">
        <strong>{row.rank ? prize(snapshot, row.projectedPrize) : "Not earning"}</strong>
        <span>live projection</span>
      </div>
    </article>
  );
}

export default function LeaderboardLive({ initialSnapshot }) {
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [connection, setConnection] = useState(initialSnapshot ? "live" : "connecting");
  const hasSnapshot = useRef(Boolean(initialSnapshot));

  useEffect(() => {
    let stopped = false;
    let controller = null;

    async function refresh() {
      if (document.visibilityState === "hidden") return;
      controller?.abort();
      controller = new AbortController();
      try {
        const response = await fetch("/api/leaderboard", {
          cache: "no-store",
          headers: { accept: "application/json" },
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`leaderboard returned ${response.status}`);
        const next = await response.json();
        if (!stopped) {
          setSnapshot(next);
          hasSnapshot.current = true;
          setConnection("live");
        }
      } catch (error) {
        if (!stopped && error.name !== "AbortError") setConnection(hasSnapshot.current ? "delayed" : "offline");
      }
    }

    void refresh();
    const interval = window.setInterval(refresh, 5_000);
    const onVisibility = () => { if (document.visibilityState === "visible") void refresh(); };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stopped = true;
      controller?.abort();
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  const rows = useMemo(() => snapshot?.rows || [], [snapshot]);
  const marketDelayed = snapshot?.performanceSource?.stale === true;
  const marketUnavailable = snapshot?.performanceSource?.available === false;
  const boardDelayed = snapshot?.sharedCacheStale === true;
  const statusTone = connection === "live" && (marketDelayed || marketUnavailable || boardDelayed)
    ? "delayed"
    : connection;

  if (!snapshot) {
    return (
      <section className="leaderboard-unavailable" role="status">
        <span className="live-orb" aria-hidden="true" />
        <div>
          <h1>The board is connecting.</h1>
          <p>Live standings will appear as soon as the scoring service responds.</p>
        </div>
      </section>
    );
  }

  return (
    <section className="standings-section leaderboard-list" aria-labelledby="standings-heading">
      <header className="leaderboard-list-header">
        <h1 id="standings-heading">Leaderboard</h1>
        <div className="leaderboard-live-state" aria-live="polite">
          <span className={`live-orb live-orb-${statusTone}`} aria-hidden="true" />
          <div>
            <strong>{connection === "live"
              ? boardDelayed ? "Board delayed" : marketDelayed ? "Market delayed" : marketUnavailable ? "Market unavailable" : "Live"
              : connection === "delayed" ? "Update delayed" : "Connecting"}</strong>
            <span>{syncLabel(snapshot)}</span>
          </div>
        </div>
      </header>
      <div className="leader-table-header" aria-hidden="true">
        <span>Rank</span><span>Participant</span><span>Score</span><span>Live award</span>
      </div>
      <div className="leader-table">
        {rows.length ? rows.map((row) => (
          <LeaderboardRow key={row.participantId} row={row} snapshot={snapshot} />
        )) : (
          <div className="leaderboard-empty">
            <span className="capture-flag" aria-hidden="true" />
            <div>
              <strong>No standings yet.</strong>
              <p>Verified scores will appear here.</p>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
