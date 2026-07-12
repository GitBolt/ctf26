import { CHALLENGES } from "@/lib/challenges.mjs";
import { currentUser, isOrganizer } from "@/lib/auth";

export default async function Home({ searchParams }) {
  const user = await currentUser();
  const params = await searchParams;
  const error = params?.error || "";

  if (!user) {
    return (
      <main className="shell auth-shell">
        <nav className="topbar" aria-label="Event">
          <a className="wordmark" href="/" aria-label="CTF26 home">
            CTF<span>26</span>
          </a>
          <span className="event-mode">In-person security event</span>
        </nav>

        <section className="auth-stage">
          <div className="auth-intro">
            <p className="kicker">Participant check-in</p>
            <h1>Enter the challenge room.</h1>
            <p className="lede">
              Four Solana security systems. One live field. Your account binds
              challenge activity to your event identity.
            </p>
          </div>

          <div className="auth-panel">
            <div>
              <p className="panel-title">Continue to the board</p>
              <p className="muted">
                Use the same Google account you registered with. You will stay
                signed in for the duration of the event.
              </p>
            </div>
            {error ? (
              <p className="error" role="alert">
                Sign-in failed. Please try again or ask an organizer for help.
              </p>
            ) : null}
            <a className="button button-primary" href="/api/auth/google/start">
              Continue with Google
              <span aria-hidden="true">↗</span>
            </a>
            {process.env.NODE_ENV !== "production" &&
            process.env.ALLOW_DEV_LOGIN === "true" ? (
              <a className="textlink" href="/api/auth/dev?email=demo@ctf26.test">
                Use local development account
              </a>
            ) : null}
          </div>
        </section>

        <footer className="auth-footer">
          <span>Superteam Solana Security CTF</span>
          <span>Registered participants only</span>
        </footer>
      </main>
    );
  }

  return (
    <main className="shell board-shell">
      <nav className="topbar" aria-label="Event">
        <a className="wordmark" href="/" aria-label="CTF26 home">
          CTF<span>26</span>
        </a>
        <div className="session-state">
          <span className="status-dot" aria-hidden="true" />
          Session active
          {isOrganizer(user) ? <a className="admin-link" href="/admin/integrity">Integrity review</a> : null}
        </div>
      </nav>

      <header className="board-header">
        <div>
          <p className="kicker">Challenge board</p>
          <h1>Choose your next system.</h1>
        </div>
        <p className="board-summary">
          Download briefings, open live systems, and return here whenever you
          want to switch challenges.
        </p>
      </header>

      <section className="identity" aria-label="Current participant">
        <div className="identity-name">
          <span>Signed in as</span>
          <strong>{user.name || user.email}</strong>
        </div>
        <div>
          <span>Participant</span>
          <strong>{user.participant_id}</strong>
        </div>
        <div>
          <span>Team</span>
          <strong>{user.team_id}</strong>
        </div>
      </section>

      <section className="challenge-grid" aria-label="Challenges">
        {CHALLENGES.map((challenge) => (
          <article className="challenge" key={challenge.key} id={`${challenge.key}-local-kit`}>
            <div className="challenge-number" aria-hidden="true">
              {challenge.number}
            </div>
            <div className="challenge-content">
              <div className="challenge-meta">
                <span>{challenge.label}</span>
                <span>{challenge.format}</span>
              </div>
              <div>
                <h2>{challenge.name}</h2>
                <p>{challenge.copy}</p>
              </div>
              <div className={`challenge-actions ${challenge.starts.length > 1 ? "challenge-actions-split" : ""}`}>
                {challenge.starts.map((start) => {
                  const href = start.kind === "launch" ? `/api/launch/${challenge.key}` : start.href;
                  return (
                    <a
                      className={`challenge-action challenge-action-${start.kind}`}
                      download={start.kind === "download" ? true : undefined}
                      href={href}
                      key={`${start.kind}-${start.label}`}
                      rel={start.kind === "launch" ? "noopener noreferrer" : undefined}
                      target={start.kind === "launch" ? "_blank" : undefined}
                    >
                      <span className="action-copy">
                        <strong>{start.label}</strong>
                      </span>
                      {start.kind === "launch" ? <span className="external-mark" aria-hidden="true">↗</span> : null}
                    </a>
                  );
                })}
              </div>
            </div>
          </article>
        ))}
      </section>

      <footer className="board-footer">
        <p>
          If a challenge does not open, return to this board and try again.
        </p>
        <form action="/api/auth/logout" method="post">
          <button className="plain" type="submit">
            Sign out
          </button>
        </form>
      </footer>
    </main>
  );
}
