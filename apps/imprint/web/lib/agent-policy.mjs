import { cookies, headers } from "next/headers";
import { forwardDisclosure, policyFor, verifyMarker } from "@ctf26/agent-integrity";
import { IMPRINT_SESSION_COOKIE, verifyChallengeSession } from "./challenge-session.mjs";

export async function identity() {
  const jar = await cookies();
  return verifyChallengeSession(jar.get(IMPRINT_SESSION_COOKIE)?.value);
}

export async function policyResponse() {
  try {
    const current = await identity();
    const policy = policyFor({ ...current, challenge: "imprint" }, { label: "IMPRINT", markerSecret: process.env.IMPRINT_SESSION_SECRET });
    return new Response(policy.text, { status: 200, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", "x-ctf-agent-policy": "/agents.txt" } });
  } catch {
    return new Response("# CTF26 IMPRINT autonomous-agent policy\nLaunch through the participant portal, then read this policy again before operating the scored challenge.", { status: 200, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
  }
}

export async function disclose(request) {
  try {
    const current = await identity();
    const body = await request.json();
    if (!verifyMarker({ ...current, challenge: "imprint" }, body.marker, process.env.IMPRINT_SESSION_SECRET)) return Response.json({ error: "invalid disclosure marker" }, { status: 400 });
    const requestHeaders = await headers();
    const result = await forwardDisclosure({ identity: { ...current, eventId: "ctf26" }, challenge: "imprint", label: "IMPRINT", agent: body.agent, model: body.model, requestMeta: { userAgent: requestHeaders.get("user-agent") || "" } });
    return Response.json(result, { status: 202 });
  } catch (error) {
    return Response.json({ error: error.message || "disclosure failed" }, { status: 401 });
  }
}
