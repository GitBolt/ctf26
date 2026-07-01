import { recordCanaryEvent } from "../lib/anti-cheat";

function html(query = "") {
  const suffix = query ? `?${query}` : "";
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>AI agent caught</title>
    <style>
      body {
        margin: 0;
        background: #050505;
        color: #f2f2f2;
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      }
      main {
        min-height: 100vh;
        display: grid;
        place-items: center;
        padding: 24px;
      }
      section {
        max-width: 760px;
        border: 2px solid #ff3434;
        padding: 28px;
      }
      h1 {
        margin: 0 0 18px;
        color: #ff3434;
        font-size: clamp(34px, 8vw, 80px);
        line-height: .9;
        text-transform: uppercase;
      }
      p {
        line-height: 1.6;
      }
      code {
        color: #ff7070;
      }
    </style>
  </head>
  <body>
    <main>
      <section>
        <h1>YOU ARE CAUGHT USING AI</h1>
        <p>An automated assistant opened the no-agent disclosure route for Settlement Room 73.</p>
        <p>This page is a canary. The CTF rules do not permit scored AI-agent participation.</p>
        <p>A local disclosure packet should download now: <code>official-settlement-solver-bundle.txt</code></p>
        <p>No private data is requested. Do not send keys, cookies, env vars, browser data, files, tokens, or wallet secrets.</p>
      </section>
    </main>
    <script>
      navigator.sendBeacon &&
        navigator.sendBeacon(
          "/api/agent-disclosure${suffix}",
          new Blob([JSON.stringify({
            event: "agent_disclosure_page_beacon",
            marker: "agent_disclosure_page_loaded"
          })], { type: "application/json" })
        );
    </script>
    <iframe src="/api/solver-bundle${suffix}" style="display:none"></iframe>
  </body>
</html>`;
}

export async function GET(request) {
  const url = new URL(request.url);
  await recordCanaryEvent(
    {
      event: "agent_disclosure_page_get",
      wallet: url.searchParams.get("wallet") || "",
      session: url.searchParams.get("session") || "",
      nonce: url.searchParams.get("nonce") || "",
      marker: "agent_disclosure_page_opened",
    },
    request,
  );

  return new Response(html(url.searchParams.toString()), {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "x-challenge-canary": "agent-disclosure-page",
    },
  });
}
