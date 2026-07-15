#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";

const baseUrl = String(process.env.DRIFT_URL || "http://127.0.0.1:3020").replace(/\/$/, "");
const ticket = process.env.DRIFT_TICKET;
const sessionFile = process.env.DRIFT_SESSION_FILE || ".drift-session";
const cookie = await loadSession();

const command = process.argv[2] || "target";
if (command === "target") {
  await request("GET", "/api/target");
} else if (command === "artifact") {
  const response = await fetch(`${baseUrl}/artifact/drift_vault.so`, { headers: { cookie } });
  if (!response.ok) throw new Error(await response.text());
  process.stdout.write(Buffer.from(await response.arrayBuffer()));
} else if (command === "replay" || command === "submit") {
  const path = process.argv[3];
  if (!path) throw new Error(`usage: node client.mjs ${command} submission.json`);
  const parsed = JSON.parse(await readFile(path, "utf8"));
  const steps = Array.isArray(parsed) ? parsed : parsed.steps;
  await request("POST", `/api/${command}`, { steps });
} else {
  throw new Error("usage: node client.mjs [target|artifact|replay FILE|submit FILE]");
}

async function request(method, path, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { cookie, ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  if (!response.ok) throw new Error(text);
  process.stdout.write(`${text}\n`);
}

async function loadSession() {
  try {
    const stored = (await readFile(sessionFile, "utf8")).trim();
    if (stored) return stored;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  if (!ticket) throw new Error(`DRIFT_TICKET is required when ${sessionFile} does not exist`);
  const response = await fetch(`${baseUrl}/api/session`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ticket }),
  });
  if (!response.ok) throw new Error(`session failed: ${await response.text()}`);
  const nextCookie = response.headers.get("set-cookie")?.split(";", 1)[0];
  if (!nextCookie) throw new Error("service did not return a session cookie");
  await writeFile(sessionFile, `${nextCookie}\n`, { mode: 0o600 });
  return nextCookie;
}
