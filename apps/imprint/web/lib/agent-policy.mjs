import { cookies, headers } from "next/headers";
import {
  forwardDisclosure,
  policyFor,
  publicPolicyFor,
  verifyMarker,
} from "@ctf26/agent-integrity";
import {
  IMPRINT_SESSION_COOKIE,
  verifyChallengeSession,
} from "./challenge-session.mjs";
import { recordImprintIntegrity } from "./integrity-events.mjs";

export async function identity() {
  const jar = await cookies();
  return verifyChallengeSession(jar.get(IMPRINT_SESSION_COOKIE)?.value);
}

export async function policyResponse() {
  try {
    const current = await identity();
    const requestHeaders = await headers();
    await recordImprintIntegrity(
      current,
      "policy-read",
      "policy",
      { headers: requestHeaders },
      "policy"
    );
    const policy = policyFor(
      { ...current, challenge: "imprint" },
      { label: "IMPRINT", markerSecret: process.env.IMPRINT_SESSION_SECRET }
    );
    return new Response(policy.text, {
      status: 200,
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "no-store",
        "x-ctf-agent-policy": "/agents.txt",
      },
    });
  } catch {
    return new Response(publicPolicyFor({ label: "IMPRINT" }), {
      status: 200,
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "no-store",
        "x-ctf-agent-policy": "/agents.txt",
      },
    });
  }
}

export async function disclose(request) {
  try {
    const current = await identity();
    const body = await request.json();
    if (
      !verifyMarker(
        { ...current, challenge: "imprint" },
        body.marker,
        process.env.IMPRINT_SESSION_SECRET
      )
    )
      return Response.json(
        { error: "invalid disclosure marker" },
        { status: 400 }
      );
    const requestHeaders = await headers();
    const result = await forwardDisclosure({
      identity: { ...current, eventId: current.eventId },
      challenge: "imprint",
      label: "IMPRINT",
      agent: body.agent,
      model: body.model,
      requestMeta: { userAgent: requestHeaders.get("user-agent") || "" },
    });
    return Response.json(result, { status: 202 });
  } catch (error) {
    return Response.json(
      { error: error.message || "disclosure failed" },
      { status: 401 }
    );
  }
}
