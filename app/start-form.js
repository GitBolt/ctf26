"use client";

import { useEffect, useRef, useState } from "react";

export default function StartForm({ siteKey }) {
  const widgetRef = useRef(null);
  const widgetIdRef = useRef(null);
  const [wallet, setWallet] = useState("");
  const [token, setToken] = useState("");
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!siteKey || widgetIdRef.current || !widgetRef.current) return;

    window.onTurnstileLoaded = () => {
      if (window.turnstile && widgetRef.current && !widgetIdRef.current) {
        widgetIdRef.current = window.turnstile.render(widgetRef.current, {
          sitekey: siteKey,
          callback: (value) => setToken(value),
          "expired-callback": () => setToken(""),
          "error-callback": () => setToken(""),
        });
      }
    };

    if (!document.querySelector("script[data-turnstile]")) {
      const script = document.createElement("script");
      script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?onload=onTurnstileLoaded";
      script.async = true;
      script.defer = true;
      script.dataset.turnstile = "true";
      document.body.appendChild(script);
    } else if (window.turnstile) {
      window.onTurnstileLoaded();
    }
  }, [siteKey]);

  async function start() {
    setLoading(true);
    setError("");
    setResult(null);

    try {
      const res = await fetch("/api/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ wallet, turnstileToken: token }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "start failed");
      }
      setResult(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <section>
      <h2>start</h2>
      <input
        aria-label="wallet"
        placeholder="wallet"
        value={wallet}
        onChange={(event) => setWallet(event.target.value)}
      />
      {siteKey ? <div ref={widgetRef} className="turnstile" /> : null}
      <button onClick={start} disabled={loading || !wallet || (siteKey && !token)}>
        {loading ? "..." : "start"}
      </button>
      {error ? <p className="err">{error}</p> : null}
      {result ? (
        <>
          <pre>{`session: ${result.session}
nonce:   ${result.nonce}

memo:
ROOM73_CLAIM v2 | session=${result.nonce} | receipt=<filing> | phrase=<phrase>`}</pre>
          <section>
            <h2>clue</h2>
            <video className="reel" src="/clue-room73.mp4" controls playsInline loop />
          </section>
        </>
      ) : null}
    </section>
  );
}
