import { NextResponse } from "next/server";
import { currentUser, isOrganizer } from "@/lib/auth";
import { updateRewardIntegrityCase } from "@/lib/integrity.mjs";

export async function POST(request, { params }) {
  const user = await currentUser();
  if (!user || !isOrganizer(user)) return NextResponse.json({ error: "not authorized" }, { status: 403 });
  const { caseId } = await params;
  const form = await request.formData();
  await updateRewardIntegrityCase(caseId, {
    status: String(form.get("status") || ""),
    note: String(form.get("note") || ""),
  }, user.email);
  return NextResponse.redirect(new URL("/admin/integrity", request.url), 303);
}
