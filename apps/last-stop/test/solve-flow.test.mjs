import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";

import { issueParticipantTicket } from "@ctf26/participant-ticket";
import { Client } from "ssh2";

import { start } from "../src/server.mjs";

const EVENT = "last-stop-solve-flow";
const SECRET = "last-stop-solve-flow-secret-at-least-32-bytes";
const PARTICIPANT = "last-stop-flow-player";

test("the real launch and SSH journey persists completion and reports the solve", async (t) => {
  const received = [];
  const ingest = http.createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    received.push({
      headers: request.headers,
      body: JSON.parse(Buffer.concat(chunks).toString("utf8")),
    });
    response.writeHead(201).end();
  });
  await listen(ingest);
  t.after(() => close(ingest));

  const service = await start({
    PORT: "0",
    SSH_PORT: "0",
    CTF_EVENT_GENERATION: EVENT,
    LAST_STOP_PUBLIC_ORIGIN: "http://127.0.0.1",
    CHALLENGE_TICKET_SECRET: SECRET,
    LAST_STOP_FLAG_SECRET: "last-stop-solve-flow-flag-secret-at-least-32-bytes",
    LEADERBOARD_INGEST_URL: `http://127.0.0.1:${ingest.address().port}/api/leaderboard/events`,
  });
  t.after(async () => {
    service.sshServer.close();
    await close(service.httpServer);
    await service.store.close();
  });

  const origin = `http://127.0.0.1:${service.httpServer.address().port}`;
  const ticket = issueParticipantTicket({
    eventId: EVENT,
    audience: "last-stop",
    participantId: PARTICIPANT,
  }, SECRET, { jti: "last-stop-real-flow" });
  const launch = await fetch(`${origin}/launch?ticket=${encodeURIComponent(ticket)}`, {
    headers: { accept: "application/json" },
  });
  assert.equal(launch.status, 200);
  const passage = await launch.json();

  const output = await playJourney({
    port: service.sshServer.address().port,
    password: passage.password,
  });
  assert.match(output, /JOURNEY COMPLETE/);
  assert.doesNotMatch(output, /could not process that action/);

  const completion = await service.store.getCompletion(PARTICIPANT);
  assert.equal(completion.participantId, PARTICIPANT);
  assert.match(completion.receipt, /^[A-Za-z0-9_-]{24}$/);

  assert.equal(received.length, 1);
  assert.equal(received[0].body.challenge, "last-stop");
  assert.equal(received[0].body.eventId, EVENT);
  assert.equal(received[0].body.participantId, PARTICIPANT);
  assert.equal(received[0].body.sourceId, completion.receipt);

  const status = await fetch(`${origin}/api/completion?participantId=${PARTICIPANT}`, {
    headers: { authorization: `Bearer ${SECRET}` },
  });
  assert.deepEqual(await status.json(), {
    completed: true,
    completedAt: completion.completedAt,
    eventGeneration: EVENT,
  });
});

function playJourney({ port, password }) {
  return new Promise((resolve, reject) => {
    const client = new Client();
    let output = "";
    let commandsSent = false;
    let completed = false;
    const timer = setTimeout(() => {
      client.end();
      reject(new Error(`SSH journey timed out:\n${output}`));
    }, 20_000);
    client.on("ready", () => {
      client.shell((error, stream) => {
        if (error) return reject(error);
        stream.on("data", (chunk) => {
          output += chunk.toString("utf8");
          const visible = output.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "");
          if (!commandsSent && visible.includes("grand central › ")) {
            commandsSent = true;
            stream.write("go kiosk\rbuy redterminus\rgo central\rgo red\rtap redterminus\rgo terminus\r");
          }
          if (visible.includes("JOURNEY COMPLETE")) {
            completed = true;
            clearTimeout(timer);
            stream.close();
            client.end();
            client.destroy?.();
          }
        });
        stream.on("error", reject);
      });
    });
    client.on("close", () => {
      if (completed) resolve(output);
    });
    client.on("error", reject);
    client.connect({
      host: "127.0.0.1",
      port,
      username: "last-stop",
      password,
      readyTimeout: 10_000,
      hostVerifier: () => true,
    });
  });
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
}

function close(server) {
  if (!server.listening) return Promise.resolve();
  server.closeAllConnections?.();
  return new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}
