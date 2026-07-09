export function expectedWebAuthnOrigin(request, env = process.env) {
  const configured = String(env.IMPRINT_EXPECTED_ORIGIN || "").trim();
  if (configured) {
    const origin = new URL(configured).origin;
    if (origin !== configured.replace(/\/$/, "")) {
      throw new Error("IMPRINT_EXPECTED_ORIGIN must contain only an origin");
    }
    return origin;
  }

  requireExplicitProductionConfig(env, "IMPRINT_EXPECTED_ORIGIN");
  return new URL(request.url).origin;
}

export function expectedWebAuthnRpID(request, env = process.env) {
  const configured = String(env.IMPRINT_RP_ID || "")
    .trim()
    .toLowerCase();
  if (configured) {
    if (
      configured.includes(":") ||
      configured.includes("/") ||
      configured.includes(" ")
    ) {
      throw new Error("IMPRINT_RP_ID must be a hostname, not a URL");
    }
    return configured;
  }

  requireExplicitProductionConfig(env, "IMPRINT_RP_ID");
  return new URL(request.url).hostname.toLowerCase();
}

function requireExplicitProductionConfig(env, name) {
  if (env.NODE_ENV === "production") {
    throw new Error(`${name} is required in production`);
  }
}
