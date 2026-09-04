import { DISPLAY_CHALLENGES } from "@/lib/challenges.mjs";

export default function Home() {
  return (
    <main className="shell board-shell">
      <nav className="topbar" aria-label="Event">
        <a className="wordmark" href="/" aria-label="stCTF home">
          <span aria-hidden="true">[ st</span><strong>CTF</strong><span aria-hidden="true"> ]</span>
        </a>
        <span className="event-mode">Public version</span>
      </nav>

      <header className="board-header">
        <div>
          <h1>Challenges</h1>
        </div>
        <p className="board-summary">Choose a challenge and start playing.</p>
      </header>

      <section className="challenge-grid" aria-label="Challenges">
        {DISPLAY_CHALLENGES.map((challenge, index) => (
          <article className={`challenge challenge-${challenge.key}`} key={challenge.key}>
            <div className="challenge-visual" aria-hidden="true">
              <span className="challenge-visual-glyph" />
            </div>
            <div className="challenge-number" aria-hidden="true">
              {String(index + 1).padStart(2, "0")}
            </div>
            <div className="challenge-content">
              <div>
                <div className="challenge-title-row">
                  <h2>{challenge.name}</h2>
                </div>
                <p>{challenge.copy}</p>
              </div>
              <div className={`challenge-actions ${challenge.starts.length > 1 ? "challenge-actions-split" : ""}`}>
                {challenge.starts.map((start) => {
                  const download = start.kind === "download";
                  const href = download ? start.href : `/api/play/${challenge.key}`;
                  return (
                    <a
                      className={`challenge-action challenge-action-${start.kind}`}
                      download={download ? true : undefined}
                      href={href}
                      key={`${start.kind}-${start.label}`}
                      rel={download ? undefined : "noopener noreferrer"}
                      target={download ? undefined : "_blank"}
                    >
                      <span className="action-copy"><strong>{start.label}</strong></span>
                      {!download ? <span className="external-mark" aria-hidden="true">↗</span> : null}
                    </a>
                  );
                })}
              </div>
            </div>
          </article>
        ))}
      </section>

      <footer className="board-footer">
        <p>Public version. Event scoring is disabled.</p>
        <a className="plain" href="https://github.com/GitBolt/ctf26">Source</a>
      </footer>
    </main>
  );
}
