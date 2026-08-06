import { notFound } from "next/navigation";

import { PUBLIC_CHALLENGES, publicChallengeByKey } from "@/lib/public-challenges.mjs";

export function generateStaticParams() {
  return PUBLIC_CHALLENGES.map((challenge) => ({ challenge: challenge.key }));
}

export async function generateMetadata({ params }) {
  const { challenge: key } = await params;
  const challenge = publicChallengeByKey(key);
  if (!challenge) return {};
  return {
    title: `${challenge.name} · stCTF archive`,
    description: challenge.summary,
  };
}

export default async function ChallengeDetails({ params }) {
  const { challenge: key } = await params;
  const challenge = publicChallengeByKey(key);
  if (!challenge) notFound();

  return (
    <main className="shell detail-shell">
      <nav className="topbar" aria-label="Archive navigation">
        <a className="wordmark" href="/" aria-label="stCTF home">
          <span aria-hidden="true">[ st</span><strong>CTF</strong><span aria-hidden="true"> ]</span>
        </a>
        <a className="detail-back" href="/#challenges">Back to challenges</a>
      </nav>

      <article className="public-detail">
        <header className="detail-intro">
          <div className="detail-number" aria-hidden="true">{challenge.number}</div>
          <div>
            <p className="kicker">{challenge.discipline}</p>
            <h1>{challenge.name}</h1>
            <p className="detail-lede">{challenge.summary}</p>
          </div>
        </header>

        <section className="detail-workbench" aria-label="Challenge access">
          <div className="workbench-primary">
            <p className="workbench-label">Original experience</p>
            <h2>{challenge.experience}</h2>
            <p>
              The live service has been retired. The complete implementation, player surface,
              program code, and local setup are preserved in the repository.
            </p>
          </div>
          <div className="workbench-actions">
            <a className="button button-primary" href={challenge.sourceUrl}>Open source</a>
            {challenge.packageHref ? (
              <a className="button button-secondary" href={challenge.packageHref} download>Download player kit</a>
            ) : null}
          </div>
        </section>

        <section className="detail-path">
          <span>Repository path</span>
          <code>{challenge.sourcePath}</code>
          <p>Start with the README in this directory, then follow its local environment and chain setup.</p>
        </section>
      </article>

      <footer className="archive-footer">
        <span>Public post-event edition</span>
        <a href="/">All challenges</a>
      </footer>
    </main>
  );
}
