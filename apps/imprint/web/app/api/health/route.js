import { imprintHealth } from "@/lib/health.mjs";
import { imprintTicketReplayStore } from "@/lib/ticket-replay.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const store = await imprintTicketReplayStore();
    if (!await store.health()) throw new Error("ticket replay storage is unavailable");
    return Response.json(imprintHealth());
  } catch (error) {
    console.error("IMPRINT health check failed", error);
    return Response.json({ ok: false }, { status: 503 });
  }
}
