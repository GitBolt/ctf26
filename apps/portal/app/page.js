import { PUBLIC_CHALLENGES } from "@/lib/public-challenges.mjs";

export default function Home() {
  return (
    <main className="shell archive-shell">
      <nav className="topbar" aria-label="Archive navigation">
        <a className="wordmark" href="/" aria-label="stCTF home">
          <span aria-hidden="true">[ st</span><strong>CTF</strong><span aria-hidden="true"> ]</span>
        </a>
        <span className="archive-state">Public archive</span>
      </nav>

      <header className="archive-hero">
        <div className="hero-copy">
          <p className="kicker">Superteam Solana Security CTF</p>
          <h1>Eleven challenges, now open for study.</h1>
          <p className="lede">
            Explore the systems, interfaces, and source behind the in-person CTF.
            Each challenge teaches a different failure mode in Solana security.
          </p>
          <div className="hero-actions">
            <a className="button button-primary" href="#challenges">Browse challenges</a>
            <a className="button button-secondary" href="https://github.com/GitBolt/ctf26">View source</a>
          </div>
        </div>

        <div className="archive-diagram" aria-label="Eleven challenge disciplines connected to one Solana security field">
          <div className="diagram-core">
            <span>Solana</span>
            <strong>security</strong>
          </div>
          <div className="diagram-orbit" aria-hidden="true">
            {PUBLIC_CHALLENGES.slice(0, 6).map((challenge) => (
              <span key={challenge.key}>{challenge.number}</span>
            ))}
          </div>
        </div>
      </header>

      <aside className="event-note">
        <strong>About the live event</strong>
        <p>
          The production run used approved Google accounts, short-lived participant tickets,
          isolated challenge state, and integrity telemetry to limit unattended agent solving.
          This public edition intentionally removes sign-in, scoring, and live-event gates.
        </p>
      </aside>

      <section className="archive-section" id="challenges" aria-labelledby="challenge-heading">
        <div className="section-heading">
          <div>
            <p className="kicker">Challenge catalogue</p>
            <h2 id="challenge-heading">Choose a system to inspect</h2>
          </div>
          <p>Ordered from the fastest, most approachable experiences to the deepest technical investigations.</p>
        </div>

        <div className="public-challenge-grid">
          {PUBLIC_CHALLENGES.map((challenge) => (
            <article className="public-challenge" key={challenge.key}>
              <div className="challenge-index" aria-hidden="true">{challenge.number}</div>
              <div className="challenge-copy">
                <p className="challenge-discipline">{challenge.discipline}</p>
                <h3>{challenge.name}</h3>
                <p>{challenge.summary}</p>
              </div>
              <div className="challenge-meta">
                <span>{challenge.experience}</span>
                <a href={`/challenge/${challenge.key}`}>
                  Explore challenge <span aria-hidden="true">↗</span>
                </a>
              </div>
            </article>
          ))}
        </div>
      </section>

      <footer className="archive-footer">
        <span>Built for Superteam’s in-person Solana security CTF</span>
        <a href="https://github.com/GitBolt/ctf26">Source and local setup</a>
      </footer>
    </main>
  );
}
