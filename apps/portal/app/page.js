import { cookies } from "next/headers";

import { CHALLENGES } from "@/lib/challenges.mjs";
import { currentUser, isOrganizer } from "@/lib/auth";
import {
  afterHoursCompletion,
  broadcastCompletion,
  completedChallengeKeys,
  driftCompletion,
  lastStopCompletion,
  evidenceRoomCompletion,
  playerTwoCompletion,
  recoverLeaderboardCompletions,
  secondKeyCompletion,
  signetCompletion,
} from "@/lib/completions.mjs";
import { resolveLeaderboardConfig } from "@/lib/leaderboard-lifecycle.mjs";
import { createLeaderboardStore } from "@/lib/leaderboard-store.mjs";
import { consumePortalRequestBudget } from "@/lib/request-budget.mjs";
import { RULES_COOKIE, RULES_VERSION, verifyRulesAcknowledgment } from "@/lib/tickets";

const COMPLETION_READERS = Object.freeze([
  ["signet", signetCompletion],
  ["drift", driftCompletion],
  ["last-stop", lastStopCompletion],
  ["after-hours", afterHoursCompletion],
  ["player-two", playerTwoCompletion],
  ["the-broadcast", broadcastCompletion],
  ["evidence-room", evidenceRoomCompletion],
  ["second-key", secondKeyCompletion],
]);

