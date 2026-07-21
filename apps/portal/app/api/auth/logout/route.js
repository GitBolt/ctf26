import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { centralBaseUrl } from "@/lib/config.mjs";
import { RULES_COOKIE, SESSION_COOKIE } from "@/lib/tickets";

export async function POST() {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
  jar.delete(RULES_COOKIE);
  return NextResponse.redirect(centralBaseUrl(), 303);
}
