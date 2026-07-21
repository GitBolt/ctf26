export const CHALLENGES = Object.freeze([
  Object.freeze({
    key: "reward-sniper",
    audience: "reward-sniper",
    number: "01",
    label: "market systems",
    name: "Reward Sniper",
    copy: "Enter the live market challenge.",
    format: "Live market",
    starts: Object.freeze([
      Object.freeze({
        kind: "download",
        label: "Download challenge pack",
        href: "/packages/reward-sniper-player.zip",
      }),
      Object.freeze({
        kind: "launch",
        label: "Open live market",
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
    copy: "Open the passkey challenge surface.",
    format: "Passkey vault",
    starts: Object.freeze([Object.freeze({ kind: "launch", label: "Open vault" })]),
    urlEnv: "IMPRINT_URL",
    localUrl: "http://localhost:3002",
  }),
  Object.freeze({
    key: "signet",
    audience: "signet",
    number: "03",
    label: "deployment systems",
    name: "SIGNET",
    copy: "Enter the source archive challenge.",
    format: "Source archaeology",
    starts: Object.freeze([Object.freeze({ kind: "launch", label: "Open archive" })]),
    urlEnv: "SIGNET_URL",
    localAnchor: "signet-local-kit",
  }),
  Object.freeze({
    key: "drift",
    audience: "drift",
    number: "04",
    label: "program analysis",
    name: "DRIFT",
    copy: "Open the local analysis workspace.",
    format: "Native SBF",
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
    copy: "View your station passage details.",
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
    copy: "Join the event checkout room.",
    format: "Discord server bot",
    starts: Object.freeze([Object.freeze({ kind: "launch", label: "Start Discord checkout" })]),
    urlEnv: "AFTER_HOURS_URL",
    localUrl: "http://localhost:3006/launch",
  }),
  Object.freeze({
    key: "player-two",
    audience: "player-two",
    number: "07",
    label: "credential lifecycle",
    name: "PLAYER TWO",
    copy: "Enter the arcade challenge.",
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
    copy: "Open the wallet protocol challenge.",
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
    copy: "Enter the live evidence room.",
    format: "Live chain investigation",
    starts: Object.freeze([Object.freeze({ kind: "launch", label: "Enter evidence room" })]),
    urlEnv: "EVIDENCE_ROOM_URL",
    localUrl: "http://localhost:3009",
  }),
  Object.freeze({
    key: "second-key",
    audience: "second-key",
    number: "10",
    label: "collateral custody",
    name: "SECOND KEY",
    copy: "Open the collateral desk challenge.",
    format: "Live collateral desk",
    starts: Object.freeze([Object.freeze({ kind: "launch", label: "Open desk" })]),
    urlEnv: "SECOND_KEY_URL",
    localUrl: "http://localhost:3011",
  }),
]);

const CHALLENGE_BY_KEY = new Map(
  CHALLENGES.map((challenge) => [challenge.key, challenge]),
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
