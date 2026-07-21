import assert from "node:assert/strict";
import test from "node:test";

import {
  afterHoursCompletion,
  broadcastCompletion,
  completedChallengeKeys,
  completionMatchesEvent,
  driftCompletion,
  lastStopCompletion,
  evidenceRoomCompletion,
  playerTwoCompletion,
  recoverLeaderboardCompletions,
  secondKeyCompletion,
  signetCompletion,
} from "../app/lib/completions.mjs";

const env = {
  LAST_STOP_URL: "https://last-stop.example/launch",
  CHALLENGE_TICKET_SECRET_LAST_STOP: "completion-test-secret-xxxxxxxxxxxxxxxxxxxxxxxx",
};

test("LAST STOP completion is read privately for the signed-in participant", async () => {
  let request;
  const completion = await lastStopCompletion({ participant_id: "player-26" }, {
    env,
    fetchImpl: async (url, options) => {
      request = { url, options };
      return new Response(JSON.stringify({ completed: true, completedAt: "2026-07-15T12:00:00.000Z", eventGeneration: "event-a" }));
    },
  });
  assert.equal(request.url.toString(), "https://last-stop.example/api/completion?participantId=player-26");
  assert.equal(request.options.headers.authorization, `Bearer ${env.CHALLENGE_TICKET_SECRET_LAST_STOP}`);
  assert.deepEqual(completion, {
    challenge: "last-stop",
    completedAt: "2026-07-15T12:00:00.000Z",
    eventGeneration: "event-a",
  });
});

test("The Broadcast completion is read from its private participant endpoint", async () => {
  const secret = "broadcast-completion-secret-xxxxxxxxxxxxxxxxxx";
  let request;
  const completion = await broadcastCompletion({ participant_id: "player-26" }, {
    env: { THE_BROADCAST_URL: "https://broadcast.example/launch", CHALLENGE_TICKET_SECRET_THE_BROADCAST: secret },
    fetchImpl: async (url, options) => {
      request = { url, options };
      return new Response(JSON.stringify({ completed: true, completedAt: "2026-07-15T13:00:00.000Z", eventGeneration: "event-a" }));
    },
  });
  assert.equal(request.url.toString(), "https://broadcast.example/api/completion?participantId=player-26");
  assert.equal(request.options.headers.authorization, `Bearer ${secret}`);
  assert.deepEqual(completion, { challenge: "the-broadcast", completedAt: "2026-07-15T13:00:00.000Z", eventGeneration: "event-a" });
});

test("Player Two completion is read from its private participant endpoint", async () => {
  const secret = "player-two-completion-secret-xxxxxxxxxxxxxxxx";
  const completion = await playerTwoCompletion({ participant_id: "player-26" }, {
    env: { PLAYER_TWO_URL: "https://player-two.example/", CHALLENGE_TICKET_SECRET_PLAYER_TWO: secret },
    fetchImpl: async () => new Response(JSON.stringify({ completed: true, completedAt: "2026-07-15T14:00:00.000Z", eventGeneration: "event-a" })),
  });
  assert.deepEqual(completion, { challenge: "player-two", completedAt: "2026-07-15T14:00:00.000Z", eventGeneration: "event-a" });
});

test("After Hours completion is read from its private participant endpoint", async () => {
  const secret = "after-hours-completion-secret-xxxxxxxxxxxxxxx";
  const completion = await afterHoursCompletion({ participant_id: "player-26" }, {
    env: { AFTER_HOURS_URL: "https://after-hours.example/", CHALLENGE_TICKET_SECRET_AFTER_HOURS: secret },
    fetchImpl: async () => new Response(JSON.stringify({ completed: true, completedAt: "2026-07-15T15:00:00.000Z", eventGeneration: "event-a" })),
  });
  assert.deepEqual(completion, { challenge: "after-hours", completedAt: "2026-07-15T15:00:00.000Z", eventGeneration: "event-a" });
});

test("an unfinished participant returns no completion", async () => {
  const completion = await lastStopCompletion({ participant_id: "player-26" }, {
    env,
    fetchImpl: async () => new Response(JSON.stringify({ completed: false })),
  });
  assert.equal(completion, null);
});

test("Evidence Room completion is read from its private participant endpoint", async () => {
  const secret = "evidence-room-completion-secret-xxxxxxxxxxxxx";
  const completion = await evidenceRoomCompletion({ participant_id: "player-26" }, {
    env: { EVIDENCE_ROOM_URL: "https://evidence-room.example/", CHALLENGE_TICKET_SECRET_EVIDENCE_ROOM: secret },
    fetchImpl: async () => new Response(JSON.stringify({ completed: true, completedAt: "2026-07-16T12:00:00.000Z", eventGeneration: "event-a" })),
  });
  assert.deepEqual(completion, { challenge: "evidence-room", completedAt: "2026-07-16T12:00:00.000Z", eventGeneration: "event-a" });
});

