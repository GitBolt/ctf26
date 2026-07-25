"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { verifiedSolveCount } from "./solve-alerts.mjs";

const SOLVE_ALERT_PATH = "/audio/solve-achievement.mp3";

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
  const [soundEnabled, setSoundEnabled] = useState(false);
  const hasSnapshot = useRef(Boolean(initialSnapshot));
  const audio = useRef(null);
  const soundEnabledRef = useRef(false);
  const previousSolveCount = useRef(verifiedSolveCount(initialSnapshot));
  const alertQueue = useRef({ pending: 0, playing: false });
  const drainAlerts = useRef(() => {});

  useEffect(() => {
    const player = new Audio(SOLVE_ALERT_PATH);
    player.preload = "auto";
    player.volume = 0.72;
    audio.current = player;

    const finishAlert = () => {
      alertQueue.current.playing = false;
      if (alertQueue.current.pending > 0 && soundEnabledRef.current) {
        window.setTimeout(() => drainAlerts.current(), 180);
      }
    };

    player.addEventListener("ended", finishAlert);
    player.addEventListener("error", finishAlert);
    drainAlerts.current = () => {
      if (!soundEnabledRef.current || alertQueue.current.playing || alertQueue.current.pending < 1) return;
      alertQueue.current.pending -= 1;
      alertQueue.current.playing = true;
      player.currentTime = 0;
      player.play().catch(() => {
        alertQueue.current.pending = 0;
        alertQueue.current.playing = false;
        soundEnabledRef.current = false;
        setSoundEnabled(false);
      });
    };

    return () => {
      player.pause();
      player.removeEventListener("ended", finishAlert);
      player.removeEventListener("error", finishAlert);
      audio.current = null;
      alertQueue.current = { pending: 0, playing: false };
    };
  }, []);

  useEffect(() => {
    const currentSolveCount = verifiedSolveCount(snapshot);
    const newSolves = Math.max(0, currentSolveCount - previousSolveCount.current);
    previousSolveCount.current = currentSolveCount;
    if (newSolves > 0 && soundEnabledRef.current) {
      alertQueue.current.pending += newSolves;
      drainAlerts.current();
    }
  }, [snapshot]);

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

  async function toggleSound() {
    const player = audio.current;
    if (!player) return;
    if (soundEnabledRef.current) {
      soundEnabledRef.current = false;
      alertQueue.current.pending = 0;
      alertQueue.current.playing = false;
      player.pause();
      player.currentTime = 0;
      setSoundEnabled(false);
      return;
    }

    const volume = player.volume;
    player.volume = 0;
    try {
      await player.play();
      player.pause();
      player.currentTime = 0;
      player.volume = volume;
      soundEnabledRef.current = true;
      setSoundEnabled(true);
    } catch {
      player.volume = volume;
      setSoundEnabled(false);
    }
  }

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
        <div className="leaderboard-header-actions">
          <button
            className={`solve-sound-toggle${soundEnabled ? " solve-sound-toggle-on" : ""}`}
            type="button"
            aria-pressed={soundEnabled}
            onClick={toggleSound}
          >
            <svg aria-hidden="true" viewBox="0 0 20 20">
              <path d="M3 8h3l4-3v10l-4-3H3V8Z" />
              {soundEnabled ? <path d="M13 7.2a4 4 0 0 1 0 5.6M15.2 5a7 7 0 0 1 0 10" /> : <path d="m13.2 8 4 4m0-4-4 4" />}
            </svg>
            <span>{soundEnabled ? "Solve sound on" : "Enable solve sound"}</span>
          </button>
          <div className="leaderboard-live-state" aria-live="polite">
            <span className={`live-orb live-orb-${statusTone}`} aria-hidden="true" />
            <div>
              <strong>{connection === "live"
                ? boardDelayed ? "Board delayed" : marketDelayed ? "Market delayed" : marketUnavailable ? "Market unavailable" : "Live"
                : connection === "delayed" ? "Update delayed" : "Connecting"}</strong>
              <span>{syncLabel(snapshot)}</span>
            </div>
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
