import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { currentUser } from "@/lib/auth";
import { centralBaseUrl } from "@/lib/config.mjs";
import { createLeaderboardStore } from "@/lib/leaderboard-store.mjs";
import { createRulesAcknowledgment, RULES_COOKIE, RULES_VERSION } from "@/lib/tickets";

export async function POST(request) {
  const user = await currentUser();
  if (!user) return NextResponse.redirect(new URL("/?error=session_required", centralBaseUrl()), 303);
  const form = await request.formData();
  if (form.get("accepted") !== "yes") return NextResponse.redirect(new URL("/?error=rules_required", centralBaseUrl()), 303);

  try {
    await createLeaderboardStore().recordRulesAcknowledgment(user, RULES_VERSION);
  } catch (error) {
    console.error("rules acknowledgment could not be stored", error);
    return NextResponse.redirect(new URL("/?error=rules_save_failed", centralBaseUrl()), 303);
  }

  const jar = await cookies();
  jar.set(RULES_COOKIE, createRulesAcknowledgment(user), {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    maxAge: 12 * 60 * 60,
    path: "/",
  });
  return NextResponse.redirect(centralBaseUrl(), 303);
}
