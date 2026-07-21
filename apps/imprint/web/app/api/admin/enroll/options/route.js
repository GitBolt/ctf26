import { cookies } from "next/headers";
import { generateRegistrationOptions } from "@simplewebauthn/server";

import { requireEnrollmentOperator } from "@/lib/enrollment-policy.mjs";
import { expectedWebAuthnRpID } from "@/lib/webauthn-config.mjs";

export const runtime = "nodejs";
const ENROLLMENT_CHALLENGE_COOKIE = "imprint_enrollment_challenge";
const ENROLLMENT_PARTICIPANT_COOKIE = "imprint_enrollment_participant";
const PARTICIPANT_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/;

export async function POST(request) {
  try {
    requireEnrollmentOperator(request);
    const { participantId } = await request.json();
    if (typeof participantId !== "string" || !PARTICIPANT_ID_PATTERN.test(participantId)) {
      throw new Error("participant ID is invalid");
    }
    const options = await generateRegistrationOptions({
      rpName: "IMPRINT CTF",
      rpID: expectedWebAuthnRpID(request),
      userName: `imprint-${participantId}`,
      userDisplayName: `IMPRINT ${participantId}`,
      attestationType: "direct",
      authenticatorSelection: {
        authenticatorAttachment: "platform",
        residentKey: "discouraged",
        userVerification: "required",
      },
      supportedAlgorithmIDs: [-7],
    });
    const jar = await cookies();
    const cookieOptions = {
      httpOnly: true,
      sameSite: "strict",
      secure: process.env.NODE_ENV === "production",
      maxAge: 300,
      path: "/",
    };
    jar.set(ENROLLMENT_CHALLENGE_COOKIE, options.challenge, cookieOptions);
    jar.set(ENROLLMENT_PARTICIPANT_COOKIE, participantId, cookieOptions);
    return Response.json(options);
  } catch (error) {
    return new Response(error.message || "security-key enrollment was denied", {
      status: 403,
    });
  }
}

export { ENROLLMENT_CHALLENGE_COOKIE, ENROLLMENT_PARTICIPANT_COOKIE };
