import { notFound, redirect } from "next/navigation";

import { currentUser } from "@/lib/auth";
import { challengeByKey, challengeDestination } from "@/lib/challenges.mjs";
import { createChallengeTicket } from "@/lib/tickets";

export const dynamic = "force-dynamic";

async function sshAccess(challenge, user) {
  const destination = challengeDestination(challenge);
  if (!destination.ticketed) return null;

  const ticket = createChallengeTicket(user, challenge.audience);
  destination.url.searchParams.set("ticket", ticket);

  const response = await fetch(destination.url, {
    cache: "no-store",
    headers: { accept: "application/json" },
  });
  if (!response.ok) throw new Error("SSH access could not be created");
  return response.json();
}

export default async function ChallengeDetails({ params }) {
  const user = await currentUser();
  if (!user) redirect("/?error=session_required");

  const { challenge: challengeKey } = await params;
  const challenge = challengeByKey(challengeKey);
  if (!challenge || challenge.key !== "last-stop") notFound();

  let access = null;
  let unavailable = false;
  try {
    access = await sshAccess(challenge, user);
    unavailable = !access;
  } catch {
    unavailable = true;
  }

  return (
    <main className="shell detail-shell">
      <nav className="topbar" aria-label="Event">
        <a className="wordmark" href="/" aria-label="CTF26 home">
          <span aria-hidden="true">[ st</span><strong>CTF</strong><span aria-hidden="true"> ]</span>
        </a>
        <a className="detail-back" href="/">Back to challenges</a>
      </nav>

      <section className="challenge-detail">
        <header className="detail-heading">
          <p className="kicker">Hosted SSH</p>
          <h1>{challenge.name}</h1>
          <p>{challenge.copy}</p>
        </header>

        {unavailable ? (
          <div className="connection-panel connection-error" role="alert">
            <h2>Connection details unavailable</h2>
            <p>Refresh this page to create a new SSH password. If it still fails, ask an organizer for help.</p>
          </div>
        ) : (
          <div className="connection-panel">
            <div className="connection-header">
              <div>
                <span className="connection-label">Terminal command</span>
                <code>{access.command}</code>
              </div>
              <span className="connection-status"><span aria-hidden="true" />Ready</span>
            </div>
            <div className="connection-password">
              <span className="connection-label">One-time password</span>
              <code>{access.password}</code>
            </div>
            <p className="connection-note">
              Open a terminal, run the command, then enter the password when prompted. The password works once and expires in ten minutes.
            </p>
          </div>
        )}
      </section>
    </main>
  );
}
