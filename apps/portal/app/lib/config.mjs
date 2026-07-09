export function centralBaseUrl(env = process.env) {
  const configured = String(env.CENTRAL_BASE_URL || "").trim();
  if (!configured && env.NODE_ENV === "production") {
    throw new Error("CENTRAL_BASE_URL must be configured in production");
  }

  const url = new URL(configured || "http://localhost:3001");
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      "CENTRAL_BASE_URL must be an HTTP(S) origin without credentials, query, or fragment",
    );
  }
  if (url.pathname !== "/") {
    throw new Error("CENTRAL_BASE_URL must not contain a path");
  }
  if (env.NODE_ENV === "production" && url.protocol !== "https:") {
    throw new Error("CENTRAL_BASE_URL must use HTTPS in production");
  }
  return url.origin;
}
