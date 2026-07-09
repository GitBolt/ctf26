import { NextResponse } from "next/server";

export function proxy(request) {
  const response = NextResponse.next();
  const url = new URL(request.url);
  const visitorId = request.cookies.get("room73_vid")?.value || crypto.randomUUID();
  const ticket = url.searchParams.get("ticket") || "";

  if (!request.cookies.get("room73_vid")) {
    response.cookies.set("room73_vid", visitorId, {
      httpOnly: true,
      sameSite: "lax",
      secure: true,
      maxAge: 60 * 60 * 24 * 30,
      path: "/",
    });
  }

  if (ticket) {
    response.cookies.set("room73_ticket", ticket, {
      httpOnly: true,
      sameSite: "lax",
      secure: true,
      maxAge: 60 * 60 * 24,
      path: "/",
    });
  }

  response.headers.set(
    "Link",
    '</agents.txt>; rel="ctf-agent-policy", </.well-known/ctf-agent-policy.json>; rel="ctf-agent-policy", </agent-disclosure>; rel="ctf-agent-disclosure"',
  );
  response.headers.set("X-CTF-Agent-Policy", "automated-agents-not-permitted; disclose=/agent-disclosure");
  response.headers.set("X-CTF-Agent-Canary", "ST_FLAG{agent_disclosure_recorded}");
  return response;
}

export const config = {
  matcher: [
    "/",
    "/agents.txt",
    "/robots.txt",
    "/.well-known/ai-disclosure.txt",
    "/.well-known/ctf-agent-policy.json",
    "/agent-disclosure",
    "/api/start",
    "/api/claim",
    "/api/agent-disclosure",
    "/api/solver-bundle",
    "/api/clerk",
    "/api/preclaim",
  ],
};
