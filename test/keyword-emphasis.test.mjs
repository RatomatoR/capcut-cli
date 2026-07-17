import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { buildEmphasisRanges, findKeywordRanges } from "../dist/decorators.js";
import { loadDraft } from "./helpers/load-fixture.mjs";
import { spawnCli } from "./helpers/spawn-cli.mjs";
import { tmpDraft } from "./helpers/tmp-draft.mjs";

// Executable shebang stubs don't spawn on Windows; the caption e2e cases that
// fake the whisper binary are POSIX-only. Everything else runs everywhere.
const isWindows = process.platform === "win32";

const GOLD = [1, 215 / 255, 0]; // #FFD700 — the caption --karaoke gold
const RED = [1, 0, 0];
const GREEN = [0, 1, 0];

/** UTF-16LE byte offset of code-unit index `n` in `text` — the draft's range unit. */
const bytes = (text, n) => Buffer.from(text.slice(0, n), "utf16le").length;

function textTrack(draft, name) {
  return draft.tracks.find((t) => t.type === "text" && t.name === name);
}

function materialContent(draft, segment) {
  const mat = draft.materials.texts.find((m) => m.id === segment.material_id);
  assert.ok(mat, `text material ${segment.material_id} missing`);
  return JSON.parse(mat.content);
}

function fillColor(style) {
  return style.fill.content.solid.color;
}

describe("keyword emphasis — range engine (unit)", () => {
  it("finds case-insensitive whole-word matches in code units", () => {
    const text = "the WORLD says hello";
    assert.deepEqual(findKeywordRanges(text, ["hello", "world"]), [
      { start: 4, end: 9 },
      { start: 15, end: 20 },
    ]);
    // whole-word: "cap" must not match inside "capcut"
    assert.deepEqual(findKeywordRanges("capcut cap", ["cap"]), [{ start: 7, end: 10 }]);
  });

  it("keeps the earlier match when keywords overlap (New York vs York)", () => {
    const ranges = findKeywordRanges("in New York today", ["New York", "York"]);
    assert.deepEqual(ranges, [{ start: 3, end: 11 }]);
  });

  it("drops an overlapped karaoke range but carries its bold onto the keyword", () => {
    const text = "go capcut now";
    const karaoke = { start: 3, end: 9, font_color: "#FFD700", font_size: 16.2, bold: true };
    const { ranges, matches } = buildEmphasisRanges(text, {
      words: ["capcut"],
      color: "#FF0000",
      sizeMultiplier: 2,
      baseSize: 15,
      baseColor: "#FFFFFF",
      presetRanges: [karaoke],
    });
    assert.equal(matches, 1);
    // explicit base gaps + the keyword range that replaced the karaoke block
    assert.deepEqual(
      ranges.map((r) => [r.start, r.end]),
      [
        [0, 3],
        [3, 9],
        [9, 13],
      ],
    );
    assert.equal(ranges[1].font_color, "#FF0000");
    assert.equal(ranges[1].font_size, 30);
    assert.equal(ranges[1].bold, true);
  });
});

describe("import-srt --highlight-words", () => {
  const fix = tmpDraft();
  after(() => fix.cleanup());

  const srt = [
    "1\n00:00:00,000 --> 00:00:02,000\nhello brave world\n",
    "2\n00:00:02,000 --> 00:00:04,000\nthe WORLD says hello\n",
    "3\n00:00:04,000 --> 00:00:06,000\nno match here\n",
  ].join("\n");

  it("styles single and multiple matches per cue at the byte offsets setTextRanges uses", () => {
    const r = spawnCli(["import-srt", fix.path, "-", "--highlight-words", "hello,world"], { input: srt });
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    assert.equal(r.json.cues, 3);
    assert.equal(r.json.keyword_matches, 4);

    const draft = loadDraft(fix.path);
    const segs = textTrack(draft, "subtitle").segments;
    assert.equal(segs.length, 3);

    // cue 1: "hello" [0,5) + "world" [12,17) with an inherited gap between
    const c1 = materialContent(draft, segs[0]);
    assert.equal(c1.styles.length, 3);
    assert.deepEqual(c1.styles[0].range, [bytes(c1.text, 0), bytes(c1.text, 5)]);
    assert.deepEqual(c1.styles[2].range, [bytes(c1.text, 12), bytes(c1.text, 17)]);
    assert.deepEqual(fillColor(c1.styles[0]), GOLD); // default --keyword-color
    assert.equal(c1.styles[0].size, 15 * 1.2); // default --keyword-size on base 15
    assert.equal(c1.styles[1].size, 15); // gap keeps the base size

    // cue 2: case-insensitive "WORLD" [4,9) and "hello" [15,20)
    const c2 = materialContent(draft, segs[1]);
    const emphasized = c2.styles.filter((s) => s.size === 18);
    assert.deepEqual(
      emphasized.map((s) => s.range),
      [
        [bytes(c2.text, 4), bytes(c2.text, 9)],
        [bytes(c2.text, 15), bytes(c2.text, 20)],
      ],
    );

    // cue 3: no match — stays a single uniform style block
    const c3 = materialContent(draft, segs[2]);
    assert.equal(c3.styles.length, 1);
  });
});

