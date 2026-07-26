export const CHALLENGES = Object.freeze([
  Object.freeze({
    key: "reward-sniper",
    audience: "reward-sniper",
    number: "01",
    label: "market systems",
    name: "Reward Sniper",
    copy: "The scored market is open.",
    format: "Live market",
    starts: Object.freeze([
      Object.freeze({
        kind: "download",
        label: "Download challenge pack",
        href: "/packages/reward-sniper-player.zip",
      }),
      Object.freeze({
        kind: "launch",
        label: "Open the market",
      }),
    ]),
    urlEnv: "REWARD_SNIPER_URL",
    localUrl: "http://localhost:3010/web/",
  }),
  Object.freeze({
    key: "imprint",
    audience: "imprint",
    number: "02",
    label: "authorization",
    name: "IMPRINT",
    copy: "The vault is waiting.",
    format: "Hosted vault",
    starts: Object.freeze([Object.freeze({ kind: "launch", label: "Open the vault" })]),
    urlEnv: "IMPRINT_URL",
    localUrl: "http://localhost:3002",
  }),
  Object.freeze({
    key: "signet",
    audience: "signet",
    number: "03",
    label: "deployment systems",
    name: "SIGNET",
    copy: "Your assignment is ready.",
    format: "Assigned instance",
    starts: Object.freeze([Object.freeze({ kind: "launch", label: "Begin" })]),
    urlEnv: "SIGNET_URL",
    localAnchor: "signet-local-kit",
  }),
  Object.freeze({
    key: "drift",
    audience: "drift",
    number: "04",
    label: "program analysis",
    name: "DRIFT",
    copy: "The workspace is ready.",
    format: "Local workspace",
    starts: Object.freeze([Object.freeze({ kind: "launch", label: "Open workspace" })]),
    urlEnv: "DRIFT_URL",
    localAnchor: "drift-local-kit",
  }),
  Object.freeze({
    key: "last-stop",
    audience: "last-stop",
    number: "05",
    label: "derived addresses",
    name: "LAST STOP",
    copy: "Your passage is ready.",
    format: "Hosted SSH",
    starts: Object.freeze([Object.freeze({ kind: "instructions", label: "View SSH details", href: "/challenge/last-stop" })]),
    urlEnv: "LAST_STOP_URL",
    localUrl: "http://localhost:3005/launch",
  }),
  Object.freeze({
    key: "after-hours",
    audience: "after-hours",
    number: "06",
    label: "payment systems",
    name: "AFTER HOURS",
    copy: "The night desk is open.",
    format: "Discord server",
    starts: Object.freeze([Object.freeze({ kind: "launch", label: "Join the server" })]),
    urlEnv: "AFTER_HOURS_URL",
    localUrl: "http://localhost:3006/launch",
  }),
  Object.freeze({
    key: "player-two",
    audience: "player-two",
    number: "07",
    label: "credential lifecycle",
    name: "PLAYER TWO",
    copy: "One cabinet is reserved for you.",
    format: "Arcade cabinet",
    starts: Object.freeze([Object.freeze({ kind: "launch", label: "Enter the arcade" })]),
    urlEnv: "PLAYER_TWO_URL",
    localUrl: "http://localhost:3007/",
  }),
  Object.freeze({
    key: "the-broadcast",
    audience: "the-broadcast",
    number: "08",
    label: "wallet cryptography",
    name: "THE BROADCAST",
    copy: "The channel is live.",
    format: "Hosted protocol",
    starts: Object.freeze([Object.freeze({ kind: "launch", label: "Open broadcast" })]),
    urlEnv: "THE_BROADCAST_URL",
    localUrl: "http://localhost:3008/launch",
  }),
  Object.freeze({
    key: "evidence-room",
    audience: "evidence-room",
    number: "09",
    label: "evidence room",
    name: "EVIDENCE ROOM",
    copy: "The room is staffed.",
    format: "Live room",
    starts: Object.freeze([Object.freeze({ kind: "launch", label: "Enter the room" })]),
    urlEnv: "EVIDENCE_ROOM_URL",
    localUrl: "http://localhost:3009",
  }),
  Object.freeze({
    key: "second-key",
    audience: "second-key",
    number: "10",
    label: "collateral custody",
    name: "SECOND KEY",
    copy: "The desk will see you now.",
    format: "Live desk",
    starts: Object.freeze([Object.freeze({ kind: "launch", label: "Open the desk" })]),
    urlEnv: "SECOND_KEY_URL",
    localUrl: "http://localhost:3011",
  }),
  Object.freeze({
    key: "the-chamber",
    audience: "the-chamber",
    number: "11",
    label: "cross-program invocation",
    name: "THE CHAMBER",
    copy: "The door is shut.",
    format: "Live vault",
    starts: Object.freeze([Object.freeze({ kind: "launch", label: "Approach the chamber" })]),
    urlEnv: "THE_CHAMBER_URL",
    localUrl: "http://localhost:3012",
  }),
]);

const CHALLENGE_BY_KEY = new Map(
  CHALLENGES.map((challenge) => [challenge.key, challenge]),
);

export const CHALLENGE_DISPLAY_ORDER = Object.freeze([
  "last-stop",
  "player-two",
  "after-hours",
  "the-chamber",
  "second-key",
  "evidence-room",
  "the-broadcast",
  "imprint",
  "signet",
  "drift",
  "reward-sniper",
]);

export const DISPLAY_CHALLENGES = Object.freeze(
  CHALLENGE_DISPLAY_ORDER.map((key) => CHALLENGE_BY_KEY.get(key)),
);

export function challengeByKey(key) {
  return CHALLENGE_BY_KEY.get(String(key || "")) || null;
}

export function challengeDestination(challenge, env = process.env) {
  const configuredUrl = String(env[challenge.urlEnv] || "").trim();
  if (configuredUrl) {
    const url = new URL(configuredUrl);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
      throw new Error(`${challenge.urlEnv} must be an HTTP(S) URL without credentials`);
    }
    if (env.NODE_ENV === "production" && url.protocol !== "https:") {
      throw new Error(`${challenge.urlEnv} must use HTTPS in production`);
    }
    return { url, ticketed: true };
  }

  if (challenge.localUrl && env.NODE_ENV !== "production") {
    return { url: new URL(challenge.localUrl), ticketed: true };
  }

  if (env.NODE_ENV === "production" && challenge.localUrl) {
    throw new Error(`${challenge.urlEnv} must be configured in production`);
  }

  return { url: null, ticketed: false };
}
