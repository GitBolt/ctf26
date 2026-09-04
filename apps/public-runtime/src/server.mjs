import { spawn } from "node:child_process";
import crypto from "node:crypto";
import http from "node:http";
import { brotliDecompressSync, gunzipSync, inflateSync } from "node:zlib";
import { issueParticipantTicket } from "../../../packages/participant-ticket/index.js";

const ROOT = "/workspace";
const group = process.env.PUBLIC_RUNTIME_GROUP || "core";
const publicPort = Number(process.env.PORT || 3000);
const PUBLIC_PLAYER_COOKIE = "stctf_public_player";
const PUBLIC_PARTICIPANT_PATTERN = /^public_[a-f0-9]{24}$/;

const allServices = {
  "reward-sniper": { port: 4010, command: ["node", "src/server.mjs"], cwd: `${ROOT}/apps/reward-sniper` },
  signet: { port: 4011, command: ["node", "src/server.mjs"], cwd: `${ROOT}/apps/signet` },
  drift: { port: 4012, command: ["node", "src/service.mjs"], cwd: `${ROOT}/apps/drift` },
  "last-stop": { port: 4013, command: ["node", "src/server.mjs"], cwd: `${ROOT}/apps/last-stop`, extra: { SSH_PORT: "2222" } },
  "after-hours": { port: 4014, command: ["node", "src/server.mjs"], cwd: `${ROOT}/apps/after-hours` },
  "player-two": { port: 4015, command: ["node", "src/server.mjs"], cwd: `${ROOT}/apps/player-two` },
  "the-broadcast": { port: 4016, command: ["node", "src/server.mjs"], cwd: `${ROOT}/apps/the-broadcast` },
  "evidence-room": { port: 4017, command: ["node", "src/server.mjs"], cwd: `${ROOT}/apps/evidence-room` },
  "second-key": { port: 4018, command: ["node", "src/server.mjs"], cwd: `${ROOT}/apps/second-key` },
  "the-chamber": { port: 4019, command: ["node", "src/server.mjs"], cwd: `${ROOT}/apps/the-chamber` },
  imprint: { port: 4020, command: ["npm", "start", "--", "-p", "4020", "-H", "0.0.0.0"], cwd: `${ROOT}/apps/imprint/web` },
};

const keys = group === "native"
  ? ["drift", "last-stop"]
  : ["reward-sniper", "signet", "after-hours", "player-two", "the-broadcast", "evidence-room", "second-key", "the-chamber", "imprint"];
const services = new Map(keys.map((key) => [key, allServices[key]]));
const children = new Map();

const generatedSecrets = new Map();
function secret(name) {
  if (process.env[name]) return process.env[name];
  if (!generatedSecrets.has(name)) generatedSecrets.set(name, crypto.randomBytes(32).toString("base64url"));
  return generatedSecrets.get(name);
}

const sharedEnv = {
  ...process.env,
  NODE_ENV: "production",
  HOST: "0.0.0.0",
  CTF_EVENT_GENERATION: process.env.CTF_EVENT_GENERATION || "ctf26-public",
  REDIS_URL: process.env.REDIS_URL || "redis://127.0.0.1:6379",
  PARTICIPANT_TICKET_SECRET: secret("CHALLENGE_LAUNCH_SECRET"),
  CHALLENGE_TICKET_SECRET: secret("CHALLENGE_LAUNCH_SECRET"),
  SESSION_SECRET: secret("PUBLIC_SESSION_SECRET"),
  CHALLENGE_SESSION_SECRET: secret("PUBLIC_SESSION_SECRET"),
  IMPRINT_SESSION_SECRET: secret("PUBLIC_SESSION_SECRET"),
  AGENT_POLICY_SECRET: secret("PUBLIC_POLICY_SECRET"),
  COMPLETION_SECRET: secret("PUBLIC_COMPLETION_SECRET"),
  FLAG_SECRET: secret("PUBLIC_FLAG_SECRET"),
  LAST_STOP_FLAG_SECRET: secret("LAST_STOP_FLAG_SECRET"),
  AFTER_HOURS_FLAG_SECRET: secret("AFTER_HOURS_FLAG_SECRET"),
  IMPRINT_FLAG_SECRET: secret("IMPRINT_FLAG_SECRET"),
  INSTANCE_SECRET: secret("INSTANCE_SECRET"),
  IMPRINT_INSTANCE_SECRET: secret("IMPRINT_INSTANCE_SECRET"),
};

