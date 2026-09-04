import { notFound } from "next/navigation";

import CleanUrl from "./CleanUrl";
import CopyButton from "./CopyButton";

export const dynamic = "force-dynamic";

function lastStopLaunchUrl() {
  const configured = String(process.env.PUBLIC_NATIVE_RUNTIME_URL || "").trim();
  if (!configured) throw new Error("LAST STOP runtime is not configured");
  const url = new URL(configured);
  url.pathname = "/c/last-stop/launch";
  return url;
}

export default async function ChallengeDetails({ params }) {
  const { challenge } = await params;
  if (challenge !== "last-stop") notFound();

  let access = null;
  let unavailable = false;
  try {
    const response = await fetch(lastStopLaunchUrl(), {
      cache: "no-store",
      headers: { accept: "application/json" },
    });
    if (!response.ok) throw new Error("SSH access could not be created");
    access = await response.json();
  } catch (error) {
    console.error("LAST STOP access could not be created", error);
    unavailable = true;
  }

  return (
    <main className="shell detail-shell">
      <CleanUrl />
      <nav className="topbar" aria-label="Event">
        <a className="wordmark" href="/" aria-label="stCTF home">
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
            <div className="station-atmosphere" aria-hidden="true"><span /><span /></div>
            <div className="station-sign" aria-hidden="true"><span>LAST STOP</span><strong>RED LINE</strong></div>
            <p className="station-closure">Service suspended since 2000</p>
            <div className="route-map" aria-label="Red Line route">
              <span><i aria-hidden="true" />Grand Central</span>
              <span><i aria-hidden="true" />Red Line</span>
              <span><i aria-hidden="true" />Terminus</span>
            </div>
            <dl className="station-meta">
              <div><dt>Platform</dt><dd>26</dd></div>
              <div><dt>Access</dt><dd>SSH</dd></div>
              <div><dt>Status</dt><dd>Passage ready</dd></div>
            </dl>
          </aside>

          <div className="ssh-access">
            <header className="ssh-heading">
              <h1>Station access</h1>
              <p>Run the command, then enter the one-time password.</p>
            </header>

            {unavailable ? (
              <div className="connection-panel connection-error" role="alert">
                <h2>Connection details unavailable</h2>
                <p>Refresh this page to create a new SSH password.</p>
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
                <p className="connection-note">Expires in ten minutes and works once. Refresh for another password.</p>
              </div>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