describe("import-srt --highlight-words — multibyte offsets", () => {
  const fix = tmpDraft();
  after(() => fix.cleanup());

  const srt = [
    "1\n00:00:00,000 --> 00:00:02,000\nGrüße für alle\n",
    "2\n00:00:02,000 --> 00:00:04,000\n你好 世界\n",
    "3\n00:00:04,000 --> 00:00:06,000\nfürs Leben\n",
  ].join("\n");

  it("computes UTF-16LE byte ranges for umlaut and CJK text", () => {
    const r = spawnCli(["import-srt", fix.path, "-", "--highlight-words", "für,世界"], { input: srt });
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    assert.equal(r.json.keyword_matches, 2);

    const draft = loadDraft(fix.path);
    const segs = textTrack(draft, "subtitle").segments;

    const c1 = materialContent(draft, segs[0]); // "Grüße für alle" — "für" at units [6,9)
    const hit1 = c1.styles.find((s) => s.size === 18);
    assert.deepEqual(hit1.range, [12, 18]);
    assert.deepEqual(hit1.range, [bytes(c1.text, 6), bytes(c1.text, 9)]);

    const c2 = materialContent(draft, segs[1]); // "你好 世界" — "世界" at units [3,5)
    const hit2 = c2.styles.find((s) => s.size === 18);
    assert.deepEqual(hit2.range, [6, 10]);

    // "für" must NOT match inside "fürs" (Unicode-aware word boundary)
    const c3 = materialContent(draft, segs[2]);
    assert.equal(c3.styles.length, 1);
  });
});

describe("import-srt keyword flags — size math, @file, validation", () => {
  const srt = "1\n00:00:00,000 --> 00:00:02,000\nhello brave world\n";

  it("applies --keyword-size as a multiplier on the cue's base font size", (t) => {
    const fix = tmpDraft();
    t.after(() => fix.cleanup());
    const r = spawnCli(
      ["import-srt", fix.path, "-", "--font-size", "20", "--highlight-words", "hello", "--keyword-size", "2"],
      { input: srt },
    );
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    const draft = loadDraft(fix.path);
    const c = materialContent(draft, textTrack(draft, "subtitle").segments[0]);
    assert.equal(c.styles[0].size, 40);
    assert.equal(c.styles[1].size, 20); // unmatched text keeps the base size
  });

  it("reads @file word lists (one word/phrase per line, phrases match)", (t) => {
    const fix = tmpDraft();
    t.after(() => fix.cleanup());
    const wordsFile = join(fix.dir, "words.txt");
    writeFileSync(wordsFile, "brave world\n\n  hello  \n");
    const r = spawnCli(["import-srt", fix.path, "-", "--highlight-words", `@${wordsFile}`], { input: srt });
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    assert.equal(r.json.keyword_matches, 2);
    const draft = loadDraft(fix.path);
    const c = materialContent(draft, textTrack(draft, "subtitle").segments[0]);
    const phrase = c.styles.find((s) => s.range[0] === bytes(c.text, 6));
    assert.deepEqual(phrase.range, [bytes(c.text, 6), bytes(c.text, 17)]); // "brave world"
  });

  it("rejects a non-positive, oversized, or malformed emphasis flag", (t) => {
    const fix = tmpDraft();
    t.after(() => fix.cleanup());
    const zero = spawnCli(["import-srt", fix.path, "-", "--highlight-words", "x", "--keyword-size", "0"], {
      input: srt,
    });
    assert.notEqual(zero.status, 0);
    assert.match(zero.stderr, /--keyword-size must be a multiplier > 0/);
    const huge = spawnCli(["import-srt", fix.path, "-", "--highlight-words", "x", "--keyword-size", "11"], {
      input: srt,
    });
    assert.notEqual(huge.status, 0);
    const color = spawnCli(["import-srt", fix.path, "-", "--highlight-words", "x", "--keyword-color", "gold"], {
      input: srt,
    });
    assert.notEqual(color.status, 0);
    assert.match(color.stderr, /--keyword-color must be #RRGGBB/);
  });

  it("rejects --keyword-color / --keyword-size without --highlight-words", (t) => {
    const fix = tmpDraft();
    t.after(() => fix.cleanup());
    const r = spawnCli(["import-srt", fix.path, "-", "--keyword-color", "#FF0000"], { input: srt });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /--keyword-color requires --highlight-words/);
  });

  it("no emphasis flags -> no new output keys (unchanged contract)", (t) => {
    const fix = tmpDraft();
    t.after(() => fix.cleanup());
    const r = spawnCli(["import-srt", fix.path, "-"], { input: srt });
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    assert.ok(!("keyword_matches" in r.json));
    assert.ok(!("color_cycle" in r.json));
  });
});

