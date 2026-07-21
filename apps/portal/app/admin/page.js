import { redirect } from "next/navigation";

import { currentUser, isOrganizer } from "@/lib/auth";
import { cachedPortalHealth } from "@/lib/health.mjs";
import { rewardIntegrityReport } from "@/lib/integrity.mjs";
import { configForLifecyclePhase, resolveLeaderboardConfig } from "@/lib/leaderboard-lifecycle.mjs";
import { leaderboardSnapshot } from "@/lib/leaderboard-service.mjs";
import { createLeaderboardStore } from "@/lib/leaderboard-store.mjs";

import { EligibilityControls, FinalizeControl, LifecycleControls } from "./AdminActions";

export const dynamic = "force-dynamic";

const REASONS = {
  "agent-disclosure-followed": ["Agent self-disclosure", "An AI agent followed a personalized instruction embedded in the challenge and reported its own use."],
  "agent-only-solver-context-fetched": ["Agent-only link opened", "The participant opened a personalized route mentioned only in instructions intended for AI agents."],
  "known-ai-client-workflow": ["Known AI client workflow", "An authenticated challenge action identified itself as coming from a known AI client. Review the full activity before deciding."],
  "non-browser-interface-navigation": ["Unusual interface navigation", "The interface was fetched with request context inconsistent with ordinary browser navigation."],
  "missing-browser-execution-evidence": ["Interface boot not observed", "A scored action arrived without a successful browser boot event from the authenticated session."],
  "browser-automation-indicator": ["Browser automation indicator", "The browser exposed its standardized WebDriver automation flag during application boot."],
  "challenge-solved-unusually-fast": ["Unusually fast completion", "The first accepted completion arrived inside the configured review window or materially before its recorded launch. This is a review signal only."],
};

