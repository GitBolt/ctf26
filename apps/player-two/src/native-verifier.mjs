import { spawn } from "node:child_process";

export function createNativeVerifier({ executable = process.env.PLAYER_TWO_HARNESS_PATH, program = process.env.PLAYER_TWO_PROGRAM_PATH, required = process.env.NODE_ENV === "production" } = {}) {
  const harness = executable || new URL("../native/harness/target/release/player-two-harness", import.meta.url).pathname;
  const artifact = program || new URL("../native/dist/player_two_program.so", import.meta.url).pathname;
  return async ({ participantId, firstGeneration, secondGeneration }) => {
    try {
      const result = await run(harness, artifact, { participantId, firstGeneration, secondGeneration });
      return result?.solved === true;
    } catch (error) {
      if (required) throw error;
      return null;
    }
  };
}

function run(executable, program, body) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, ["verify"], { env: { ...process.env, PLAYER_TWO_PROGRAM_PATH: program }, stdio: ["pipe", "pipe", "pipe"] });
    const stdout = [];
    const stderr = [];
    const timer = setTimeout(() => child.kill("SIGKILL"), 8_000);
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.on("error", (error) => { clearTimeout(timer); reject(error); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error(`native verifier rejected replay: ${Buffer.concat(stderr).toString("utf8").trim()}`));
      try { resolve(JSON.parse(Buffer.concat(stdout).toString("utf8"))); }
      catch { reject(new Error("native verifier returned invalid output")); }
    });
    child.stdin.end(JSON.stringify(body));
  });
}
