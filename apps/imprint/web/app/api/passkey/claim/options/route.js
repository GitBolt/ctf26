import { cookies } from "next/headers";
import { generateAuthenticationOptions } from "@simplewebauthn/server";

import {
  IMPRINT_SESSION_COOKIE,
  verifyChallengeSession,
} from "@/lib/challenge-session.mjs";
import { credentialForTeam } from "@/lib/credential-roster.mjs";
import { expectedWebAuthnRpID } from "@/lib/webauthn-config.mjs";

export const runtime = "nodejs";
const CLAIM_CHALLENGE_COOKIE = "imprint_claim_challenge";

export async function POST(request) {
  try {
    const jar = await cookies();
    const session = verifyChallengeSession(
      jar.get(IMPRINT_SESSION_COOKIE)?.value
    );
    const credential = credentialForTeam(session.teamId);
    const options = await generateAuthenticationOptions({
      rpID: expectedWebAuthnRpID(request),
      allowCredentials: [
        {
          id: credential.credentialId,
          transports: credential.transports,
        },
      ],
      userVerification: "required",
      timeout: 60_000,
    });
    jar.set(CLAIM_CHALLENGE_COOKIE, options.challenge, {
      httpOnly: true,
      sameSite: "strict",
      secure: process.env.NODE_ENV === "production",
      maxAge: 120,
      path: "/",
    });
    return Response.json(options);
  } catch (error) {
    return new Response(error.message || "security-key claim was denied", {
      status: 403,
    });
  }
}

export { CLAIM_CHALLENGE_COOKIE };
