import { cookies } from "next/headers";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
} from "@simplewebauthn/server";

import {
  IMPRINT_SESSION_COOKIE,
  verifyChallengeSession,
} from "@/lib/challenge-session.mjs";
import { imprintStateStore } from "@/lib/state-store.mjs";
import { expectedWebAuthnRpID } from "@/lib/webauthn-config.mjs";
import {
  consumeImprintRequestBudget,
  imprintRequestErrorResponse,
} from "@/lib/request-budget.mjs";

export const runtime = "nodejs";
const CLAIM_CHALLENGE_COOKIE = "imprint_claim_challenge";
const CLAIM_MODE_COOKIE = "imprint_claim_mode";

export async function POST(request) {
  try {
    const jar = await cookies();
    const session = verifyChallengeSession(
      jar.get(IMPRINT_SESSION_COOKIE)?.value
    );
    await consumeImprintRequestBudget("passkeyOptions", {
      request,
      participantId: session.participantId,
    });
    const store = await imprintStateStore();
    const credential = await store.credentialForParticipant(
      session.participantId
    );
    const mode = credential ? "authenticate" : "register";
    const options = credential
      ? await generateAuthenticationOptions({
          rpID: expectedWebAuthnRpID(request),
          allowCredentials: [
            {
              id: credential.credentialId,
              transports: credential.transports,
            },
          ],
          userVerification: "required",
          timeout: 60_000,
        })
      : await generateRegistrationOptions({
          rpName: "IMPRINT CTF",
          rpID: expectedWebAuthnRpID(request),
          userID: Buffer.from(session.participantId, "utf8"),
          userName: `imprint-${session.participantId}`,
          userDisplayName: `IMPRINT ${session.participantId}`,
          attestationType: "direct",
          authenticatorSelection: {
            authenticatorAttachment: "platform",
            residentKey: "discouraged",
            userVerification: "required",
          },
          supportedAlgorithmIDs: [-7],
          timeout: 60_000,
        });
    const cookieOptions = {
      httpOnly: true,
      sameSite: "strict",
      secure: process.env.NODE_ENV === "production",
      maxAge: 120,
      path: "/",
    };
    jar.set(CLAIM_CHALLENGE_COOKIE, options.challenge, cookieOptions);
    jar.set(CLAIM_MODE_COOKIE, mode, cookieOptions);
    return Response.json({ mode, options });
  } catch (error) {
    const controlled = imprintRequestErrorResponse(error);
    if (controlled) return controlled;
    return new Response(error.message || "security-key claim was denied", {
      status: 403,
    });
  }
}

export { CLAIM_CHALLENGE_COOKIE, CLAIM_MODE_COOKIE };
