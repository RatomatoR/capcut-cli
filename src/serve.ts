import { spawnSync } from "node:child_process";
import { createReadStream, existsSync } from "node:fs";
import { createInterface } from "node:readline";

export interface ServeOptions {
  queuePath?: string;
  cliPath: string; // path to the built dist/index.js
  failFast?: boolean;
}

export interface JobInput {
  cmd: string;
  args?: string[];
  project?: string;
}

export interface JobResult {
  ok: boolean;
  cmd: string;
  args: string[];
  status: number | null;
  stdout?: unknown;
  stderr?: string;
}

/**
 * Stateless JSONL queue runner. Reads {cmd, args, project} jobs from either a
 * file or stdin, dispatches each to the existing CLI, writes one JSONL result
 * line per job to stdout. No daemon, no port, no shared state — the process
 * exits when the queue drains.
 *
 * This unlocks n8n / Coze / Make / cron without becoming a stateful service.
 */
export async function serveQueue(opts: ServeOptions): Promise<{ succeeded: number; failed: number }> {
  const input = opts.queuePath ? createReadStream(opts.queuePath, "utf-8") : process.stdin;
  if (opts.queuePath && !existsSync(opts.queuePath)) {
    throw new Error(`Queue file not found: ${opts.queuePath}`);
  }
  const reader = createInterface({ input, crlfDelay: Infinity });
  let succeeded = 0;
  let failed = 0;
  for await (const rawLine of reader) {
    const line = rawLine.trim();
    if (!line) continue;
    let job: JobInput;
    try {
      job = JSON.parse(line) as JobInput;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      writeResult({ ok: false, cmd: "", args: [], status: null, stderr: `JSON parse error: ${msg}` });
      failed++;
      if (opts.failFast) break;
      continue;
    }
    const result = runJob(opts.cliPath, job);
    writeResult(result);
    if (result.ok) succeeded++;
    else failed++;
    if (!result.ok && opts.failFast) break;
  }
  return { succeeded, failed };
}

function runJob(cliPath: string, job: JobInput): JobResult {
  if (!job.cmd || typeof job.cmd !== "string") {
    return { ok: false, cmd: "", args: [], status: null, stderr: "missing or invalid 'cmd' field" };
  }
  const args: string[] = [job.cmd];
  if (job.project) args.push(job.project);
  if (Array.isArray(job.args)) args.push(...job.args.map(String));
  const r = spawnSync("node", [cliPath, ...args], { encoding: "utf-8", timeout: 60_000 });
  let stdout: unknown = r.stdout;
  try {
    if (r.stdout?.trim()) stdout = JSON.parse(r.stdout);
  } catch {
    /* not JSON — keep raw */
  }
  const ok = r.status === 0;
  const result: JobResult = { ok, cmd: job.cmd, args, status: r.status, stdout };
  if (!ok && r.stderr) result.stderr = r.stderr.trim();
  return result;
}

function writeResult(r: JobResult): void {
  process.stdout.write(`${JSON.stringify(r)}\n`);
}
