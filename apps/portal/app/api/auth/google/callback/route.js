import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { centralBaseUrl } from "@/lib/config.mjs";
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
    if (!registration) {
      return NextResponse.redirect(`${baseUrl}/?error=not_registered`);
    }
    const session = createUserSession({
      participant_id: participantId,
      team_id: registration.teamId,
      email,
      name: googleUser.name || email,
      picture: googleUser.picture || "",
    });

    jar.set(SESSION_COOKIE, session, {
      httpOnly: true,
      sameSite: "lax",
      secure: new URL(baseUrl).protocol === "https:",
      maxAge: 12 * 60 * 60,
      path: "/",
    });
    return NextResponse.redirect(`${baseUrl}/`);
  } catch {
    return NextResponse.redirect(`${baseUrl}/?error=google_auth`);
  }
}
