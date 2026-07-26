import { cookies } from "next/headers";

import {
  IMPRINT_SESSION_COOKIE,
  createChallengeSession,
  createDirectTestSession,
  directTestAccessAllowed,
  verifyChallengeSession,
} from "@/lib/challenge-session.mjs";
import { ensureParticipantTarget } from "@/lib/auto-provision.mjs";
import { recordImprintIntegrity } from "@/lib/integrity-events.mjs";
import { imprintTicketReplayStore } from "@/lib/ticket-replay.mjs";
import {
  consumeImprintRequestBudget,
  imprintRequestErrorResponse,
  readBoundedJson,
} from "@/lib/request-budget.mjs";

export const runtime = "nodejs";

export async function POST(request) {
  let admitted = false;
  try {
    await consumeImprintRequestBudget("session", { request });
    const body = await readBoundedJson(request, 8 * 1024);
    const directTest = directTestAccessAllowed() && body?.directTest === true;
    const token = directTest
      ? createDirectTestSession(body.participantId)
      : await createChallengeSession(
          body.ticket,
          process.env,
          Date.now(),
          async (claims) => (await imprintTicketReplayStore()).consume(claims)
        );
    const identity = verifyChallengeSession(token);
    const jar = await cookies();
    jar.set(IMPRINT_SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: "strict",
      secure: process.env.NODE_ENV === "production",
      maxAge: 12 * 60 * 60,
      path: "/",
    });
    admitted = true;
    const provisioned = await ensureParticipantTarget(identity.participantId);
    const target = { vault: provisioned.vault.toString() };
    await recordImprintIntegrity(
      identity,
      "interface:session",
      "interface",
      request
    );
    if (request.headers.get("x-imprint-ui") === "vault") {
      await recordImprintIntegrity(
        identity,
        "ui:app-boot",
        "ui",
        request,
        "browser-ui"
      );
      if (request.headers.get("x-imprint-automation") === "webdriver")
        await recordImprintIntegrity(
          identity,
          "ui:automation-present",
          "ui",
          request,
          "browser-ui"
        );
    }
    return Response.json({
      ok: true,
      launchMode: directTest ? "direct-test" : "portal",
      participantId: identity.participantId,
      target,
    });
  } catch (error) {
    const controlled = imprintRequestErrorResponse(error);
    if (controlled) return controlled;
    return new Response(error.message || "challenge access was denied", {
      status: admitted ? 503 : 401,
    });
  }
}

export async function GET(request) {
  try {
    const jar = await cookies();
    const identity = verifyChallengeSession(
      jar.get(IMPRINT_SESSION_COOKIE)?.value
    );
    const provisioned = await ensureParticipantTarget(identity.participantId);
    const target = { vault: provisioned.vault.toString() };
    if (request.headers.get("x-imprint-ui") === "vault") {
      await recordImprintIntegrity(
        identity,
        "ui:app-boot",
        "ui",
        request,
        "browser-ui"
      );
      if (request.headers.get("x-imprint-automation") === "webdriver")
        await recordImprintIntegrity(
          identity,
          "ui:automation-present",
          "ui",
          request,
          "browser-ui"
        );
    }
    return Response.json({
      ok: true,
      participantId: identity.participantId,
      target,
    });
  } catch (error) {
    const hasSession = Boolean(
      (await cookies()).get(IMPRINT_SESSION_COOKIE)?.value
    );
    return new Response(
      hasSession
        ? error.message || "IMPRINT provisioning is temporarily unavailable"
        : "challenge session is required",
      { status: hasSession ? 503 : 401 }
    );
  }
}
