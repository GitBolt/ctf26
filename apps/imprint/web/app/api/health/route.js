import { imprintHealth } from "@/lib/health.mjs";
import { imprintProvisioningHealth } from "@/lib/auto-provision.mjs";
import { imprintStateStore } from "@/lib/state-store.mjs";
import { imprintTicketReplayStore } from "@/lib/ticket-replay.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const store = await imprintTicketReplayStore();
    if (!(await store.health()))
      throw new Error("ticket replay storage is unavailable");
    const state = await imprintStateStore();
    if (!(await state.health()))
      throw new Error("IMPRINT state storage is unavailable");
    const funding = await imprintProvisioningHealth();
    if (!funding.ready)
      throw new Error("IMPRINT operator funding is below reserve");
    return Response.json({ ...imprintHealth(), funding });
  } catch (error) {
    console.error("IMPRINT health check failed", error);
    return Response.json({ ok: false }, { status: 503 });
  }
}
