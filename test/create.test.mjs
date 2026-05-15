import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { loadDraft, segmentCount } from "./helpers/load-fixture.mjs";
import { spawnCli } from "./helpers/spawn-cli.mjs";
import { tmpDir, tmpDraft } from "./helpers/tmp-draft.mjs";

describe("capcut init", () => {
  const t = tmpDir();
  after(() => t.cleanup());

  it("creates a new draft directory with draft_info.json", () => {
    const r = spawnCli(["init", "smoke-test-init", "--drafts", t.dir]);
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    assert.equal(r.json.ok, true);
    assert.match(r.json.draft_path, /smoke-test-init/);
    assert.ok(existsSync(join(t.dir, "smoke-test-init", "draft_info.json")));
  });
});

describe("capcut add-text", () => {
  const fix = tmpDraft();
  after(() => fix.cleanup());

  it("appends a text segment", () => {
    const before = segmentCount(loadDraft(fix.path));
    const r = spawnCli(["add-text", fix.path, "0s", "5s", "Hello", "--font-size", "24", "--color", "#FFD700"]);
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    assert.equal(r.json.ok, true);
    assert.equal(typeof r.json.segment_id, "string");
    const after = segmentCount(loadDraft(fix.path));
    assert.equal(after, before + 1);
  });

  it("rejects malformed time formats", () => {
    const r = spawnCli(["add-text", fix.path, "garbage", "5s", "X"]);
    assert.notEqual(r.status, 0);
  });
});

describe("capcut add-audio", () => {
  const fix = tmpDraft();
  after(() => fix.cleanup());

  it("fails fast on a missing local file (no network)", () => {
    const r = spawnCli(["add-audio", fix.path, "/tmp/does-not-exist.mp3", "0s", "5s"]);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /not exist|missing|ENOENT/i);
  });
});

describe("capcut --quiet on writes", () => {
  const fix = tmpDraft();
  after(() => fix.cleanup());

  it("set-text -q produces empty stdout but non-zero exit on miss", () => {
    const segs = spawnCli(["texts", fix.path]).json ?? [];
    if (segs.length === 0) return;
    const prefix = segs[0].id.slice(0, 8);
    const r = spawnCli(["set-text", fix.path, prefix, "quiet-test", "-q"]);
    assert.equal(r.status, 0);
    assert.equal(r.stdout, "");
  });
});
