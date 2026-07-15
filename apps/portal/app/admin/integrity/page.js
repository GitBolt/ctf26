import { redirect } from "next/navigation";
import { currentUser, isOrganizer } from "@/lib/auth";
import { rewardIntegrityReport } from "@/lib/integrity.mjs";

export const dynamic = "force-dynamic";

const REASONS = {
  "agent-disclosure-followed": {
    label: "Agent self-disclosure",
    explanation: "An AI agent followed the personalized instruction embedded in the challenge and reported its own use.",
  },
  "agent-only-solver-context-fetched": {
    label: "Agent-only link opened",
    explanation: "The participant session opened a personalized route mentioned only in instructions intended for AI agents.",
  },
  "autonomous-workflow-pattern": {
    label: "Automated play pattern",
    explanation: "The participant’s requests matched several automation signals during live play. Review the activity before drawing a conclusion.",
  },
};

const SIGNALS = {
  "explicit-searcher-session": "Created a dedicated searcher session",
  "repeated-searcher-actions": "Repeated actions through the searcher API",
  "browser-session-token-replayed-as-bearer": "Replayed a browser session as an API token",
  "repeated-direct-browser-token-actions": "Repeated direct actions using a browser token",
  "browser-cookie-used-by-non-browser-client": "Used a browser cookie from a non-browser client",
  "browser-actions-without-correlated-ui-controls": "Submitted actions without matching interface clicks",
  "no-correlated-ui-events": "No matching interface activity was recorded",
  "subsecond-market-polling": "Polled the market faster than once per second",
  "sustained-direct-api-control": "Maintained sustained direct API control",
};

const CHALLENGES = { "reward-sniper": "Reward Sniper", imprint: "IMPRINT", signet: "SIGNET", drift: "DRIFT" };

function dateTime(value) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Kolkata",
  }).format(new Date(value));
}

function humanAction(value) {
  return String(value || "activity")
    .replaceAll(":", " · ")
    .replaceAll("-", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function reasonFor(integrityCase) {
  return REASONS[integrityCase.reasonCode] || {
    label: "Unusual activity",
    explanation: integrityCase.summary,
  };
}

function caseSignals(integrityCase) {
  return [...new Set(integrityCase.evidence.flatMap((entry) => entry.details?.signals || []))];
}

export default async function IntegrityAdmin() {
  const user = await currentUser();
  if (!user) redirect("/?error=admin_sign_in");
  if (!isOrganizer(user)) redirect("/");
  const report = await rewardIntegrityReport();
  const suspicions = report.cases.filter((entry) => entry.status !== "cleared");

  return (
    <main className="shell admin-shell">
      <nav className="topbar" aria-label="Organizer">
        <a className="wordmark" href="/" aria-label="CTF26 home"><span aria-hidden="true">[ st</span><strong>CTF</strong><span aria-hidden="true"> ]</span></a>
        <div className="admin-nav">
          <span>{user.email}</span>
          <a href="/">Challenge board</a>
        </div>
      </nav>

      <header className="review-header">
        <h1>Suspicions <span>{suspicions.length}</span></h1>
        <p>Possible AI-assisted play for organizer review. These are signals, not automatic decisions.</p>
      </header>

      <section className="review-toolbar" aria-label="Current Reward Sniper event">
        <p><strong>Reward Sniper</strong> · {report.event.stage} · round {report.event.round} · tick {report.event.tick}</p>
        <form action="/api/admin/integrity/reset" method="post">
          <input type="hidden" name="eventId" value={report.event.eventId} />
          <button type="submit" disabled={report.event.stage !== "complete"}>
            {report.event.stage === "complete" ? "Start new test event" : "Event in progress"}
          </button>
        </form>
      </section>

      <section className="review-list" aria-label="Suspicion feed">
        {suspicions.length === 0 ? (
          <div className="review-empty">
            <h2>No active suspicions</h2>
            <p>New detection signals will appear here.</p>
          </div>
        ) : suspicions.map((integrityCase) => {
          const reason = reasonFor(integrityCase);
          const signals = caseSignals(integrityCase);
          return (
            <article className="review-item" key={integrityCase.id}>
              <header className="review-item-head">
                <div className="review-person">
                  <h2>{integrityCase.email || "Email unavailable"}</h2>
                  <span className={`signal signal-${integrityCase.confidence}`}>{integrityCase.confidence}</span>
                </div>
                <form action={`/api/admin/integrity/${integrityCase.id}`} method="post">
                  <input type="hidden" name="status" value="cleared" />
                  <input type="hidden" name="note" value="Dismissed from the organizer suspicion feed." />
                  <button className="review-dismiss" type="submit" aria-label={`Dismiss suspicion for ${integrityCase.email || "this participant"}`} title="Dismiss">×</button>
                </form>
              </header>

              <div className="review-summary">
                <strong>{CHALLENGES[integrityCase.challenge] || integrityCase.challenge} · {reason.label}</strong>
                <span>{dateTime(integrityCase.createdAt)}</span>
                <p>{reason.explanation}</p>
              </div>

              {signals.length > 0 ? (
                <ul className="review-signals" aria-label="Detection signals">
                  {signals.map((signal) => <li key={signal}>{SIGNALS[signal] || humanAction(signal)}</li>)}
                </ul>
              ) : null}

              <details className="review-details">
                <summary>View activity and evidence</summary>
                <div className="review-detail-body">
                  {!integrityCase.email ? <p className="review-note">This record predates email collection.</p> : null}
                  <h3>Activity</h3>
                  <ol className="review-activity">
                    {integrityCase.timeline.map((entry, index) => (
                      <li key={`${entry.at}-${entry.action}-${index}`}>
                        <span>{dateTime(entry.at)}</span>
                        <strong>{humanAction(entry.action)}</strong>
                        <small>Tick {entry.tick} · {entry.phase}</small>
                      </li>
                    ))}
                  </ol>
                  <h3>Technical evidence</h3>
                  {integrityCase.evidence.map((entry, index) => (
                    <div className="review-evidence" key={`${entry.at}-${index}`}>
                      <p><strong>{dateTime(entry.at)}</strong> · Tick {entry.tick} · {entry.scope}</p>
                      <pre>{JSON.stringify(entry.details, null, 2)}</pre>
                      <small>{entry.request.userAgent || "Unknown user agent"} · IP fingerprint {entry.request.ipHash || "none"}</small>
                    </div>
                  ))}
                </div>
              </details>
            </article>
          );
        })}
      </section>
    </main>
  );
}
