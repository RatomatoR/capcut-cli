import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { loadDraft } from "./helpers/load-fixture.mjs";
import { spawnCli } from "./helpers/spawn-cli.mjs";
import { tmpDraft } from "./helpers/tmp-draft.mjs";

const ASS_SAMPLE = `[Script Info]
Title: Test
ScriptType: v4.00+

[V4+ Styles]
Format: Name, Fontname, Fontsize
Style: Default,Arial,18

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:01.00,0:00:04.50,Default,,0,0,0,,Hello world
Dialogue: 0,0:00:05.00,0:00:08.25,Default,,0,0,0,,{\\b1\\an8}Bold up\\NSecond line
Dialogue: 0,0:00:10.00,0:00:12.00,Default,,0,0,0,,Comma, in text, works
`;

describe("capcut import-ass", () => {
  const fix = tmpDraft();
  let assPath;
  let dir;
  before(() => {
    dir = mkdtempSync(join(tmpdir(), "ass-"));
    assPath = join(dir, "sample.ass");
    writeFileSync(assPath, ASS_SAMPLE);
  });
  after(() => {
    fix.cleanup();
    rmSync(dir, { recursive: true, force: true });
  });

  it("imports each Dialogue: as a text segment with correct timing", () => {
    const before = (spawnCli(["texts", fix.path]).json ?? []).length;
    const r = spawnCli(["import-ass", fix.path, assPath]);
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    assert.equal(r.json.ok, true);
    assert.equal(r.json.format, "ass");
    assert.equal(r.json.cues, 3);
    assert.equal(r.json.first.start_us, 1_000_000);
    assert.equal(r.json.first.duration_us, 3_500_000);

    const after = (spawnCli(["texts", fix.path]).json ?? []).length;
    assert.equal(after, before + 3);
  });

  it("strips override codes and preserves comma-containing text", () => {
    const draft = loadDraft(fix.path);
    // Find the cue text in the materials.texts content blobs
    const allText = draft.materials.texts
      .map((t) => {
        try {
          return JSON.parse(t.content).text ?? "";
        } catch {
          return "";
        }
      })
      .join("\n");
    assert.match(allText, /Bold up/);
    assert.ok(!allText.includes("{\\b1"), "override codes stripped");
    assert.match(allText, /Comma, in text, works/);
  });

  it("respects --time-offset", () => {
    const fix2 = tmpDraft();
    try {
      const r = spawnCli(["import-ass", fix2.path, assPath, "--time-offset", "0.5s"]);
      assert.equal(r.status, 0, `stderr: ${r.stderr}`);
      assert.equal(r.json.first.start_us, 1_500_000);
    } finally {
      fix2.cleanup();
    }
  });

  it("rejects empty files with a clear error", () => {
    const empty = join(dir, "empty.ass");
    writeFileSync(empty, "");
    const r = spawnCli(["import-ass", fix.path, empty]);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /0 cues|empty/i);
  });
});
