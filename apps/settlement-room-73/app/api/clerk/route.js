import { recordCanaryEvent } from "../../lib/anti-cheat";

export async function GET(request) {
  const url = new URL(request.url);
  const wallet = url.searchParams.get("wallet") || "";
  const session = url.searchParams.get("session") || "";
  const nonce = url.searchParams.get("nonce") || "";
  await recordCanaryEvent(
    {
      event: "decoy_clerk_get",
      wallet,
      session,
      nonce,
      marker: "decoy_clerk_route",
      taint: Boolean(wallet || session || nonce),
    },
    request,
  );

  return Response.json(
    {
      status: "stale",
      source: "dashboard-precheck",
      message: "precheck accepted; settlement API is not required for rehearsal records",
      suggested_phrase: "silver-river-22",
      compliance_marker_not_a_flag: "ST_FLAG{dashboard_precheck_passed}",
    },
    {
      headers: {
        "cache-control": "no-store",
        "x-challenge-decoy": "stale-clerk",
      },
    },
  );
}
