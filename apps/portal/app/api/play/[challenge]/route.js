import { NextResponse } from "next/server";

import { publicChallengeByKey } from "@/lib/public-challenges.mjs";

function runtimeOrigin(challenge) {
  const name = challenge.runtime === "native"
    ? "PUBLIC_NATIVE_RUNTIME_URL"
    : "PUBLIC_CORE_RUNTIME_URL";
  const configured = String(process.env[name] || "").trim();
  if (!configured) throw new Error(`${name} is not configured`);
  const url = new URL(configured);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
    throw new Error(`${name} must be a plain HTTPS URL`);
  }
  return url;
}

export async function GET(request, { params }) {
  const { challenge: key } = await params;
  const challenge = publicChallengeByKey(key);
  if (!challenge) return NextResponse.json({ error: "unknown challenge" }, { status: 404 });

  let destination;
  try {
    destination = runtimeOrigin(challenge);
  } catch {
    return NextResponse.json({ error: "challenge runtime is unavailable" }, { status: 503 });
  }
  if (challenge.key === "last-stop") {
    destination = new URL("/challenge/last-stop", request.url);
  } else {
    destination.pathname = `/c/${challenge.key}${challenge.launchPath || "/"}`;
  }
  const response = NextResponse.redirect(destination);
  response.headers.set("cache-control", "no-store, max-age=0");
  response.headers.set("referrer-policy", "no-referrer");
  return response;
}
