import assert from "node:assert/strict";
import test from "node:test";

import {
  CHALLENGES,
  challengeByKey,
  challengeDestination,
} from "../app/lib/challenges.mjs";

test("challenge catalog has unique, launch-safe keys", () => {
  assert.equal(CHALLENGES.length, 11);
  assert.equal(new Set(CHALLENGES.map(({ key }) => key)).size, CHALLENGES.length);
  assert.equal(
    new Set(CHALLENGES.map(({ audience }) => audience)).size,
    CHALLENGES.length,
  );
  for (const challenge of CHALLENGES) {
    assert.match(challenge.key, /^[a-z0-9-]+$/);
    assert.match(challenge.audience, /^[a-z0-9-]+$/);
    assert.equal(challengeByKey(challenge.key), challenge);
    assert.ok(challenge.starts.length >= 1);
    for (const start of challenge.starts) {
      assert.ok(["launch", "download", "instructions", "physical"].includes(start.kind));
      assert.equal(typeof start.label, "string");
      if (start.kind !== "launch") assert.equal(typeof start.href, "string");
    }
  }
  assert.equal(challengeByKey("not-a-challenge"), null);
});

test("Reward Sniper treats the briefing package and timed market as separate first-class starts", () => {
  const reward = challengeByKey("reward-sniper");
  assert.deepEqual(reward.starts.map(({ kind }) => kind), ["download", "launch"]);
  assert.equal(reward.starts[0].href, "/packages/reward-sniper-player.zip");
  assert.equal(reward.starts[1].label, "Open live market");
});

test("route slugs and signed ticket audiences stay intentionally distinct", () => {
  assert.deepEqual(
    Object.fromEntries(CHALLENGES.map(({ key, audience }) => [key, audience])),
    {
      "reward-sniper": "reward-sniper",
      imprint: "imprint",
      "signet": "signet",
      drift: "drift",
      "last-stop": "last-stop",
      "after-hours": "after-hours",
      "player-two": "player-two",
      "the-broadcast": "the-broadcast",
      "evidence-room": "evidence-room",
      "second-key": "second-key",
      "the-chamber": "the-chamber",
    },
  );
});

test("The Broadcast launches the participant-bound protocol", () => {
  const challenge = challengeByKey("the-broadcast");
  assert.deepEqual(challenge.starts.map(({ kind }) => kind), ["launch"]);
  assert.equal(challenge.format, "Hosted protocol");
  assert.equal(challenge.starts[0].label, "Open broadcast");
});

test("PLAYER TWO launches one hosted arcade cabinet", () => {
  const challenge = challengeByKey("player-two");
  assert.deepEqual(challenge.starts.map(({ kind }) => kind), ["launch"]);
  assert.equal(challenge.format, "Arcade cabinet");
  assert.equal(challenge.starts[0].label, "Enter the arcade");
});

test("AFTER HOURS has one Discord server checkout entry point", () => {
  const challenge = challengeByKey("after-hours");
  assert.deepEqual(challenge.starts.map(({ kind }) => kind), ["launch"]);
  assert.equal(challenge.format, "Discord server bot");
  assert.equal(challenge.starts[0].label, "Start Discord checkout");
});

test("hosted destinations are ticketed and URL credentials are rejected", () => {
  const imprint = challengeByKey("imprint");
  const hosted = challengeDestination(imprint, {
    IMPRINT_URL: "https://imprint.example/challenge?round=2",
  });
  assert.equal(hosted.ticketed, true);
  assert.equal(hosted.url.toString(), "https://imprint.example/challenge?round=2");

  assert.throws(
    () =>
      challengeDestination(imprint, {
        IMPRINT_URL: "https://user:password@imprint.example/",
      }),
    /without credentials/,
  );
  assert.throws(
    () =>
      challengeDestination(imprint, {
        NODE_ENV: "production",
        IMPRINT_URL: "http://imprint.example/",
      }),
    /HTTPS in production/,
  );
  assert.throws(
    () => challengeDestination(imprint, { NODE_ENV: "production" }),
    /must be configured in production/,
  );
});

test("CLI-only challenges stay on the local-kit board until hosted", () => {
  const signet = challengeByKey("signet");
  assert.deepEqual(challengeDestination(signet, {}), {
    url: null,
    ticketed: false,
  });

  const hosted = challengeDestination(signet, {
    SIGNET_URL: "https://signet.example/",
  });
  assert.equal(hosted.ticketed, true);
});