const SIGNALS = {
  "completion-inside-fast-solve-window": "Completion arrived inside the fast-solve review window",
  "completion-before-recorded-launch": "Completion predates the first recorded challenge launch",
  "known-ai-client-identifier": "Request identified itself as a known AI client",
  "known-ai-client-performed-scored-action": "A known AI client identifier appeared on a scored action",
  "agent-policy-read-before-challenge-action": "The same AI client family read the policy before acting",
  "browser-automation-indicator": "The browser exposed a WebDriver automation indicator",
  "scored-action-without-authenticated-app-boot": "A scored action occurred without an authenticated application boot",
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

function reasonFor(integrityCase) {
  return REASONS[integrityCase.reasonCode] || ["Unusual activity", integrityCase.summary];
}

function caseSignals(integrityCase) {
  return [...new Set((integrityCase.evidence || []).flatMap((entry) => entry.details?.signals || []))];
}

function participantDecision(decision) {
  return String(decision?.participantId || "");
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
    store.eligibilityLedger(),
    store.eligibilityProposals(),
    store.fastSolveReviews(),
    store.rulesAcknowledgments(),
    cachedPortalHealth(),
  ]);
  const report = valueOf(results[0], { cases: [], event: {} });
  const snapshot = valueOf(results[1], null);
  const ledger = valueOf(results[2], { decisions: [], revision: 0, frozen: false, freeze: null });
  const proposals = valueOf(results[3], []);
  const fastReviews = valueOf(results[4], []);
  const acknowledgments = valueOf(results[5], []);
  const health = valueOf(results[6], null);
  const unresolved = (report.cases || []).filter((entry) => entry.status !== "cleared");
  const pendingFastReviews = fastReviews.filter((entry) => entry.deliveryStatus !== "delivered");
  const canReset = scoring.scoringMode === "staging" && report.event?.stage === "complete";
  const normalizedProposals = proposals.map((proposal) => ({
    ...proposal,
    participantId: participantDecision(proposal),
  }));
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
        <p>Review event health, scoring, integrity signals, and eligibility from one place. Signals never change points automatically.</p>
      </header>

      <section className="organizer-status-grid" aria-label="Event status">
        <article>
          <span>Readiness</span>
          <strong className={health?.ok ? "status-ready" : "status-attention"}>{health?.ok ? "Ready" : "Attention"}</strong>
          <small>{health?.ok ? `${health.challenges} services and ${health.organizers?.count ?? 0} organizers checked` : "One or more readiness checks failed"}</small>
        </article>
        <article>
          <span>Scoring</span>
          <strong>{scoring.scoringMode}</strong>
          <small>{dateTime(scoring.scoringStartAt)} to {dateTime(scoring.scoringEndAt)}</small>
        </article>
        <article>
          <span>Leaderboard</span>
          <strong>{snapshot?.finalizedAt ? "Final" : snapshot ? "Live" : "Unavailable"}</strong>
          <small>{snapshot ? `${snapshot.rows.length} scoring participants` : "Snapshot could not be read"}</small>
        </article>
        <article>
          <span>Review queue</span>
          <strong>{unresolved.length + pendingFastReviews.length}</strong>
          <small>{pendingFastReviews.length ? `${pendingFastReviews.length} signal delivery pending` : "All signals synchronized"}</small>
        </article>
      </section>

      <section className="organizer-two-column" aria-label="Event lifecycle">
        <article className="organizer-panel">
          <header><div><span>Lifecycle</span><h2>Scoring window</h2></div><span className={`organizer-chip chip-${scoring.scoringMode}`}>{scoring.scoringMode}</span></header>
          <dl className="organizer-facts">
            <div><dt>Generation</dt><dd>{scoring.eventGeneration}</dd></div>
            <div><dt>Participants</dt><dd>{scoring.fieldSize} checked in</dd></div>
            <div><dt>Rules accepted</dt><dd>{acknowledgments.length}</dd></div>
            <div><dt>Recovery</dt><dd>{scoring.recoveryMinutes} minutes</dd></div>
            <div><dt>New sessions</dt><dd>{scoring.launchPaused ? "Paused" : scoring.scoringMode === "staging" ? "Rehearsal open" : scoring.scoringMode === "live" ? "Window gated" : "Closed"}</dd></div>
          </dl>
          <p className="organizer-panel-note">The canonical schedule and award policy stay immutable. Operational phase and challenge admission advance here and cannot roll backward.</p>
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
            <form className="organizer-reset" action="/api/admin/integrity/reset" method="post">
              <input type="hidden" name="eventId" value={report.event.eventId} />
              <label><span>Type the event ID to reset this staging event</span><input name="confirmation" required autoComplete="off" /></label>
              <button type="submit">Reset staging event</button>
            </form>
          ) : <p className="organizer-panel-note">Reset is locked unless staging is active and this market is complete.</p>}
        </article>
      </section>

      <section className="organizer-section" aria-labelledby="review-title">
        <header className="organizer-section-head">
          <div><span>Manual review</span><h2 id="review-title">Integrity signals</h2></div>
          <strong>{unresolved.length} open</strong>
        </header>
        {pendingFastReviews.length ? (
          <div className="organizer-sync-warning" role="status">
            <div><strong>{pendingFastReviews.length} fast-solve signal{pendingFastReviews.length === 1 ? " is" : "s are"} waiting to synchronize</strong><span>Scores are unchanged. Retry delivery to place them in the review queue.</span></div>
            <form action="/api/admin/integrity/retry-fast-solves" method="post"><button type="submit">Retry delivery</button></form>
          </div>
        ) : null}
        <div className="review-list">
          {unresolved.length === 0 ? (
            <div className="review-empty"><h2>No active signals</h2><p>New review-only detections will appear here.</p></div>
          ) : unresolved.map((integrityCase) => {
            const [reasonLabel, explanation] = reasonFor(integrityCase);
            const signals = caseSignals(integrityCase);
            return (
              <article className="review-item" key={integrityCase.id}>
                <header className="review-item-head">
                  <div className="review-person">
                    <h2>{integrityCase.email || integrityCase.participantId || "Participant unavailable"}</h2>
                    <span className={`signal signal-${integrityCase.confidence}`}>{integrityCase.confidence}</span>
                    <span className={`case-status case-status-${integrityCase.status}`}>{integrityCase.status}</span>
                  </div>
                  <div className="review-actions" aria-label="Review decision">
                    {integrityCase.status !== "reviewing" ? <form action={`/api/admin/integrity/${integrityCase.id}`} method="post"><input type="hidden" name="status" value="reviewing" /><input type="hidden" name="note" value="Organizer review started." /><button type="submit">Review</button></form> : null}
                    <form action={`/api/admin/integrity/${integrityCase.id}`} method="post"><input type="hidden" name="status" value="cleared" /><input type="hidden" name="note" value="Organizer review cleared this signal." /><button type="submit">Clear</button></form>
                    {integrityCase.status !== "confirmed" ? <form action={`/api/admin/integrity/${integrityCase.id}`} method="post"><input type="hidden" name="status" value="confirmed" /><input type="hidden" name="note" value="Organizer review confirmed this signal. Eligibility is decided separately." /><button className="review-confirm" type="submit">Confirm</button></form> : null}
                  </div>
                </header>
                <div className="review-summary">
                  <strong>{CHALLENGES[integrityCase.challenge] || integrityCase.challenge}: {reasonLabel}</strong>
                  <span>{dateTime(integrityCase.createdAt)}</span>
                  <p>{explanation}</p>
                </div>
                {signals.length ? <ul className="review-signals">{signals.map((signal) => <li key={signal}>{SIGNALS[signal] || signal.replaceAll("-", " ")}</li>)}</ul> : null}
                <details className="review-details">
                  <summary>View activity and evidence</summary>
                  <div className="review-detail-body">
                    <h3>Activity</h3>
                    <ol className="review-activity">{(integrityCase.timeline || []).map((entry, index) => <li key={`${entry.at}-${index}`}><span>{dateTime(entry.at)}</span><strong>{String(entry.action || "activity").replaceAll("-", " ")}</strong></li>)}</ol>
                    <h3>Technical evidence</h3>
                    {(integrityCase.evidence || []).map((entry, index) => <div className="review-evidence" key={`${entry.at}-${index}`}><p><strong>{dateTime(entry.at)}</strong></p><pre>{JSON.stringify(entry.details, null, 2)}</pre></div>)}
                  </div>
                </details>
              </article>
            );
          })}
        </div>
      </section>

      <section className="organizer-section" aria-labelledby="eligibility-title">
        <header className="organizer-section-head">
          <div><span>Two-organizer control</span><h2 id="eligibility-title">Eligibility ledger</h2></div>
          <strong>Revision {ledger.revision}</strong>
        </header>
        {ledger.decisions.length ? (
          <div className="organizer-decisions">
            {ledger.decisions.map((decision) => <article key={`${participantDecision(decision)}-${decision.approvedAt || decision.proposedAt}`}><strong>{participantDecision(decision)}</strong><span>{decision.status}</span><p>{decision.reason}</p><small>Approved by {decision.approver}</small></article>)}
          </div>
        ) : <p className="admin-inline-note">No eligibility decisions have been approved.</p>}
        <EligibilityControls proposals={normalizedProposals} frozen={ledger.frozen} />
      </section>
    </main>
  );
}
