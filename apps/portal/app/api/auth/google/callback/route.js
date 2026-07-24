import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { centralBaseUrl } from "@/lib/config.mjs";
import { organizerEmails } from "@/lib/organizers.mjs";
import { registrationForEmail } from "@/lib/registration.mjs";
import {
  SESSION_COOKIE,
  STATE_COOKIE,
  createUserSession,
  participantIdForEmail,
} from "@/lib/tickets";

async function exchangeCode(code, baseUrl) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID || "",
      client_secret: process.env.GOOGLE_CLIENT_SECRET || "",
      redirect_uri: `${baseUrl}/api/auth/google/callback`,
      grant_type: "authorization_code",
    }),
  });

  if (!res.ok) {
    throw new Error("google token exchange failed");
  }
  return res.json();
}

async function fetchGoogleUser(accessToken) {
  const res = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    throw new Error("google userinfo failed");
  }
  return res.json();
}

async function provisionSignet(participantId) {
  const origin = String(process.env.SIGNET_URL || "").replace(/\/$/, "");
  const secret = String(process.env.CHALLENGE_TICKET_SECRET_SIGNET || "");
  if (!origin || Buffer.byteLength(secret) < 32) throw new Error("signet provisioning is not configured");
  const response = await fetch(`${origin}/api/internal/provision`, {
    method: "POST",
    cache: "no-store",
    headers: {
      authorization: `Bearer ${secret}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ participantId }),
    signal: AbortSignal.timeout(45_000),
  });
  if (!response.ok) throw new Error("signet provisioning failed");
}

export async function GET(request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code") || "";
  const state = url.searchParams.get("state") || "";
  const baseUrl = centralBaseUrl();
  const jar = await cookies();

  if (!code || !state || jar.get(STATE_COOKIE)?.value !== state) {
    return NextResponse.redirect(`${baseUrl}/?error=oauth_state`);
  }
  jar.delete(STATE_COOKIE);

  try {
    const token = await exchangeCode(code, baseUrl);
    const googleUser = await fetchGoogleUser(token.access_token);
    const email = String(googleUser.email || "").toLowerCase();

    if (!email || googleUser.email_verified !== true) {
      return NextResponse.redirect(`${baseUrl}/?error=no_email`);
    }

    const participantId = participantIdForEmail(email);
    const registration = registrationForEmail(email, participantId);
    const organizer = organizerEmails().has(email);
    if (!registration && !organizer) {
      return NextResponse.redirect(`${baseUrl}/?error=not_registered`);
    }
    const identity = registration || {
      participantId,
      displayName: String(googleUser.name || email).slice(0, 80),
    };
    if (registration) {
      await provisionSignet(identity.participantId).catch((error) => {
        console.error("signet pre-provisioning failed", {
          participantId: identity.participantId,
          error: error?.message || String(error),
        });
      });
    }
    const session = createUserSession({
      participant_id: identity.participantId,
      email,
      name: googleUser.name || email,
      leaderboard_name: identity.displayName,
      picture: googleUser.picture || "",
    });

    jar.set(SESSION_COOKIE, session, {
      httpOnly: true,
      sameSite: "lax",
      secure: new URL(baseUrl).protocol === "https:",
      maxAge: 12 * 60 * 60,
      path: "/",
    });
    return NextResponse.redirect(`${baseUrl}${organizer ? "/admin" : "/"}`);
  } catch {
    return NextResponse.redirect(`${baseUrl}/?error=google_auth`);
  }
}
