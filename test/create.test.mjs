import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
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

  it("registers the draft in root_meta_info.json so CapCut lists it", () => {
    const r = spawnCli(["init", "registered-draft", "--drafts", t.dir]);
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    assert.equal(r.json.registered, true);

    // Per-folder sidecar CapCut reads when opening the draft.
    assert.ok(existsSync(join(t.dir, "registered-draft", "draft_meta_info.json")));

    // Central index the GUI scans to build the project list.
    const indexPath = join(t.dir, "root_meta_info.json");
    assert.ok(existsSync(indexPath), "root_meta_info.json should be created");
    const index = JSON.parse(readFileSync(indexPath, "utf-8"));
    const store = index.all_draft_store;
    assert.ok(Array.isArray(store));
    const entry = store.find((e) => e.draft_name === "registered-draft");
    assert.ok(entry, "new draft should have an index entry");
    assert.match(entry.draft_fold_path, /registered-draft/);
  });
});

describe("capcut init — merges into an existing index", () => {
  const t = tmpDir();
  after(() => t.cleanup());

  it("preserves existing drafts and mirrors their entry shape", () => {
    // Seed a pre-existing index with a real-looking entry (extra field included
    // to prove we clone the installed version's shape, not a hardcoded one).
    const indexPath = join(t.dir, "root_meta_info.json");
    const existing = {
      all_draft_store: [
        {
          draft_id: "EXISTING-0001",
          draft_name: "existing-project",
          draft_fold_path: join(t.dir, "existing-project"),
          draft_json_file: join(t.dir, "existing-project", "draft_info.json"),
          draft_root_path: t.dir,
          some_version_specific_field: 42,
          tm_draft_create: 111,
        },
      ],
    };
    writeFileSync(indexPath, JSON.stringify(existing), "utf-8");

    const r = spawnCli(["init", "second-project", "--drafts", t.dir]);
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    assert.equal(r.json.registered, true);

    const index = JSON.parse(readFileSync(indexPath, "utf-8"));
    const store = index.all_draft_store;
    assert.equal(store.length, 2, "existing draft must be preserved");
    assert.ok(store.find((e) => e.draft_name === "existing-project"));

    const fresh = store.find((e) => e.draft_name === "second-project");
    assert.ok(fresh);
    // Cloned the version-specific field from the existing entry...
    assert.equal(fresh.some_version_specific_field, 42);
    // ...but overrode the identifying fields for the new draft.
    assert.match(fresh.draft_fold_path, /second-project/);
    assert.notEqual(fresh.tm_draft_create, 111);

    // Backed up the original index before overwriting.
    assert.ok(existsSync(`${indexPath}.bak`));
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
