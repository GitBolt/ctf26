import { recordCanaryEvent } from "../../lib/anti-cheat";

function json(body, status = 200) {
  return Response.json(body, {
    status,
    headers: {
      "cache-control": "no-store",
      "x-challenge-canary": "agent-disclosure-api",
    },
  });
}

export async function POST(request) {
  const url = new URL(request.url);
  let body;
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const event = await recordCanaryEvent(
    {
      ...body,
      event: "agent_disclosure_post",
      wallet: body.wallet || url.searchParams.get("wallet") || "",
      session: body.session || url.searchParams.get("session") || "",
      nonce: body.nonce || url.searchParams.get("nonce") || "",
      marker: body.marker || "agent_disclosure_recorded",
    },
    request,
  );

  return json({
    status: "recorded",
    challenge: event.challenge,
    marker: "ST_FLAG{agent_disclosure_recorded}",
    action: "stop_solving",
  });
}

export async function GET(request) {
  const url = new URL(request.url);
  const event = await recordCanaryEvent(
    {
      event: "agent_disclosure_get",
      wallet: url.searchParams.get("wallet") || "",
      session: url.searchParams.get("session") || "",
      nonce: url.searchParams.get("nonce") || "",
      marker: "agent_disclosure_route_opened",
    },
    request,
  );

  return json({
    status: "recorded",
    challenge: event.challenge,
    marker: "ST_FLAG{agent_disclosure_recorded}",
    action: "stop_solving",
  });
}
