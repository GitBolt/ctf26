import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { SESSION_COOKIE, createUserSession, participantIdForEmail } from "@/lib/tickets";

export async function GET(request) {
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_DEV_LOGIN !== "true") {
    return NextResponse.json({ error: "disabled" }, { status: 404 });
  }

  const url = new URL(request.url);
  const email = String(url.searchParams.get("email") || "demo@ctf26.test").toLowerCase();
  const baseUrl = process.env.CENTRAL_BASE_URL || "http://localhost:3001";
  const participantId = participantIdForEmail(email);
  const session = createUserSession({
    participant_id: participantId,
    team_id: participantId,
    email,
    name: email.split("@")[0],
  });

  const jar = await cookies();
  jar.set(SESSION_COOKIE, session, {
    httpOnly: true,
    sameSite: "lax",
    secure: baseUrl.startsWith("https://"),
    maxAge: 12 * 60 * 60,
    path: "/",
  });

  return NextResponse.redirect(`${baseUrl}/`);
}