function startProcess(name, spec) {
  const [command, ...args] = spec.command;
  const child = spawn(command, args, {
    cwd: spec.cwd,
    env: { ...sharedEnv, ...spec.extra, PORT: String(spec.port) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.set(name, child);
  child.stdout.on("data", (chunk) => process.stdout.write(`[${name}] ${chunk}`));
  child.stderr.on("data", (chunk) => process.stderr.write(`[${name}] ${chunk}`));
  child.on("exit", (code, signal) => {
    console.error(`[${name}] exited (${code ?? signal})`);
    children.delete(name);
    if (!shuttingDown) setTimeout(() => startProcess(name, spec), 1_000).unref();
  });
}

let shuttingDown = false;
const redis = process.env.REDIS_URL
  ? null
  : spawn("redis-server", ["--save", "", "--appendonly", "no", "--bind", "127.0.0.1"], {
    stdio: ["ignore", "pipe", "pipe"],
  });
redis?.stdout.on("data", (chunk) => process.stdout.write(`[redis] ${chunk}`));
redis?.stderr.on("data", (chunk) => process.stderr.write(`[redis] ${chunk}`));

for (const [name, spec] of services) startProcess(name, spec);

function prefixLocation(location, base) {
  if (!location || !location.startsWith("/")) return location;
  return `${base}${location}`;
}

function rewriteText(body, contentType, base) {
  let text = body.toString("utf8");
  if (contentType.includes("text/html")) {
    const bootstrap = `<script src="${base}/__public-bootstrap.js"></script>`;
    text = text.replace(/\b(href|src|action)=(['"])\/(?!\/)([^'"]*)/gi, (match, attribute, quote, path) =>
      path.startsWith(`${base.slice(1)}/`) ? match : `${attribute}=${quote}${base}/${path}`
    );
    text = text.replace(/<head(.*?)>/i, `<head$1>${bootstrap}`);
  } else if (contentType.includes("text/css")) {
    text = text.replace(/url\((['"]?)\/(?!\/)/gi, `url($1${base}/`);
  } else if (contentType.includes("javascript")) {
    text = text.replace(/(\bfrom\s*|\bimport\s*\()(['"])\/(?!\/)([^'"]+)/g, `$1$2${base}/$3`);
  }
  return Buffer.from(text);
}

function decodeBody(body, encoding) {
  const value = String(encoding || "identity").trim().toLowerCase();
  if (!value || value === "identity") return body;
  if (value === "gzip") return gunzipSync(body);
  if (value === "br") return brotliDecompressSync(body);
  if (value === "deflate") return inflateSync(body);
  throw new Error(`unsupported upstream content encoding: ${value}`);
}

function proxy(request, response, key, spec, pathname, options = {}) {
  const base = `/c/${key}`;
  const headers = { ...request.headers, host: `127.0.0.1:${spec.port}` };
  if (options.requestBody) {
    headers["content-type"] = "application/json";
    headers["content-length"] = String(options.requestBody.length);
    delete headers["transfer-encoding"];
  }
  // Rewritten HTML and CSS must be decoded before paths are changed. Asking
  // the local upstream for identity encoding avoids corrupting compressed
  // Next.js responses; decodeBody remains a defensive fallback.
  headers["accept-encoding"] = "identity";
  headers["x-forwarded-host"] = request.headers.host || "";
  headers["x-forwarded-proto"] = "https";
  const upstream = http.request({
    hostname: "127.0.0.1",
    port: spec.port,
    method: request.method,
    path: pathname,
    headers,
  }, (incoming) => {
    const responseHeaders = { ...incoming.headers };
    if (responseHeaders.location) responseHeaders.location = prefixLocation(responseHeaders.location, base);
    if (responseHeaders["set-cookie"]) {
      const upstreamCookies = Array.isArray(responseHeaders["set-cookie"])
        ? responseHeaders["set-cookie"]
        : [responseHeaders["set-cookie"]];
      responseHeaders["set-cookie"] = upstreamCookies.map((cookie) =>
        /;\s*path=/i.test(cookie)
          ? cookie.replace(/;\s*path=\/[^;]*/i, `; Path=${base}/`)
          : `${cookie}; Path=${base}/`
      );
    }
    if (options.setCookie) {
      responseHeaders["set-cookie"] = [
        ...(responseHeaders["set-cookie"] || []),
        options.setCookie,
      ];
    }
    const contentType = String(responseHeaders["content-type"] || "").toLowerCase();
    const rewrite = contentType.includes("text/html") || contentType.includes("text/css") || contentType.includes("javascript");
    if (!rewrite) {
      response.writeHead(incoming.statusCode || 502, responseHeaders);
      incoming.pipe(response);
      return;
    }
    const chunks = [];
    incoming.on("data", (chunk) => chunks.push(chunk));
    incoming.on("end", () => {
      let body;
      try {
        const decoded = decodeBody(Buffer.concat(chunks), responseHeaders["content-encoding"]);
        body = rewriteText(decoded, contentType, base);
      } catch (error) {
        response.writeHead(502, { "content-type": "application/json", "cache-control": "no-store" });
        response.end(JSON.stringify({ error: `${key} returned an unreadable response` }));
        return;
      }
      delete responseHeaders["content-encoding"];
      delete responseHeaders["content-length"];
      delete responseHeaders.etag;
      responseHeaders["content-length"] = String(body.length);
      response.writeHead(incoming.statusCode || 502, responseHeaders);
      response.end(body);
    });
  });
  upstream.on("error", (error) => {
    response.writeHead(503, { "content-type": "application/json", "cache-control": "no-store" });
    response.end(JSON.stringify({ error: `${key} is starting`, detail: error.code || "unavailable" }));
  });
  if (options.requestBody) {
    request.resume();
    upstream.end(options.requestBody);
  } else {
    request.pipe(upstream);
  }
}

function cookieValue(request, name) {
  for (const part of String(request.headers.cookie || "").split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return decodeURIComponent(value.join("="));
  }
  return "";
}

function publicParticipant(request) {
  const existing = cookieValue(request, PUBLIC_PLAYER_COOKIE);
  if (PUBLIC_PARTICIPANT_PATTERN.test(existing)) return { participantId: existing, setCookie: null };
  const participantId = `public_${crypto.randomBytes(12).toString("hex")}`;
  return {
    participantId,
    setCookie: `${PUBLIC_PLAYER_COOKIE}=${participantId}; Path=/; Max-Age=31536000; HttpOnly; Secure; SameSite=Lax`,
  };
}

function publicLaunchTicket(key, participantId) {
  return issueParticipantTicket({
    eventId: sharedEnv.CTF_EVENT_GENERATION,
    audience: key,
    participantId,
  }, sharedEnv.CHALLENGE_TICKET_SECRET);
}

function publicBootstrap(base) {
  return `(()=>{const b=${JSON.stringify(base)},f=window.fetch.bind(window),p=u=>{if(u.origin===location.origin&&u.pathname.startsWith("/")&&!u.pathname.startsWith(b+"/"))u.pathname=b+u.pathname;return u};window.fetch=(i,o)=>{if(typeof i==="string")i=p(new URL(i,location.origin)).toString();else if(i instanceof Request)i=new Request(p(new URL(i.url)),i);return f(i,o)}})();`;
}

const ticketedLaunchPaths = new Map([
  ["after-hours", "/launch"],
  ["last-stop", "/launch"],
  ["the-broadcast", "/launch"],
]);

async function childHealth(key, spec) {
  const candidates = key === "reward-sniper" || key === "signet" ? ["/api/health"] : ["/health", "/api/health"];
  for (const path of candidates) {
    try {
      const result = await fetch(`http://127.0.0.1:${spec.port}${path}`, { signal: AbortSignal.timeout(2_000) });
      if (result.status !== 404) return { ready: result.status < 500, status: result.status };
    } catch {}
  }
  return { ready: false, status: 0 };
}

const gateway = http.createServer(async (request, response) => {
  const url = new URL(request.url, "http://public-runtime.local");
  if (url.pathname === "/health") {
    const checks = Object.fromEntries(await Promise.all([...services].map(async ([key, spec]) => [key, await childHealth(key, spec)])));
    const ok = Object.values(checks).every((check) => check.ready);
    response.writeHead(ok ? 200 : 503, { "content-type": "application/json", "cache-control": "no-store" });
    return response.end(JSON.stringify({ ok, group, challenges: checks }));
  }
  const match = url.pathname.match(/^\/c\/([a-z0-9-]+)(\/.*)?$/);
  const key = match?.[1];
  const spec = services.get(key);
  if (!spec) {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    return response.end("challenge not found\n");
  }
  const challengePath = match[2] || "/";
  if (request.method === "GET" && challengePath === "/__public-bootstrap.js") {
    response.writeHead(200, {
      "content-type": "text/javascript; charset=utf-8",
      "cache-control": "public, max-age=3600",
      "content-security-policy": "default-src 'none'",
    });
    return response.end(publicBootstrap(`/c/${key}`));
  }
  const publicIdentity = publicParticipant(request);
  const ticket = publicLaunchTicket(key, publicIdentity.participantId);
  const isSessionBootstrap = request.method === "POST" && challengePath === "/api/session";
  const isLaunchBootstrap = request.method === "GET" && ticketedLaunchPaths.get(key) === challengePath;

  if (isSessionBootstrap) {
    const body = Buffer.from(JSON.stringify({ ticket }));
    return proxy(request, response, key, spec, `${challengePath}${url.search}`, {
      requestBody: body,
      setCookie: publicIdentity.setCookie,
    });
  }

  if (isLaunchBootstrap) url.searchParams.set("ticket", ticket);
  return proxy(request, response, key, spec, `${challengePath}${url.search}`, {
    setCookie: isLaunchBootstrap ? publicIdentity.setCookie : null,
  });
});

gateway.listen(publicPort, "0.0.0.0", () => {
  console.log(`public ${group} runtime listening on ${publicPort}: ${keys.join(", ")}`);
});

for (const signal of ["SIGTERM", "SIGINT"]) {
  process.once(signal, () => {
    shuttingDown = true;
    gateway.close();
    for (const child of children.values()) child.kill(signal);
    redis?.kill(signal);
    setTimeout(() => process.exit(0), 1_000).unref();
  });
}
