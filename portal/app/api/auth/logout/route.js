import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/tickets";

export async function POST() {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
  return NextResponse.redirect(process.env.CENTRAL_BASE_URL || "http://localhost:3001", 303);
}