export default async function Home({ searchParams }) {
  const user = await currentUser();
  const params = await searchParams;
  const error = params?.error || "";

  if (!user) {
    return (
      <main className="shell auth-shell">
        <nav className="topbar" aria-label="Event">
          <a className="wordmark" href="/" aria-label="CTF26 home">
            <span aria-hidden="true">[ st</span><strong>CTF</strong><span aria-hidden="true"> ]</span>
          </a>
        </nav>

        <section className="auth-stage">
          <div className="auth-intro">
            <p className="kicker">Participant sign-in</p>
            <h1>Sign in to the challenge board.</h1>
            <p className="lede">
              Use the Google account you registered with to access challenge
              links and downloads.
            </p>
          </div>

          <div className="auth-panel">
            <div>
              <p className="panel-title">Sign in</p>
              <p className="muted">
                Your session stays active during the event.
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

  const leaderboardStore = createLeaderboardStore();
  await leaderboardStore.upsertProfile(user).catch(() => null);
  const jar = await cookies();
  const rulesAccepted = verifyRulesAcknowledgment(jar.get(RULES_COOKIE)?.value || "", user);

  if (!rulesAccepted) {
    return (
      <main className="shell board-shell">
        <nav className="topbar" aria-label="Event">
          <a className="wordmark" href="/" aria-label="CTF26 home">
            <span aria-hidden="true">[ st</span><strong>CTF</strong><span aria-hidden="true"> ]</span>
          </a>
        </nav>
        <section className="rules-panel" aria-labelledby="rules-title">
          <p className="kicker">Event rules</p>
          <h1 id="rules-title">Confirm before you play</h1>
          <p className="rules-intro">These rules apply to every participant and every scored challenge.</p>
          {error === "rules_required" ? <p className="error" role="alert">Accept the event rules before opening a challenge.</p> : null}
          {error === "rules_save_failed" ? <p className="error" role="alert">Your acceptance could not be saved. Please try again or ask an organizer for help.</p> : null}
          <ul className="rules-list">
            <li>Solve only as the registered participant. Do not share or receive flags, solutions, credentials, or challenge access.</li>
            <li>Public documentation, general concept questions, ordinary non-agent code completion, translation, and accessibility tools are allowed.</li>
            <li>Do not give challenge files, screenshots, code, logs, account data, or challenge-specific tasks to an AI system.</li>
            <li>Do not use an AI or outside operator to control a browser, terminal, wallet, RPC client, debugger, or submission, or to construct a scored exploit.</li>
            <li>Do not attack the event infrastructure, other participants, shared services, or anything outside the challenge scope.</li>
            <li>Use disposable Devnet wallets and accounts. Never submit a production secret or real funds.</li>
            <li>You are responsible for every score. Organizers may hold a result for private review, ask you to explain or reproduce it, and provide an appeal before payout.</li>
          </ul>
          <form className="rules-form" action="/api/rules/acknowledge" method="post">
            <label className="rules-check">
              <input type="checkbox" name="accepted" value="yes" required />
              <span>I have read and agree to rules version {RULES_VERSION}.</span>
            </label>
            <button className="button button-primary" type="submit">Enter challenge room</button>
          </form>
        </section>
      </main>
    );
  }

  const config = await resolveLeaderboardConfig({ store: leaderboardStore });
  const recordedSolves = await leaderboardStore.solves().catch(() => []);
  const storedCompletions = completedChallengeKeys({
    solves: recordedSolves,
    participantId: user.participant_id,
    eventGeneration: config.eventGeneration,
  });
  const recoveryCandidates = (await Promise.all(COMPLETION_READERS.map(async ([challenge, reader]) => {
    if (storedCompletions.has(challenge)) return null;
    try {
      const [launch, ready] = await Promise.all([
        leaderboardStore.challengeLaunch(challenge, user.participant_id),
        leaderboardStore.completionRecoveryReady(challenge, user.participant_id),
      ]);
      return launch && ready ? { challenge, reader } : null;
    } catch {
      return null;
    }
  }))).filter(Boolean);

  let admittedRecoveries = [];
  if (recoveryCandidates.length > 0) {
    try {
      await consumePortalRequestBudget("completionRecovery", {
        participantId: user.participant_id,
        cost: recoveryCandidates.length,
      });
      admittedRecoveries = recoveryCandidates;
    } catch {
      // Stored solve events remain authoritative when dependency recovery is busy.
    }
  }
  const recoveredPairs = await Promise.all(admittedRecoveries.map(async ({ challenge, reader }) => {
    try {
      const completion = await reader(user);
      if (completion) await leaderboardStore.clearCompletionRecoveryBackoff(challenge, user.participant_id).catch(() => null);
      else await leaderboardStore.deferCompletionRecovery(challenge, user.participant_id, 30).catch(() => null);
      return [challenge, completion];
    } catch {
      await leaderboardStore.deferCompletionRecovery(challenge, user.participant_id, 10).catch(() => null);
      return [challenge, null];
    }
  }));
  const completionByChallenge = new Map(recoveredPairs);
  const [signet, drift, lastStop, afterHours, playerTwo, broadcast, evidenceRoom, secondKey] = COMPLETION_READERS
    .map(([challenge]) => completionByChallenge.get(challenge) || null);
  await recoverLeaderboardCompletions(
    user,
    [signet, drift, lastStop, afterHours, playerTwo, broadcast, evidenceRoom, secondKey],
    leaderboardStore,
    { config },
  ).catch(() => []);
  const completedChallenges = completedChallengeKeys({
    completions: [signet, drift, lastStop, afterHours, playerTwo, broadcast, evidenceRoom, secondKey],
    solves: recordedSolves,
    participantId: user.participant_id,
    eventGeneration: config.eventGeneration,
  });

  return (
    <main className="shell board-shell">
      <nav className="topbar" aria-label="Event">
        <a className="wordmark" href="/" aria-label="CTF26 home">
          <span aria-hidden="true">[ st</span><strong>CTF</strong><span aria-hidden="true"> ]</span>
        </a>
      </nav>

      <header className="board-header">
        <div>
          <h1>Challenges</h1>
        </div>
        <p className="board-summary">
          Choose a challenge and start playing.
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
      </section>

      <section className="challenge-grid" aria-label="Challenges">
        {CHALLENGES.map((challenge) => {
          const completed = completedChallenges.has(challenge.key);
          return (
          <article className={`challenge challenge-${challenge.key}${completed ? " challenge-completed" : ""}`} key={challenge.key} id={`${challenge.key}-local-kit`}>
            <div className="challenge-visual" aria-hidden="true">
              <span className="challenge-visual-glyph" />
            </div>
            <div className="challenge-number" aria-hidden="true">
              {challenge.number}
            </div>
            <div className="challenge-content">
              <div>
                <div className="challenge-title-row">
                  <h2>{challenge.name}</h2>
                  {completed ? <span className="challenge-complete-status">Completed</span> : null}
                </div>
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
          );
        })}
      </section>

      <footer className="board-footer">
        <p>
          If a challenge does not open, refresh this page and try again.
        </p>
        <div className="board-footer-actions">
          <a className="plain" href="/leaderboard">Leaderboard</a>
          {isOrganizer(user) ? <a className="plain" href="/admin">Organizer console</a> : null}
        </div>
        <form action="/api/auth/logout" method="post">
          <button className="plain" type="submit">
            Sign out
          </button>
        </form>
      </footer>
    </main>
  );
}
