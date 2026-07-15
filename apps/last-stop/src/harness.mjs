import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

export function replayJourney(teamId, actions, env = process.env) {
  const binary = env.LAST_STOP_CHECKER_PATH || join(root, "native", "harness", "target", "release", "last-stop-harness");
  const childEnv = {
    ...env,
    LAST_STOP_PROGRAM_PATH: env.LAST_STOP_PROGRAM_PATH || join(root, "native", "dist", "last_stop_program.so"),
  };
  return new Promise((resolve, reject) => {
    const child = spawn(binary, ["replay"], { env: childEnv, stdio: ["pipe", "pipe", "pipe"] });
    const stdout = [];
    const stderr = [];
    let bytes = 0;
    let done = false;
    const timer = setTimeout(() => finish(Object.assign(new Error("the validator timed out"), { status: 504 })), 12_000);
    function finish(error, value) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      error ? reject(error) : resolve(value);
    }
    for (const [stream, chunks] of [[child.stdout, stdout], [child.stderr, stderr]]) {
      stream.on("data", (chunk) => {
        bytes += chunk.length;
        if (bytes > 1_000_000) {
          child.kill("SIGKILL");
          finish(new Error("the validator returned too much output"));
        } else chunks.push(chunk);
      });
    }
    child.on("error", finish);
    child.on("close", (code) => {
      if (done) return;
      if (code !== 0) {
        const detail = Buffer.concat(stderr).toString("utf8").trim().split("\n").at(-1);
        finish(Object.assign(new Error(detail || "on-chain action rejected"), { status: 422 }));
        return;
      }
      try { finish(null, JSON.parse(Buffer.concat(stdout).toString("utf8"))); }
      catch { finish(new Error("the validator returned malformed output")); }
    });
    child.stdin.end(JSON.stringify({ teamId, actions }));
  });
}
