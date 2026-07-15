import assert from "node:assert/strict";
import test from "node:test";

import { lastStopCompletion, stGenesisCompletion } from "../app/lib/completions.mjs";

const env = {
  LAST_STOP_URL: "https://last-stop.example/launch",
  CHALLENGE_TICKET_SECRET_LAST_STOP: "completion-test-secret-xxxxxxxxxxxxxxxxxxxxxxxx",
};

test("LAST STOP completion is read privately for the signed-in team", async () => {
  let request;
  const completion = await lastStopCompletion({ team_id: "team-26" }, {
    env,
    fetchImpl: async (url, options) => {
      request = { url, options };
      return new Response(JSON.stringify({ completed: true, completedAt: "2026-07-15T12:00:00.000Z" }));
    },
  });
  assert.equal(request.url.toString(), "https://last-stop.example/api/completion?teamId=team-26");
  assert.equal(request.options.headers.authorization, `Bearer ${env.CHALLENGE_TICKET_SECRET_LAST_STOP}`);
  assert.deepEqual(completion, {
    challenge: "last-stop",
    completedAt: "2026-07-15T12:00:00.000Z",
  });
});

test("$ST Genesis completion is read from its private team endpoint", async () => {
  const secret = "genesis-completion-secret-xxxxxxxxxxxxxxxxxxxx";
  let request;
  const completion = await stGenesisCompletion({ team_id: "team-26" }, {
    env: { ST_GENESIS_AIRDROP_URL: "https://genesis.example/launch", CHALLENGE_TICKET_SECRET_ST_GENESIS_AIRDROP: secret },
    fetchImpl: async (url, options) => {
      request = { url, options };
      return new Response(JSON.stringify({ completed: true, completedAt: "2026-07-15T13:00:00.000Z" }));
    },
  });
  assert.equal(request.url.toString(), "https://genesis.example/api/completion?teamId=team-26");
  assert.equal(request.options.headers.authorization, `Bearer ${secret}`);
  assert.deepEqual(completion, { challenge: "st-genesis-airdrop", completedAt: "2026-07-15T13:00:00.000Z" });
});

test("an unfinished team returns no completion", async () => {
  const completion = await lastStopCompletion({ team_id: "team-26" }, {
    env,
    fetchImpl: async () => new Response(JSON.stringify({ completed: false })),
  });
  assert.equal(completion, null);
});
