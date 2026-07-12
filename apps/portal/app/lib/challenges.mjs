export const CHALLENGES = Object.freeze([
  Object.freeze({
    key: "reward-sniper",
    audience: "reward-sniper",
    number: "01",
    label: "market systems",
    name: "Reward Sniper",
    copy: "operate a live market and find an edge under changing conditions.",
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
    copy: "investigate an unfamiliar withdrawal and prove what the protocol accepts.",
    format: "Passkey vault",
    starts: Object.freeze([Object.freeze({ kind: "launch", label: "Open vault" })]),
    urlEnv: "IMPRINT_URL",
    localUrl: "http://localhost:3002",
  }),
  Object.freeze({
    key: "silent-patch",
    audience: "signet",
    number: "03",
    label: "deployment systems",
    name: "SIGNET",
    copy: "recover value from a program whose behavior does not match its surroundings.",
    format: "Source archaeology",
    starts: Object.freeze([Object.freeze({ kind: "launch", label: "Open archive" })]),
    urlEnv: "SILENT_PATCH_URL",
    localAnchor: "signet-local-kit",
  }),
  Object.freeze({
    key: "overclock",
    audience: "overclock",
    number: "04",
    label: "program analysis",
    name: "DRIFT",
    copy: "reverse a sealed program and make the local vault pay.",
    format: "Native SBF",
    starts: Object.freeze([Object.freeze({ kind: "launch", label: "Open workspace" })]),
    urlEnv: "OVERCLOCK_URL",
    localAnchor: "drift-local-kit",
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
