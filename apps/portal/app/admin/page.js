import { redirect } from "next/navigation";

import { currentUser, isOrganizer } from "@/lib/auth";
import { cachedPortalHealth } from "@/lib/health.mjs";
import { rewardIntegrityReport } from "@/lib/integrity.mjs";
import { configForLifecyclePhase, resolveLeaderboardConfig } from "@/lib/leaderboard-lifecycle.mjs";
import { leaderboardSnapshot } from "@/lib/leaderboard-service.mjs";
import { createLeaderboardStore } from "@/lib/leaderboard-store.mjs";

import { FinalizeControl, LifecycleControls } from "./AdminActions";

export const dynamic = "force-dynamic";

const REASONS = {
  "agent-disclosure-followed": { label: "Agent self-disclosure" },
  "agent-only-solver-context-fetched": { label: "Agent-only link opened" },
  "known-ai-client-workflow": {
    label: "AI-identified request",
    detail: "The request user agent identified an AI client. This is a review signal, not proof of AI use.",
  },
  "non-browser-interface-navigation": { label: "Unusual interface navigation" },
  "missing-browser-execution-evidence": { label: "Interface boot not observed" },
  "browser-automation-indicator": { label: "Browser automation indicator" },
  "challenge-solved-unusually-fast": { label: "Unusually fast completion" },
};

const CHALLENGES = {
  "reward-sniper": "Reward Sniper",
  imprint: "IMPRINT",
  signet: "SIGNET",
  drift: "DRIFT",
  "last-stop": "LAST STOP",
  "after-hours": "AFTER HOURS",
  "player-two": "PLAYER TWO",
  "the-broadcast": "THE BROADCAST",
  "evidence-room": "EVIDENCE ROOM",
  "second-key": "SECOND KEY",
  "the-chamber": "THE CHAMBER",
};

function valueOf(result, fallback) {
  return result.status === "fulfilled" ? result.value : fallback;
}

function dateTime(value) {
  if (!value) return "Not set";
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Kolkata",
  }).format(new Date(value));
}

function reasonFor(observation) {
  return REASONS[observation.reasonCode] || { label: "Unusual activity" };
}

function evidenceValue(value, fallback = "Not recorded") {
  const text = String(value || "").trim();
  return text || fallback;
}

function evidenceRows(observation) {
  return (observation.evidence || []).slice().reverse();
}

