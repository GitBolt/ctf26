import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";

import { currentUser } from "@/lib/auth";
import { challengeByKey, challengeDestination } from "@/lib/challenges.mjs";
import { completionMatchesEvent, lastStopCompletion } from "@/lib/completions.mjs";
import { assertChallengeLaunchAllowed, ChallengeLaunchError } from "@/lib/leaderboard-config.mjs";
import { resolveLeaderboardConfig } from "@/lib/leaderboard-lifecycle.mjs";
import { createLeaderboardStore } from "@/lib/leaderboard-store.mjs";
import { createChallengeTicket, RULES_COOKIE, verifyRulesAcknowledgment } from "@/lib/tickets";

import CopyButton from "./CopyButton";

export const dynamic = "force-dynamic";

async function sshAccess(challenge, user, config) {
  const destination = challengeDestination(challenge);
  if (!destination.ticketed) return null;

  const ticket = createChallengeTicket(user, challenge.audience, {
    config,
    challengeKey: challenge.key,
  });
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
  const jar = await cookies();
  if (!verifyRulesAcknowledgment(jar.get(RULES_COOKIE)?.value || "", user)) {
    redirect("/?error=rules_required");
  }

  const { challenge: challengeKey } = await params;
  const challenge = challengeByKey(challengeKey);
  if (!challenge || challenge.key !== "last-stop") notFound();

  let access = null;
  let unavailable = false;
  let unavailableMessage = "Refresh this page to create a new SSH password. If it still fails, ask an organizer for help.";
  const store = createLeaderboardStore();
  let activeConfig;
  try {
    activeConfig = await resolveLeaderboardConfig({ store });
  } catch (error) {
    console.error("LAST STOP event lifecycle is unavailable", error);
    activeConfig = null;
  }
  const observedCompletion = await lastStopCompletion(user).catch(() => null);
  const completion = activeConfig && completionMatchesEvent(observedCompletion, activeConfig.eventGeneration)
    ? observedCompletion
    : null;
  if (!completion) {
    try {
      if (!activeConfig) throw new Error("event lifecycle unavailable");
      assertChallengeLaunchAllowed(
        user.participant_id || user.participantId,
        process.env,
        new Date(),
        activeConfig,
        challenge.key,
      );
      await store.recordChallengeLaunch({
        participantId: user.participant_id || user.participantId,
        challenge: challenge.key,
        email: user.email,
      });
      access = await sshAccess(challenge, user, activeConfig);
      unavailable = !access;
    } catch (error) {
      console.error("LAST STOP access could not be created", error);
      unavailable = true;
      if (error instanceof ChallengeLaunchError) unavailableMessage = error.message;
    }
  }

  return (
    <main className="shell detail-shell">
      <nav className="topbar" aria-label="Event">
        <a className="wordmark" href="/" aria-label="CTF26 home">
          <span aria-hidden="true">[ st</span><strong>CTF</strong><span aria-hidden="true"> ]</span>
        </a>
        <a className="detail-back" href="/">Back to challenges</a>
      </nav>

      <div className="station-frame">
        <section className="ssh-detail">
          <svg className="station-lamp" viewBox="0 0 720 640" preserveAspectRatio="none" aria-hidden="true">
            <defs>
              <radialGradient id="station-light" cx="50%" cy="0%" r="82%">
                <stop offset="0%" stopColor="#fffaff" stopOpacity=".42">
                  <animate attributeName="stop-opacity" values=".42;.08;.72;.42;.1;.68;.42;.07;.74;.42;.09;.7;.42;.1;.76;.42" keyTimes="0;.08;.09;.18;.19;.32;.33;.46;.47;.63;.64;.77;.78;.9;.91;1" dur="4.2s" repeatCount="indefinite" calcMode="discrete" />
                </stop>
                <stop offset="36%" stopColor="#ddccea" stopOpacity=".16">
                  <animate attributeName="stop-opacity" values=".16;.02;.34;.16;.03;.3;.16;.02;.36;.16;.03;.32;.16;.03;.38;.16" keyTimes="0;.08;.09;.18;.19;.32;.33;.46;.47;.63;.64;.77;.78;.9;.91;1" dur="4.2s" repeatCount="indefinite" calcMode="discrete" />
                </stop>
                <stop offset="78%" stopColor="#9277ae" stopOpacity="0" />
              </radialGradient>
            </defs>
            <rect width="720" height="640" fill="url(#station-light)" />
          </svg>
          <aside className="station-overview">
            <div className="station-atmosphere" aria-hidden="true">
              <span />
              <span />
            </div>
            <div className="station-sign" aria-hidden="true">
              <span>LAST STOP</span>
              <strong>RED LINE</strong>
            </div>
            <p className="station-closure">Service suspended since 2000</p>
            <div className="route-map" aria-label="Red Line route">
              <span><i aria-hidden="true" />Grand Central</span>
              <span><i aria-hidden="true" />Red Line</span>
              <span><i aria-hidden="true" />Terminus</span>
            </div>
            <dl className="station-meta">
              <div><dt>Platform</dt><dd>26</dd></div>
              <div><dt>Access</dt><dd>SSH</dd></div>
              <div><dt>Status</dt><dd>{completion ? "Completed" : "Passage ready"}</dd></div>
            </dl>
          </aside>

          <div className="ssh-access">
            {completion ? (
              <div className="journey-complete" role="status">
                <span aria-hidden="true">✓</span>
                <div>
                  <strong>Journey completed</strong>
                  <p>Your arrival has been recorded.</p>
                </div>
              </div>
            ) : null}
            <header className="ssh-heading">
              <h1>Station access</h1>
              <p>Run the command, then enter the one-time password.</p>
            </header>

            {unavailable ? (
              <div className="connection-panel connection-error" role="alert">
                <h2>Connection details unavailable</h2>
                <p>{unavailableMessage}</p>
              </div>
            ) : (
              <div className="connection-panel">
                <div className="connection-field">
                  <div className="connection-value">
                    <span className="connection-label">Command</span>
                    <code>{access.command}</code>
                  </div>
                  <CopyButton value={access.command} />
                </div>
                <div className="connection-field">
                  <div className="connection-value">
                    <span className="connection-label">One-time password</span>
                    <code>{access.password}</code>
                  </div>
                  <CopyButton value={access.password} />
                </div>
                <p className="connection-note">
                  Expires in ten minutes and works once. Refresh for another password.
                </p>
              </div>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