test("Second Key completion is read from its private participant endpoint", async () => {
  const secret = "second-key-completion-secret-xxxxxxxxxxxxxxx";
  const completion = await secondKeyCompletion({ participant_id: "player-26" }, {
    env: { SECOND_KEY_URL: "https://second-key.example/", CHALLENGE_TICKET_SECRET_SECOND_KEY: secret },
    fetchImpl: async () => new Response(JSON.stringify({ completed: true, completedAt: "2026-07-16T13:00:00.000Z", eventGeneration: "event-a" })),
  });
  assert.deepEqual(completion, { challenge: "second-key", completedAt: "2026-07-16T13:00:00.000Z", eventGeneration: "event-a" });
});

test("Signet and Drift expose the same private recovery contract", async () => {
  const secret = "generation-completion-secret-xxxxxxxxxxxxxxxx";
  const response = JSON.stringify({ completed: true, completedAt: "2026-07-16T14:00:00.000Z", eventGeneration: "event-a" });
  const signet = await signetCompletion({ participant_id: "player-26" }, {
    env: { SIGNET_URL: "https://signet.example/", CHALLENGE_TICKET_SECRET_SIGNET: secret },
    fetchImpl: async () => new Response(response),
  });
  const drift = await driftCompletion({ participant_id: "player-26" }, {
    env: { DRIFT_URL: "https://drift.example/", CHALLENGE_TICKET_SECRET_DRIFT: secret },
    fetchImpl: async () => new Response(response),
  });
  assert.deepEqual(signet, { challenge: "signet", completedAt: "2026-07-16T14:00:00.000Z", eventGeneration: "event-a" });
  assert.deepEqual(drift, { challenge: "drift", completedAt: "2026-07-16T14:00:00.000Z", eventGeneration: "event-a" });
});

test("authoritative completion reads idempotently repair missed leaderboard events", async () => {
  const events = [];
  const stored = new Set(["last-stop"]);
  const recovered = await recoverLeaderboardCompletions({
    participant_id: "participant-26",
  }, [
    { challenge: "last-stop", completedAt: "2026-07-15T12:00:00.000Z", eventGeneration: "event-a" },
    { challenge: "the-broadcast", completedAt: "2026-07-15T13:00:00.000Z", eventGeneration: "event-a" },
    null,
  ], {
    async recordSolve(event) {
      events.push(event);
      if (stored.has(event.challenge)) return false;
      stored.add(event.challenge);
      return true;
    },
  }, { env: { LEADERBOARD_EVENT_GENERATION: "event-a" } });
  assert.deepEqual(recovered, ["the-broadcast"]);
  assert.equal(events.length, 2);
  assert.equal(events[1].participantId, "participant-26");
  assert.equal(events[1].eventId, "event-a");
  assert.equal(events[1].sourceId, "completion-recovery:the-broadcast:participant-26");
  assert.equal(events[1].occurredAt, "2026-07-15T13:00:00.000Z");
});

test("completion recovery rejects state from another event generation", async () => {
  const events = [];
  const recovered = await recoverLeaderboardCompletions(
    { participant_id: "participant-26" },
    [
      { challenge: "signet", completedAt: "2026-07-15T12:00:00.000Z", eventGeneration: "old-event" },
      { challenge: "drift", completedAt: "2026-07-15T12:01:00.000Z", eventGeneration: "event-a" },
    ],
    { async recordSolve(event) { events.push(event); return true; } },
    { env: { LEADERBOARD_EVENT_GENERATION: "event-a" } },
  );
  assert.deepEqual(recovered, ["drift"]);
  assert.deepEqual(events.map((event) => event.challenge), ["drift"]);
});

test("challenge status only includes solves and completion receipts from the active event", () => {
  const completions = [
    { challenge: "last-stop", completedAt: "2026-07-15T12:00:00.000Z", eventGeneration: "old-event" },
    { challenge: "the-broadcast", completedAt: "2026-07-15T13:00:00.000Z", eventGeneration: "event-a" },
  ];
  const completed = completedChallengeKeys({
    completions,
    solves: [
      { challenge: "imprint", participantId: "player-26", eventId: "old-event" },
      { challenge: "signet", participantId: "player-26", eventId: "event-a" },
      { challenge: "drift", participantId: "another-player", eventId: "event-a" },
    ],
    participantId: "player-26",
    eventGeneration: "event-a",
  });
  assert.deepEqual([...completed].sort(), ["signet", "the-broadcast"]);
  assert.equal(completionMatchesEvent(completions[0], "event-a"), false);
  assert.equal(completionMatchesEvent(completions[1], "event-a"), true);
  assert.equal(completionMatchesEvent(completions[1], ""), false);
});
