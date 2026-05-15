import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = join(__dirname, "..", "..", "dist", "index.js");

/**
 * Invoke the built CLI with args. Returns { status, stdout, stderr, json }.
 * `json` is the parsed stdout (or null if not parseable).
 */
export function spawnCli(args, opts = {}) {
  const r = spawnSync("node", [CLI, ...args], {
    encoding: "utf-8",
    cwd: opts.cwd,
    input: opts.input,
    env: { ...process.env, ...(opts.env ?? {}) },
    timeout: opts.timeout ?? 30_000,
  });
  let json = null;
  try {
    json = r.stdout ? JSON.parse(r.stdout) : null;
  } catch {
    /* not JSON; leave null */
  }
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, json };
}
