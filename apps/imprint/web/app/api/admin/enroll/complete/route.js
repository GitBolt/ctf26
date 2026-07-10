import { cookies } from "next/headers";
import { verifyRegistrationResponse } from "@simplewebauthn/server";

import { compressedP256FromCOSE } from "@/lib/credential-roster.mjs";
import { enforcePlatformEnrollment, requireEnrollmentOperator } from "@/lib/enrollment-policy.mjs";
import { expectedWebAuthnOrigin, expectedWebAuthnRpID } from "@/lib/webauthn-config.mjs";
import { ENROLLMENT_CHALLENGE_COOKIE, ENROLLMENT_TEAM_COOKIE } from "../options/route";

export const runtime = "nodejs";

export async function POST(request) {
  const jar = await cookies();
  try {
    requireEnrollmentOperator(request);
    const expectedChallenge = jar.get(ENROLLMENT_CHALLENGE_COOKIE)?.value;
    const teamId = jar.get(ENROLLMENT_TEAM_COOKIE)?.value;
    if (!expectedChallenge || !teamId) throw new Error("passkey enrollment challenge is missing or expired");
    const { response } = await request.json();
    const verification = await verifyRegistrationResponse({
      response,
      expectedChallenge,
      expectedOrigin: expectedWebAuthnOrigin(request),
      expectedRPID: expectedWebAuthnRpID(request),
      requireUserPresence: true,
      requireUserVerification: true,
      supportedAlgorithmIDs: [-7],
    });
    if (!verification.verified) throw new Error("platform passkey enrollment was not verified");
    enforcePlatformEnrollment(verification.registrationInfo);
    const publicKey = compressedP256FromCOSE(verification.registrationInfo.credential.publicKey);
    const rosterEntry = {
      teamId,
      credentialId: verification.registrationInfo.credential.id,
      credentialPublicKeyCoseBase64: Buffer.from(
        verification.registrationInfo.credential.publicKey,
      ).toString("base64url"),
      counter: verification.registrationInfo.credential.counter,
      transports: verification.registrationInfo.credential.transports,
      passkeyPubkeyHex: publicKey.toString("hex"),
    };
    jar.delete(ENROLLMENT_CHALLENGE_COOKIE);
    jar.delete(ENROLLMENT_TEAM_COOKIE);
    return Response.json(rosterEntry);
  } catch (error) {
    return new Response(error.message || "security-key enrollment was denied", { status: 403 });
  }
}
