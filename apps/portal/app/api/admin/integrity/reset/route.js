import { NextResponse } from "next/server";
import { currentUser, isOrganizer } from "@/lib/auth";
import { resetRewardSniperEvent } from "@/lib/integrity.mjs";

export async function POST(request) {
  const user = await currentUser();
  if (!user || !isOrganizer(user)) return NextResponse.json({ error: "not authorized" }, { status: 403 });
  const form = await request.formData();
  await resetRewardSniperEvent(String(form.get("eventId") || ""), user.email);
  return NextResponse.redirect(new URL("/admin/integrity?event=reset", request.url), 303);
}
