"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { rowMovement, verifiedSolveCount } from "./solve-alerts.mjs";

const SOLVE_ALERT_PATH = "/audio/solve-achievement.mp3";
// How long a ▲/▼ badge and the scored-row flash stay up after a change. Long
// enough to read from across a room, short enough that the board settles.
const MOVEMENT_HOLD_MS = 8_000;
const FLIP_MS = 450;

function prefersReducedMotion() {
  return typeof window !== "undefined"
    && typeof window.matchMedia === "function"
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
// The INR figure is a display-only estimate based on the RBI reference rate
// published on 24 July 2026. Scoring and payouts remain denominated in USD.
const USD_TO_INR = 96.539;
const rupees = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});
const number = new Intl.NumberFormat("en-US");
const time = new Intl.DateTimeFormat("en-IN", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

function prize(value) {
  return `${rupees.format(value * USD_TO_INR)} / ${money.format(value)}`;
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

function MovementBadge({ movement }) {
  if (!movement) return null;
  const { delta, gained, debut } = movement;
  // Arriving on the board is the largest move a row can make, and it has no
  // numeric delta because an unranked row has no rank to subtract from.
  if (debut) return <span className="leader-move leader-move-new" aria-label="New entry on the board">NEW</span>;
  if (delta > 0) {
    return <span className="leader-move leader-move-up" aria-label={`Climbed ${delta} ${delta === 1 ? "place" : "places"}`}>▲{delta}</span>;
  }
  if (delta < 0) {
    const places = Math.abs(delta);
    return <span className="leader-move leader-move-down" aria-label={`Dropped ${places} ${places === 1 ? "place" : "places"}`}>▼{places}</span>;
  }
  if (gained) return <span className="leader-move leader-move-held" aria-label="Scored, holding position">▬</span>;
  return null;
}

function publicParticipantName(row, index) {
  const value = String(row.displayName || "").trim();
  return /^[a-f0-9]{16}$/i.test(value)
    ? `Participant ${String(index + 1).padStart(2, "0")}`
    : value;
}

function LeaderboardRow({ row, rowIndex, prizePublished, movement, rowRef }) {
  const classes = [
    "leader-row",
    row.rank && row.rank <= 3 ? `leader-row-top leader-row-top-${row.rank}` : "",
    !row.rank ? "leader-row-unranked" : "",
    movement?.gained ? "leader-row-gained" : "",
  ].filter(Boolean).join(" ");
  return (
    <article className={classes} ref={rowRef}>
      <div className="leader-rank" aria-label={row.rank ? `Rank ${row.rank}` : "Not yet ranked"}>
        {row.rank ? String(row.rank).padStart(2, "0") : "••"}
      </div>
      <div className="leader-person">
        <strong>{publicParticipantName(row, rowIndex)}</strong>
        <MovementBadge movement={movement} />
      </div>
      <div className="leader-prize">
        <strong>{row.rank ? (prizePublished ? prize(row.projectedPrize) : "Redacted") : "Not earning"}</strong>
        <span>{row.rank ? "projected earnings" : "No score yet"}</span>
      </div>
      <div className="leader-score">
        <strong>{number.format(row.points)}</strong>
        <span>points</span>
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

  const [movements, setMovements] = useState(() => new Map());
  const rowNodes = useRef(new Map());
  const lastOffsets = useRef(new Map());
  const rankHistory = useRef(new Map());
  const pointsHistory = useRef(new Map());
  const solveHistory = useRef(new Map());
  const historySeeded = useRef(false);
  const hasComparedOnce = useRef(false);
  if (!historySeeded.current) {
    // Seed from the server-rendered snapshot so the first live update produces a
    // real delta instead of treating every row as brand new.
    for (const row of initialSnapshot?.rows || []) {
      rankHistory.current.set(row.participantId, row.rank);
      pointsHistory.current.set(row.participantId, row.points);
      solveHistory.current.set(row.participantId, row.solveCount);
    }
    historySeeded.current = true;
  }

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

  // Rank and score deltas are derived here rather than served: the snapshot is a
  // shared, cached document with no per-viewer history, so "what changed since I
  // last looked" only exists on the client.
  useEffect(() => {
    const rows = snapshot?.rows;
    if (!rows?.length) return;
    const fresh = [];
    const firstComparison = !hasComparedOnce.current;
    for (const row of rows) {
      const movement = rowMovement({
        row,
        priorRank: rankHistory.current.get(row.participantId),
        priorPoints: pointsHistory.current.get(row.participantId),
        priorSolveCount: solveHistory.current.get(row.participantId),
        firstComparison,
      });
      if (movement) fresh.push([row.participantId, { ...movement, at: Date.now() }]);
      rankHistory.current.set(row.participantId, row.rank);
      pointsHistory.current.set(row.participantId, row.points);
      solveHistory.current.set(row.participantId, row.solveCount);
    }
    hasComparedOnce.current = true;
    if (!fresh.length) return;
    setMovements((current) => {
      const merged = new Map(current);
      for (const [participantId, value] of fresh) merged.set(participantId, value);
      return merged;
    });
  }, [snapshot]);

  useEffect(() => {
    if (movements.size === 0) return undefined;
    const timer = window.setInterval(() => {
      const cutoff = Date.now() - MOVEMENT_HOLD_MS;
      setMovements((current) => {
        const kept = new Map([...current].filter(([, value]) => value.at > cutoff));
        return kept.size === current.size ? current : kept;
      });
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [movements]);

  // FLIP: measure where each row sat before this paint, then animate it from its
  // old position to the new one so a rank change reads as motion, not a snap.
  useLayoutEffect(() => {
    const nextOffsets = new Map();
    const animate = !prefersReducedMotion();
    for (const [participantId, node] of rowNodes.current) {
      if (!node) continue;
      // offsetTop, not getBoundingClientRect: immune to page scroll between frames.
      const top = node.offsetTop;
      nextOffsets.set(participantId, top);
      if (!animate) continue;
      const priorTop = lastOffsets.current.get(participantId);
      if (priorTop === undefined) continue;
      const shift = priorTop - top;
      if (Math.abs(shift) < 1) continue;
      node.style.transition = "none";
      node.style.transform = `translateY(${shift}px)`;
      void node.offsetHeight;
      node.style.transition = `transform ${FLIP_MS}ms cubic-bezier(.22,.61,.36,1)`;
      node.style.transform = "translateY(0)";
    }
    lastOffsets.current = nextOffsets;
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
        <div className="leaderboard-title">
          <h1 id="standings-heading">Leaderboard</h1>
          {snapshot?.prizePoolPublished ? (
            <div className="leaderboard-prize-pool" aria-label={`Confirmed prize pool ${money.format(snapshot.prizePool)}`}>
              <span>Confirmed prize pool</span>
              <strong>{money.format(snapshot.prizePool)}</strong>
            </div>
          ) : null}
        </div>
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
        <span>Rank</span><span>Participant</span><span>Earnings</span><span>Score</span>
      </div>
      <div className="leader-table">
        {rows.length ? rows.map((row, rowIndex) => (
          <LeaderboardRow
            key={row.participantId}
            row={row}
            rowIndex={rowIndex}
            prizePublished={snapshot?.prizePoolPublished === true}
            movement={movements.get(row.participantId) || null}
            rowRef={(node) => {
              if (node) rowNodes.current.set(row.participantId, node);
              else rowNodes.current.delete(row.participantId);
            }}
          />
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
