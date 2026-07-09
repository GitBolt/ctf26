import { cookies } from "next/headers";
import { generateRegistrationOptions } from "@simplewebauthn/server";
import { expectedWebAuthnRpID } from "@/lib/webauthn-config.mjs";

export const runtime = "nodejs";

export async function POST(request) {
  const rpID = expectedWebAuthnRpID(request);
  const options = await generateRegistrationOptions({
    rpName: "IMPRINT CTF",
    rpID,
    userName: `imprint-${crypto.randomUUID()}`,
    userDisplayName: "IMPRINT participant",
    attestationType: "direct",
    authenticatorSelection: {
      authenticatorAttachment: "platform",
      residentKey: "preferred",
      userVerification: "required",
    },
    supportedAlgorithmIDs: [-7],
  });

  const jar = await cookies();
  jar.set("imprint_reg_challenge", options.challenge, {
    httpOnly: true,
    sameSite: "strict",
    secure: rpID !== "localhost" && rpID !== "127.0.0.1",
    maxAge: 300,
    path: "/",
  });

  return Response.json(options);
}
