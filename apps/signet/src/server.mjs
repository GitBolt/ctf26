import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  handleHealth,
  handleAgentPolicy,
  handleAgentDisclosure,
  handleSession,
  handleSubmit,
  handleTarget,
  jsonResponse,
} from "./http-service.mjs";
import { closeRedis } from "./redis.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../public");
const PORT = Number(process.env.PORT || 4173);
const HOST = process.env.HOST || (process.env.NODE_ENV === "production" ? "0.0.0.0" : "127.0.0.1");
const API = new Map([
  ["/api/health", handleHealth],
  ["/api/session", handleSession],
  ["/api/submit", handleSubmit],
  ["/api/target", handleTarget],
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

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
  const handler = API.get(url.pathname);
  if (handler) {
    await handler(request, response);
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
    const content = await fs.readFile(safePath);
    response.statusCode = 200;
    response.setHeader("content-type", MIME.get(path.extname(safePath)) || "application/octet-stream");
    response.setHeader("x-content-type-options", "nosniff");
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

server.listen(PORT, HOST, () => {
  console.log(`SIGNET player service listening on ${HOST}:${PORT}`);
});

for (const signal of ["SIGTERM", "SIGINT"]) {
  process.once(signal, async () => {
    await new Promise((resolve) => server.close(resolve));
    await closeRedis();
    process.exit(0);
  });
}
