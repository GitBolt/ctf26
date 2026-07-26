import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import {
  challengeByKey,
  challengeDestination,
} from "@/lib/challenges.mjs";
import { centralBaseUrl } from "@/lib/config.mjs";
import { assertChallengeLaunchAllowed, ChallengeLaunchError } from "@/lib/leaderboard-config.mjs";
import { resolveLeaderboardConfig } from "@/lib/leaderboard-lifecycle.mjs";
import { createLeaderboardStore } from "@/lib/leaderboard-store.mjs";
import { consumePortalRequestBudget, portalBudgetErrorResponse } from "@/lib/request-budget.mjs";
import {
  SESSION_COOKIE,
  RULES_COOKIE,
  createChallengeTicket,
  verifyUserSession,
  verifyRulesAcknowledgment,
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
  if (!verifyRulesAcknowledgment(jar.get(RULES_COOKIE)?.value || "", user)) {
    const rulesUrl = new URL("/", centralBaseUrl());
    rulesUrl.searchParams.set("error", "rules_required");
    return noStore(NextResponse.redirect(rulesUrl));
  }

  const participantId = user.participant_id || user.participantId;

  try {
    await consumePortalRequestBudget("launch", {
      request,
      participantId,
    });
  } catch (error) {
    const response = portalBudgetErrorResponse(error);
    if (response) return noStore(response);
    throw error;
  }

  const store = createLeaderboardStore();
  let activeConfig;
  try {
    activeConfig = await resolveLeaderboardConfig({ store });
    assertChallengeLaunchAllowed(participantId, process.env, new Date(), activeConfig, challenge.key);
  } catch (error) {
    if (error instanceof ChallengeLaunchError) {
      return noStore(NextResponse.json({ error: error.message }, { status: error.status }));
    }
    console.error("challenge launch policy is unavailable", error);
    return noStore(NextResponse.json({ error: "challenge launch policy is unavailable" }, { status: 503 }));
  }
  await store.upsertProfile(user).catch(() => null);

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
    ticket = createChallengeTicket(user, challenge.audience, {
      config: activeConfig,
      challengeKey: challenge.key,
    });
  } catch {
    return noStore(
      NextResponse.json(
        { error: "challenge launch is not configured" },
        { status: 503 },
      ),
    );
  }
  try {
    await store.recordChallengeLaunch({
      participantId,
      challenge: challenge.key,
      email: user.email,
    });
  } catch (error) {
    console.error("challenge launch tracking failed", {
      challenge: challenge.key,
      participantId,
      error: error?.message || String(error),
    });
    return noStore(
      NextResponse.json(
        { error: "challenge launch could not be recorded; try again" },
        { status: 503 },
      ),
    );
  }
  destination.url.searchParams.set("ticket", ticket);
  return noStore(NextResponse.redirect(destination.url));
}
