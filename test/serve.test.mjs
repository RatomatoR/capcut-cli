import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { spawnCli } from "./helpers/spawn-cli.mjs";
import { tmpDraft } from "./helpers/tmp-draft.mjs";

describe("capcut serve", () => {
  const fix = tmpDraft();
  after(() => fix.cleanup());

  it("dispatches a single JSONL job via stdin and emits one result", () => {
    const job = `${JSON.stringify({ cmd: "info", project: fix.path })}\n`;
    const r = spawnCli(["serve"], { input: job });
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    // First stdout line is the per-job result, summary is on stderr
    const firstLine = r.stdout.split("\n").find((l) => l.trim().length > 0);
    const parsed = JSON.parse(firstLine);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.cmd, "info");
    assert.ok(parsed.stdout);
    assert.equal(typeof parsed.stdout.duration_us, "number");
  });

  it("emits a summary line on stderr after the queue drains", () => {
    const job = `${JSON.stringify({ cmd: "info", project: fix.path })}\n`;
    const r = spawnCli(["serve"], { input: job });
    const summaryLine = r.stderr.split("\n").find((l) => /"summary"/.test(l));
    const parsed = JSON.parse(summaryLine);
    assert.equal(parsed.summary.succeeded, 1);
    assert.equal(parsed.summary.failed, 0);
  });

  it("flags invalid JSON lines as failures and continues", () => {
    const input = `this is not json\n${JSON.stringify({ cmd: "info", project: fix.path })}\n`;
    const r = spawnCli(["serve"], { input });
    const lines = r.stdout.split("\n").filter((l) => l.trim().length > 0);
    assert.equal(lines.length, 2);
    const first = JSON.parse(lines[0]);
    const second = JSON.parse(lines[1]);
    assert.equal(first.ok, false);
    assert.match(first.stderr, /JSON parse error/);
    assert.equal(second.ok, true);
  });
});
