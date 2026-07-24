import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  handleHealth,
  handleCompletion,
  handleAgentPolicy,
  handleAgentDisclosure,
  handleSession,
  handleProvision,
  handleSubmit,
  handleTarget,
  handleUiEvent,
  jsonResponse,
  recordInterfaceAsset,
} from "./http-service.mjs";
import { closeRedis } from "./redis.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../public");
const API = new Map([
  ["/api/health", handleHealth],
  ["/api/completion", handleCompletion],
  ["/api/session", handleSession],
  ["/api/internal/provision", handleProvision],
  ["/api/submit", handleSubmit],
  ["/api/target", handleTarget],
  ["/api/ui-event", handleUiEvent],
  ["/api/agent-disclosure", handleAgentDisclosure],
  ["/agents.txt", handleAgentPolicy],
  ["/robots.txt", handleAgentPolicy],
  ["/llms.txt", handleAgentPolicy],
  ["/.well-known/agents.txt", handleAgentPolicy],
]);
const MIME = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".gz", "application/gzip"],
  [".svg", "image/svg+xml"],
]);

export function createSignetServer(options = {}) {
  return http.createServer(async (request, response) => {
    const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
    const handler = API.get(url.pathname);
    if (handler) {
      await handler(request, response, options);
      return;
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      jsonResponse(response, 405, { error: { code: "method_not_allowed", message: "Use GET for this resource." } });
      return;
    }
    const relative = url.pathname === "/" ? "index.html" : url.pathname.replace(/^\/+/, "");
    const resolved = path.resolve(ROOT, relative);
    const safePath = resolved.startsWith(`${ROOT}${path.sep}`) ? resolved : path.join(ROOT, "index.html");
    try {
      if (request.method === "GET" && new Set(["index.html", "app.js", "styles.css"]).has(relative)) await recordInterfaceAsset(request, url.pathname, options);
      const content = await fs.readFile(safePath);
      response.statusCode = 200;
      response.setHeader("content-type", MIME.get(path.extname(safePath)) || "application/octet-stream");
      response.setHeader("x-content-type-options", "nosniff");
      response.setHeader("x-frame-options", "DENY");
      response.setHeader("referrer-policy", "no-referrer");
      response.setHeader("content-security-policy", "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
      if (["index.html", "signet-starter.tar.gz"].includes(path.basename(safePath))) {
        response.setHeader("cache-control", "no-store");
      }
      if (request.method === "HEAD") response.end();
      else response.end(content);
    } catch {
      response.statusCode = 404;
      response.end("Not found");
    }
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (process.env.NODE_ENV === "production" && process.env.SIGNET_TARGETS_JSON && process.env.REDIS_URL) {
    const { publishTargets } = await import("../scripts/publish-targets.mjs");
    await publishTargets(JSON.parse(process.env.SIGNET_TARGETS_JSON));
  }
  const port = Number(process.env.PORT || 4173);
  const host = process.env.HOST || (process.env.NODE_ENV === "production" ? "0.0.0.0" : "127.0.0.1");
  const server = createSignetServer();
  server.listen(port, host, () => {
    console.log(`SIGNET player service listening on ${host}:${port}`);
  });
  for (const signal of ["SIGTERM", "SIGINT"]) {
    process.once(signal, async () => {
      await new Promise((resolve) => server.close(resolve));
      await closeRedis();
      process.exit(0);
    });
  }
}
