"use client";

import { useState } from "react";
import { startRegistration } from "@simplewebauthn/browser";

export default function EnrollmentPage() {
  const [participantId, setParticipantId] = useState("");
  const [secret, setSecret] = useState("");
  const [output, setOutput] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function enroll() {
    setBusy(true);
    setError("");
    try {
      const headers = {
        "content-type": "application/json",
        "x-imprint-enrollment-secret": secret,
      };
      const optionsResponse = await fetch("/api/admin/enroll/options", {
        method: "POST",
        headers,
        body: JSON.stringify({ participantId }),
      });
      if (!optionsResponse.ok) throw new Error(await optionsResponse.text());
      const response = await startRegistration({ optionsJSON: await optionsResponse.json() });
      const completeResponse = await fetch("/api/admin/enroll/complete", {
        method: "POST",
        headers,
        body: JSON.stringify({ response }),
      });
      if (!completeResponse.ok) throw new Error(await completeResponse.text());
      setOutput(JSON.stringify(await completeResponse.json(), null, 2));
    } catch (nextError) {
      setError(nextError.message || String(nextError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main>
      <header>
        <div className="brand"><h1>imprint enrollment</h1></div>
      </header>
      <section className="access-panel">
        <p>Organizer-only enrollment. The participant must be present for the Touch ID, Face ID, or Windows Hello prompt.</p>
        <label>participant ID<input value={participantId} onChange={(event) => setParticipantId(event.target.value)} /></label>
        <label>enrollment secret<input type="password" value={secret} onChange={(event) => setSecret(event.target.value)} /></label>
        <div className="actions"><button type="button" disabled={busy || !participantId || !secret} onClick={enroll}>enroll platform passkey</button></div>
        {error ? <p className="error">{error}</p> : null}
        <pre>{output || "No roster entry generated."}</pre>
      </section>
    </main>
  );
}