describe("import-srt --color-cycle", () => {
  const srt = [
    "1\n00:00:00,000 --> 00:00:01,000\none\n",
    "2\n00:00:01,000 --> 00:00:02,000\ntwo\n",
    "3\n00:00:02,000 --> 00:00:03,000\nthree\n",
    "4\n00:00:03,000 --> 00:00:04,000\nfour hello\n",
  ].join("\n");

  it("rotates the base colour per cue in list order and wins over --color", (t) => {
    const fix = tmpDraft();
    t.after(() => fix.cleanup());
    const r = spawnCli(
      ["import-srt", fix.path, "-", "--color", "#123456", "--color-cycle", "#FF0000,#00FF00,#0000FF"],
      { input: srt },
    );
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    assert.equal(r.json.color_cycle, 3);
    const draft = loadDraft(fix.path);
    const segs = textTrack(draft, "subtitle").segments;
    const colors = segs.map((s) => draft.materials.texts.find((m) => m.id === s.material_id).text_color);
    assert.deepEqual(colors, ["#FF0000", "#00FF00", "#0000FF", "#FF0000"]); // 4th cue wraps around
    assert.deepEqual(fillColor(materialContent(draft, segs[1]).styles[0]), GREEN);
  });

  it("keyword emphasis stacks on top of the cycled base colour (independent axes)", (t) => {
    const fix = tmpDraft();
    t.after(() => fix.cleanup());
    const r = spawnCli(
      ["import-srt", fix.path, "-", "--color-cycle", "#FF0000,#00FF00", "--highlight-words", "hello"],
      { input: srt },
    );
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    const draft = loadDraft(fix.path);
    const segs = textTrack(draft, "subtitle").segments;
    const c4 = materialContent(draft, segs[3]); // "four hello", cycle index 3 -> #00FF00 base
    assert.deepEqual(fillColor(c4.styles[0]), GREEN); // unmatched text keeps the cycled base
    const hit = c4.styles.find((s) => s.size === 18);
    assert.deepEqual(hit.range, [bytes(c4.text, 5), bytes(c4.text, 10)]);
    assert.deepEqual(fillColor(hit), GOLD);
    const invalid = spawnCli(["import-srt", fix.path, "-", "--color-cycle", "red,blue"], { input: srt });
    assert.notEqual(invalid.status, 0);
    assert.match(invalid.stderr, /--color-cycle entries must be #RRGGBB/);
  });
});

describe("flag scoping — emphasis flags stay literal text on commands that don't declare them", () => {
  const fix = tmpDraft();
  after(() => fix.cleanup());

  it("add-text preserves every emphasis flag token verbatim", () => {
    const words = ["say", "--highlight-words", "gold", "--keyword-size", "2", "--color-cycle", "#FF0000", "end"];
    const r = spawnCli(["add-text", fix.path, "0s", "2s", ...words]);
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    assert.equal(r.json.text, words.join(" "));
  });
});

// --- caption path: fake whisper binary (POSIX only) ---

function makeWhisperStub(dir) {
  const stub = join(dir, "fake-openai-whisper");
  const transcript = {
    segments: [
      {
        start: 0,
        end: 2,
        text: "go capcut now",
        words: [
          { word: "go", start: 0, end: 0.5 },
          { word: "capcut", start: 0.5, end: 1.2 },
          { word: "now", start: 1.2, end: 2 },
        ],
      },
    ],
  };
  const srt = [
    "1\n00:00:00,000 --> 00:00:02,000\nsay hello now\n",
    "2\n00:00:02,000 --> 00:00:04,000\nsecond cue text\n",
    "3\n00:00:04,000 --> 00:00:06,000\nthird cue here\n",
  ].join("\n");
  writeFileSync(
    stub,
    `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const args = process.argv.slice(2);
const dir = args[args.indexOf("--output_dir") + 1];
const format = args[args.indexOf("--output_format") + 1];
if (format === "json") {
  fs.writeFileSync(path.join(dir, "transcript.json"), ${JSON.stringify(JSON.stringify(transcript))});
} else {
  fs.writeFileSync(path.join(dir, "transcript.srt"), ${JSON.stringify(srt)});
}
`,
  );
  chmodSync(stub, 0o755);
  const audio = join(dir, "dummy.wav");
  writeFileSync(audio, "RIFF");
  return { stub, audio };
}

describe("caption --karaoke + --highlight-words interplay", { skip: isWindows }, () => {
  const fix = tmpDraft();
  const dir = mkdtempSync(join(tmpdir(), "capcut-whisper-stub-"));
  after(() => {
    fix.cleanup();
    rmSync(dir, { recursive: true, force: true });
  });

  it("builds karaoke ranges first; keyword matches override those words", () => {
    const { stub, audio } = makeWhisperStub(dir);
    const r = spawnCli([
      "caption",
      fix.path,
      "--audio",
      audio,
      "--whisper-cmd",
      stub,
      "--karaoke",
      "--highlight-words",
      "capcut",
      "--keyword-color",
      "#FF0000",
    ]);
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    assert.equal(r.json.karaoke, true);
    assert.equal(r.json.cues, 3); // one word-timed segment per word
    assert.equal(r.json.keyword_matches, 1);

    const draft = loadDraft(fix.path);
    const segs = textTrack(draft, "captions").segments;
    assert.equal(segs.length, 3);
    const text = "go capcut now";
    const kwRange = [bytes(text, 3), bytes(text, 9)];

    // active word "go": gold karaoke range AND the red keyword range coexist
    const c1 = materialContent(draft, segs[0]);
    const gold1 = c1.styles.find((s) => s.bold === true);
    assert.deepEqual(gold1.range, [bytes(text, 0), bytes(text, 2)]);
    assert.deepEqual(fillColor(gold1), GOLD);
    assert.equal(gold1.size, 15 * 1.08);
    const kw1 = c1.styles.find((s) => s.range[0] === kwRange[0]);
    assert.deepEqual(kw1.range, kwRange);
    assert.deepEqual(fillColor(kw1), RED);
    assert.equal(kw1.size, 18);
    assert.equal(kw1.bold, false); // not the active word — no karaoke bold to inherit

    // active word "capcut": the keyword overrides the karaoke word's colour/size,
    // inheriting its bold
    const c2 = materialContent(draft, segs[1]);
    const kw2 = c2.styles.find((s) => s.range[0] === kwRange[0]);
    assert.deepEqual(kw2.range, kwRange);
    assert.deepEqual(fillColor(kw2), RED);
    assert.equal(kw2.size, 18); // keyword size, not the 1.08 karaoke bump
    assert.equal(kw2.bold, true);
    assert.ok(!c2.styles.some((s) => JSON.stringify(fillColor(s)) === JSON.stringify(GOLD)));
  });
});

describe("caption --color-cycle + --highlight-words (plain cues)", { skip: isWindows }, () => {
  const fix = tmpDraft();
  const dir = mkdtempSync(join(tmpdir(), "capcut-whisper-stub-"));
  after(() => {
    fix.cleanup();
    rmSync(dir, { recursive: true, force: true });
  });

  it("cycles the base colour per cue and emphasizes matches on top", () => {
    const { stub, audio } = makeWhisperStub(dir);
    const r = spawnCli([
      "caption",
      fix.path,
      "--audio",
      audio,
      "--whisper-cmd",
      stub,
      "--color-cycle",
      "#FF0000,#00FF00,#0000FF",
      "--highlight-words",
      "hello",
    ]);
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    assert.equal(r.json.cues, 3);
    assert.equal(r.json.color_cycle, 3);
    assert.equal(r.json.keyword_matches, 1);

    const draft = loadDraft(fix.path);
    const segs = textTrack(draft, "captions").segments;
    const colors = segs.map((s) => draft.materials.texts.find((m) => m.id === s.material_id).text_color);
    assert.deepEqual(colors, ["#FF0000", "#00FF00", "#0000FF"]);

    // cue 1 "say hello now": emphasis range plus explicit base-coloured gaps
    const c1 = materialContent(draft, segs[0]);
    const hit = c1.styles.find((s) => s.size === 18);
    assert.deepEqual(hit.range, [bytes(c1.text, 4), bytes(c1.text, 9)]);
    assert.deepEqual(fillColor(hit), GOLD);
    assert.deepEqual(fillColor(c1.styles[0]), RED); // gap keeps the cue's cycled base

    // cue 2 has no match and keeps its single uniform style
    const c2 = materialContent(draft, segs[1]);
    assert.equal(c2.styles.length, 1);
    assert.equal(c2.styles[0].font_color, "#00FF00");
  });
});
