import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import {
  challengeByKey,
  challengeDestination,
} from "@/lib/challenges.mjs";
import { centralBaseUrl } from "@/lib/config.mjs";
import {
  SESSION_COOKIE,
  createChallengeTicket,
  verifyUserSession,
} from "@/lib/tickets";

function noStore(response) {
  response.headers.set("cache-control", "no-store, max-age=0");
  response.headers.set("referrer-policy", "no-referrer");
  return response;
}

export async function GET(request, { params }) {
  const { challenge: challengeKey } = await params;
  const challenge = challengeByKey(challengeKey);
  if (!challenge) {
    return noStore(NextResponse.json({ error: "unknown challenge" }, { status: 404 }));
  }

  const jar = await cookies();
  let user = null;
  try {
    user = verifyUserSession(jar.get(SESSION_COOKIE)?.value || "");
  } catch {
    user = null;
  }
  if (!user) {
    const loginUrl = new URL("/", centralBaseUrl());
    loginUrl.searchParams.set("error", "session_required");
    return noStore(NextResponse.redirect(loginUrl));
  }

  let destination;
  try {
    destination = challengeDestination(challenge);
  } catch {
    return noStore(
      NextResponse.json(
        { error: `${challenge.urlEnv} is invalid` },
        { status: 503 },
      ),
    );
  }

  if (!destination.ticketed) {
    const localKit = new URL("/", centralBaseUrl());
    localKit.hash = challenge.localAnchor;
    return noStore(NextResponse.redirect(localKit));
  }

  let ticket;
  try {
    ticket = createChallengeTicket(user, challenge.audience);
  } catch {
    return noStore(
      NextResponse.json(
        { error: "challenge launch is not configured" },
        { status: 503 },
      ),
    );
  }
  destination.url.searchParams.set("ticket", ticket);
  return noStore(NextResponse.redirect(destination.url));
}