export default async function AdminDashboard() {
  const user = await currentUser();
  if (!user) redirect("/?error=admin_sign_in");
  if (!isOrganizer(user)) redirect("/");

  const store = createLeaderboardStore();
  const scoring = await resolveLeaderboardConfig({ store, organizer: user.email });
  const results = await Promise.allSettled([
    rewardIntegrityReport(),
    leaderboardSnapshot({ store }),
    store.rulesAcknowledgments(),
    cachedPortalHealth(),
    store.solves(),
    store.profiles(),
  ]);
  const report = valueOf(results[0], { cases: [], event: {} });
  const snapshot = valueOf(results[1], null);
  const acknowledgments = valueOf(results[2], []);
  const health = valueOf(results[3], null);
  const participantNames = new Map([
    ...(snapshot?.rows || []),
    ...valueOf(results[5], []),
  ].map((row) => [row.participantId, row.displayName]));
  const completedSolves = valueOf(results[4], [])
    .filter((solve) => CHALLENGES[solve?.challenge])
    .sort((left, right) => new Date(right.occurredAt).valueOf() - new Date(left.occurredAt).valueOf())
    .map((solve) => ({
      participantName: participantNames.get(solve.participantId) || solve.participantId,
      challengeName: CHALLENGES[solve.challenge],
      occurredAt: solve.occurredAt,
      sourceId: solve.sourceId,
    }));
  const observations = [...(report.cases || [])]
    .sort((left, right) => Number(right.updatedAt || 0) - Number(left.updatedAt || 0))
    .slice(0, 12);
  const canReset = scoring.scoringMode === "staging" && report.event?.stage === "complete";
  let canStartLive = true;
  let startReason = "";
  if (scoring.scoringMode === "staging") {
    try {
      const liveConfig = configForLifecyclePhase("live");
      canStartLive = liveConfig.configHash === scoring.configHash;
      if (!canStartLive) startReason = "Official event settings do not match this rehearsal generation.";
    } catch {
      canStartLive = false;
      startReason = "Complete the roster, schedule, award policy, and Reward event settings first.";
    }
  }

  return (
    <main className="shell organizer-shell">
      <nav className="topbar" aria-label="Organizer">
        <a className="wordmark" href="/" aria-label="CTF26 home"><span aria-hidden="true">[ st</span><strong>CTF</strong><span aria-hidden="true"> ]</span></a>
        <div className="admin-nav">
          <span>{user.email}</span>
          <a href="/leaderboard">Leaderboard</a>
          <a href="/">Challenges</a>
        </div>
      </nav>

      <header className="organizer-header">
        <div>
          <span className="organizer-eyebrow">Organizer console</span>
          <h1>Event control</h1>
        </div>
        <p>Operate the event, verify system state, and monitor integrity telemetry. Observations never change scores or rankings.</p>
      </header>

      <section className="organizer-status-grid" aria-label="Event status">
        <article>
          <span>System</span>
          <strong className={health?.ok ? "status-ready" : "status-attention"}>{health?.ok ? scoring.scoringMode === "staging" ? "Rehearsal" : "Ready" : "Attention"}</strong>
          <small>{health?.ok ? `${health.challenges} services responding` : "One or more readiness checks failed"}</small>
        </article>
        <article>
          <span>Event phase</span>
          <strong>{scoring.scoringMode}</strong>
          <small>{scoring.scoringStartAt ? `${dateTime(scoring.scoringStartAt)} to ${dateTime(scoring.scoringEndAt)}` : "Official window not configured"}</small>
        </article>
        <article>
          <span>Leaderboard</span>
          <strong>{snapshot?.finalizedAt ? "Final" : snapshot ? "Live" : "Unavailable"}</strong>
          <small>{snapshot ? `${snapshot.scoringEntrants} participant${snapshot.scoringEntrants === 1 ? "" : "s"} with points` : "Snapshot could not be read"}</small>
        </article>
      </section>

      <section className="organizer-two-column" aria-label="Event lifecycle">
        <article className="organizer-panel">
          <header><div><span>Lifecycle</span><h2>Scoring window</h2></div><span className={`organizer-chip chip-${scoring.scoringMode}`}>{scoring.scoringMode}</span></header>
          <dl className="organizer-facts">
            <div><dt>Generation</dt><dd>{scoring.eventGeneration}</dd></div>
            <div><dt>Participants</dt><dd>{scoring.checkedInParticipantIds.length} checked in</dd></div>
            <div><dt>Rules accepted</dt><dd>{acknowledgments.length}</dd></div>
            <div><dt>Recovery</dt><dd>{scoring.recoveryMinutes} minutes</dd></div>
            <div><dt>New sessions</dt><dd>{scoring.launchPaused ? "Paused" : scoring.scoringMode === "staging" ? "Rehearsal open" : scoring.scoringMode === "live" ? "Window gated" : "Closed"}</dd></div>
          </dl>
          <p className="organizer-panel-note">The schedule and scoring policy stay immutable. Event phases advance once and cannot roll backward.</p>
          <LifecycleControls phase={scoring.scoringMode} paused={scoring.launchPaused} canStartLive={canStartLive} startReason={startReason} />
          <FinalizeControl enabled={scoring.scoringMode === "freezing"} />
        </article>

        <article className="organizer-panel">
          <header><div><span>Reward Sniper</span><h2>Market state</h2></div><span className="organizer-chip">{report.event?.stage || "Unavailable"}</span></header>
          <dl className="organizer-facts">
            <div><dt>Event</dt><dd>{report.event?.eventId || "Unavailable"}</dd></div>
            <div><dt>Round</dt><dd>{report.event?.round ?? "Not started"}</dd></div>
            <div><dt>Tick</dt><dd>{report.event?.tick ?? "Not started"}</dd></div>
            <div><dt>Source</dt><dd>{snapshot?.performanceSource?.stale ? "Cached" : "Current"}</dd></div>
          </dl>
          {canReset ? (
            <form className="organizer-reset" action="/api/admin/event/reset" method="post">
              <input type="hidden" name="eventId" value={report.event.eventId} />
              <label><span>Type the event ID to reset this staging event</span><input name="confirmation" required autoComplete="off" /></label>
              <button type="submit">Reset staging event</button>
            </form>
          ) : <p className="organizer-panel-note">Reset is locked unless staging is active and this market is complete.</p>}
        </article>
      </section>

      <section className="organizer-section" aria-labelledby="solves-title">
        <header className="organizer-section-head">
          <div><span>Live activity</span><h2 id="solves-title">Completed challenges</h2></div>
          <strong>{completedSolves.length} total</strong>
        </header>
        <p className="organizer-section-intro">A read-only record of the latest verified completions.</p>
        <div className="solve-activity">
          {completedSolves.length === 0 ? (
            <div className="review-empty"><h2>No completed challenges yet</h2><p>Verified completions will appear here as they arrive.</p></div>
          ) : completedSolves.map((solve) => (
            <article className="solve-activity-row" key={solve.sourceId}>
              <strong title={solve.participantName}>{solve.participantName}</strong>
              <span>{solve.challengeName}</span>
              <time dateTime={new Date(solve.occurredAt).toISOString()}>{dateTime(solve.occurredAt)}</time>
            </article>
          ))}
        </div>
      </section>

      <section className="organizer-section" aria-labelledby="observations-title">
        <header className="organizer-section-head">
          <div><span>Read only</span><h2 id="observations-title">Integrity observations</h2></div>
          <strong>{observations.length} recent</strong>
        </header>
        <p className="organizer-section-intro">These signals provide context for organizers. They do not block access, change points, or alter the leaderboard.</p>
        <div className="integrity-observations">
          {observations.length === 0 ? (
            <div className="review-empty"><h2>No observations recorded</h2><p>New integrity telemetry will appear here.</p></div>
          ) : observations.map((observation) => (
            <article className="integrity-observation" key={observation.id}>
              <div>
                <strong>{participantNames.get(observation.participantId) || observation.email || observation.participantId || "Participant unavailable"}</strong>
                <span>{CHALLENGES[observation.challenge] || observation.challenge}</span>
              </div>
              <div className="integrity-reason">
                <strong>{reasonFor(observation).label}</strong>
                {reasonFor(observation).detail ? <span>{reasonFor(observation).detail}</span> : null}
              </div>
              <time dateTime={observation.createdAt ? new Date(observation.createdAt).toISOString() : undefined}>{dateTime(observation.createdAt)}</time>
              <span className={`signal signal-${observation.confidence}`}>{observation.confidence}</span>
              <details className="integrity-detail" open={observation.confidence === "high"}>
                <summary>Recorded details</summary>
                <p>{observation.summary || "No additional summary recorded."}</p>
                <div className="integrity-detail-grid">
                  <div><span>Participant</span><strong>{observation.email || observation.participantId || "Not recorded"}</strong></div>
                  <div><span>Occurrences</span><strong>{observation.occurrences || 1}</strong></div>
                  <div><span>First recorded</span><strong>{dateTime(observation.createdAt)}</strong></div>
                  <div><span>Last updated</span><strong>{dateTime(observation.updatedAt)}</strong></div>
                </div>
                {evidenceRows(observation).map((evidence, index) => (
                  <section className="integrity-evidence" key={`${observation.id}-${evidence.at || index}`}>
                    <header><strong>Evidence {evidenceRows(observation).length - index}</strong><time dateTime={evidence.at ? new Date(evidence.at).toISOString() : undefined}>{dateTime(evidence.at)}</time></header>
                    <div className="integrity-detail-grid">
                      <div><span>Reported agent</span><strong>{evidenceValue(evidence.details?.reportedAgent)}</strong></div>
                      <div><span>Reported model</span><strong>{evidenceValue(evidence.details?.reportedModel)}</strong></div>
                      <div><span>Client</span><strong>{evidenceValue(evidence.request?.userAgent)}</strong></div>
                      <div><span>Policy location</span><strong>{evidenceValue(evidence.details?.placement)}</strong></div>
                      <div><span>Request scope</span><strong>{evidenceValue(evidence.scope)}</strong></div>
                      <div><span>Network reference</span><strong>{evidenceValue(evidence.request?.ipHash)}</strong></div>
                    </div>
                  </section>
                ))}
                {observation.timeline?.length ? (
                  <section className="integrity-timeline">
                    <h3>Session timeline</h3>
                    <ol>
                      {observation.timeline.slice(-12).map((entry, index) => (
                        <li key={`${entry.at || index}-${entry.action || "activity"}`}><strong>{entry.action || "Activity"}</strong><time dateTime={entry.at ? new Date(entry.at).toISOString() : undefined}>{dateTime(entry.at)}</time></li>
                      ))}
                    </ol>
                  </section>
                ) : null}
              </details>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
