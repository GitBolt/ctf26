import { cookies } from "next/headers";

import {
  IMPRINT_SESSION_COOKIE,
  createChallengeSession,
  createDirectTestSession,
  verifyChallengeSession,
} from "@/lib/challenge-session.mjs";

export const runtime = "nodejs";

export async function POST(request) {
  try {
    const body = await request.json();
    const token = process.env.ALLOW_DIRECT_TEST_ACCESS === "true" && body?.directTest === true
      ? createDirectTestSession(body.teamId)
      : createChallengeSession(body.ticket);
    const jar = await cookies();
    jar.set(IMPRINT_SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: "strict",
      secure: process.env.NODE_ENV === "production",
      maxAge: 12 * 60 * 60,
      path: "/",
    });
    return Response.json({ ok: true, launchMode: process.env.ALLOW_DIRECT_TEST_ACCESS === "true" && body?.directTest === true ? "direct-test" : "portal" });
  } catch (error) {
    return new Response(error.message || "challenge access was denied", {
      status: 401,
    });
  }
}

export async function GET() {
  try {
    const jar = await cookies();
    verifyChallengeSession(jar.get(IMPRINT_SESSION_COOKIE)?.value);
    return Response.json({ ok: true });
  } catch {
    return new Response("challenge session is required", { status: 401 });
  }
}
