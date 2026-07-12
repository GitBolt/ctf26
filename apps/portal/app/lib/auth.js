import { cookies } from "next/headers";
import { SESSION_COOKIE, verifyUserSession } from "@/lib/tickets";
export { isOrganizer } from "@/lib/organizers.mjs";

export async function currentUser() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value || "";
  if (!token) return null;
  try {
    return verifyUserSession(token);
  } catch {
    return null;
  }
}
