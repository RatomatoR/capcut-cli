import assert from "node:assert/strict";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { parseSrt } from "../dist/srt.js";
import { spawnCli } from "./helpers/spawn-cli.mjs";
import { tmpDir } from "./helpers/tmp-draft.mjs";

function initDraft(dir, name) {
  const r = spawnCli(["init", name, "--drafts", dir]);
  assert.equal(r.status, 0, `stderr: ${r.stderr}`);
  return join(dir, name);
}

function addText(project, start, duration, text) {
  const r = spawnCli(["add-text", project, start, duration, text]);
  assert.equal(r.status, 0, `stderr: ${r.stderr}`);
  return r.json.segment_id;
}

describe("export-srt — line granularity (default)", () => {
  const t = tmpDir();
  after(() => t.cleanup());

  let project;
  before(() => {
    project = initDraft(t.dir, "phrases");
    const srt = "1\n00:00:01,000 --> 00:00:04,000\nhello brave world\n\n2\n00:00:05,000 --> 00:00:06,000\nbye\n";
    const r = spawnCli(["import-srt", project, "-"], { input: srt });
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
  });

  it("emits phrase-level SRT and round-trips through parseSrt", () => {
    const r = spawnCli(["export-srt", project]);
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    assert.match(r.stdout, /00:00:01,000 --> 00:00:04,000/);
    const cues = parseSrt(r.stdout);
    assert.equal(cues.length, 2);
    assert.equal(cues[0].text, "hello brave world");
    assert.equal(cues[0].startUs, 1_000_000);
    assert.equal(cues[0].endUs, 4_000_000);
  });

  it("--format vtt emits a WEBVTT header with dot milliseconds", () => {
    const r = spawnCli(["export-srt", project, "--format", "vtt"]);
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    assert.match(r.stdout, /^WEBVTT\n\n/);
    assert.match(r.stdout, /00:00:01\.000 --> 00:00:04\.000\nhello brave world/);
    assert.doesNotMatch(r.stdout, /,\d{3}/);
  });

  it("--granularity word interpolates cue timings by word length", () => {
    const r = spawnCli(["export-srt", project, "--granularity", "word"]);
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    // hello/brave/world are 5 chars each: the 3s cue splits into equal thirds.
    const cues = parseSrt(r.stdout);
    assert.equal(cues.length, 4);
    assert.deepEqual(
      cues.map((c) => c.text),
      ["hello", "brave", "world", "bye"],
    );
    assert.equal(cues[0].startUs, 1_000_000);
    assert.equal(cues[0].endUs, 2_000_000);
    assert.equal(cues[1].startUs, 2_000_000);
    assert.equal(cues[2].endUs, 4_000_000);
  });
});

describe("export-srt — karaoke word timings", () => {
  const t = tmpDir();
  after(() => t.cleanup());

  let project;
  before(() => {
    // Rebuild what `caption --karaoke` writes (src/caption.ts): one
    // full-phrase segment per word, word-timed, that word's range highlighted.
    project = initDraft(t.dir, "karaoke");
    const words = [
      ["1s", "0.4s", 0, 3],
      ["1.4s", "0.4s", 4, 7],
      ["1.8s", "0.7s", 8, 13],
    ];
    for (const [start, duration, from, to] of words) {
      const id = addText(project, start, duration, "one two three");
      const styles = JSON.stringify([{ start: from, end: to, font_color: "#FFD700", bold: true }]);
      const r = spawnCli(["text-ranges", project, id, "--styles", styles]);
      assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    }
  });

  it("exports the stored word timings as one SRT cue per word", () => {
    const r = spawnCli(["export-srt", project, "--granularity", "word"]);
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    const cues = parseSrt(r.stdout);
    assert.deepEqual(
      cues.map((c) => c.text),
      ["one", "two", "three"],
    );
    // Real stored timings, not length-weighted interpolation.
    assert.equal(cues[1].startUs, 1_400_000);
    assert.equal(cues[1].endUs, 1_800_000);
    assert.equal(cues[2].endUs, 2_500_000);
  });

  it("emits one VTT cue per phrase with inline word timestamps", () => {
    const r = spawnCli(["export-srt", project, "--granularity", "word", "--format", "vtt"]);
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    assert.match(r.stdout, /^WEBVTT\n\n/);
    assert.match(r.stdout, /00:00:01\.000 --> 00:00:02\.500\none <00:00:01\.400>two <00:00:01\.800>three/);
  });

  it("keeps line granularity as-is: one cue per stored segment", () => {
    const r = spawnCli(["export-srt", project]);
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    const cues = parseSrt(r.stdout);
    assert.equal(cues.length, 3);
    for (const cue of cues) assert.equal(cue.text, "one two three");
  });
});

describe("export-srt — flag validation and empty drafts", () => {
  const t = tmpDir();
  after(() => t.cleanup());

  it("rejects unknown --granularity and --format values", () => {
    const badGranularity = spawnCli(["export-srt", "unused", "--granularity", "sentence"]);
    assert.notEqual(badGranularity.status, 0);
    assert.match(badGranularity.stderr, /--granularity must be line\|word/);
    const badFormat = spawnCli(["export-srt", "unused", "--format", "ass"]);
    assert.notEqual(badFormat.status, 0);
    assert.match(badFormat.stderr, /--format must be srt\|vtt/);
  });

  it("succeeds with empty output when the draft has no text track", () => {
    const project = initDraft(t.dir, "no-text");
    const srt = spawnCli(["export-srt", project, "--granularity", "word"]);
    assert.equal(srt.status, 0, `stderr: ${srt.stderr}`);
    assert.equal(srt.stdout, "");
    const vtt = spawnCli(["export-srt", project, "--format", "vtt"]);
    assert.equal(vtt.status, 0, `stderr: ${vtt.stderr}`);
    assert.equal(vtt.stdout, "WEBVTT\n\n");
  });
});
