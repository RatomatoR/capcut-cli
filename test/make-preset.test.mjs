import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { loadDraft } from "./helpers/load-fixture.mjs";
import { spawnCli } from "./helpers/spawn-cli.mjs";
import { tmpDir, tmpDraft } from "./helpers/tmp-draft.mjs";

describe("capcut make-preset + add-text --preset roundtrip", () => {
  const src = tmpDraft();
  const out = tmpDir();
  after(() => {
    src.cleanup();
    out.cleanup();
  });

  it("styling extracted from a segment recreates itself in a fresh draft", () => {
    // 1. Style a text segment through CLI flags only.
    const added = spawnCli([
      "add-text",
      src.path,
      "1s",
      "3s",
      "styled caption",
      "--font-size",
      "24",
      "--color",
      "#FF3300",
      "--align",
      "2",
      "--x",
      "0.1",
      "--y",
      "-0.55",
    ]);
    assert.equal(added.status, 0, `stderr: ${added.stderr}`);
    const segId = added.json.segment_id;
    const styled = spawnCli([
      "text-style",
      src.path,
      segId,
      "--alpha",
      "0.9",
      "--shadow",
      "--shadow-color",
      "#00FF00",
      "--shadow-distance",
      "8",
      "--border-width",
      "20",
      "--border-color",
      "#0000FF",
      "--bg-color",
      "#112233",
      "--bg-alpha",
      "0.8",
    ]);
    assert.equal(styled.status, 0, `stderr: ${styled.stderr}`);
    const bubbled = spawnCli(["bubble-text", src.path, segId, "--bubble", "cloud"]);
    assert.equal(bubbled.status, 0, `stderr: ${bubbled.stderr}`);

    // 2. Extract the preset.
    const presetPath = join(out.dir, "style.json");
    const made = spawnCli(["make-preset", src.path, segId, "--out", presetPath]);
    assert.equal(made.status, 0, `stderr: ${made.stderr}`);
    assert.equal(made.json.ok, true);
    assert.ok(existsSync(presetPath));
    const preset = JSON.parse(readFileSync(presetPath, "utf-8"));
    assert.equal(preset.capcutCliPreset, 1);
    assert.equal(preset.style.font_size, 24);
    assert.equal(preset.style.text_color, "#FF3300");
    assert.equal(preset.style.shadow_color, "#00FF00");
    assert.deepEqual(preset.transform, { x: 0.1, y: -0.55 });
    assert.equal(preset.bubble.effect_id, "7137269184932778510");

    // 3. Apply into a fresh draft, then re-extract: a true roundtrip.
    const dst = tmpDraft();
    try {
      const applied = spawnCli(["add-text", dst.path, "0s", "2s", "new text", "--preset", presetPath]);
      assert.equal(applied.status, 0, `stderr: ${applied.stderr}`);
      assert.equal(applied.json.ok, true);

      const roundtripPath = join(out.dir, "roundtrip.json");
      const remade = spawnCli(["make-preset", dst.path, applied.json.segment_id, "--out", roundtripPath]);
      assert.equal(remade.status, 0, `stderr: ${remade.stderr}`);
      assert.deepEqual(JSON.parse(readFileSync(roundtripPath, "utf-8")), preset);

      // The styling landed on the draft itself, not just the preset file.
      const draft = loadDraft(dst.path);
      const mat = draft.materials.texts.find((t) => t.id === applied.json.material_id);
      assert.equal(mat.text_color, "#FF3300");
      assert.equal(mat.font_size, 24);
      assert.equal(mat.shadow_color, "#00FF00");
      assert.equal(mat.border_width, 20);
      assert.equal(mat.background_color, "#112233");
      assert.equal(mat.bubble_effect_id, "7137269184932778510");
      const content = JSON.parse(mat.content);
      assert.equal(content.text, "new text");
      assert.equal(content.styles[0].size, 24);
    } finally {
      dst.cleanup();
    }
  });
});

describe("--preset precedence and validation", () => {
  const fix = tmpDraft();
  const out = tmpDir();
  const presetPath = join(out.dir, "preset.json");
  writeFileSync(
    presetPath,
    JSON.stringify({
      capcutCliPreset: 1,
      style: {
        font_size: 24,
        text_color: "#FF3300",
        has_border: true,
        border_width: 20,
        border_color: "#0000FF",
        border_alpha: 1,
      },
      transform: { x: 0.1, y: -0.55 },
    }),
  );
  after(() => {
    fix.cleanup();
    out.cleanup();
  });

  it("add-text: explicit flags beat preset values", () => {
    const r = spawnCli([
      "add-text",
      fix.path,
      "0s",
      "2s",
      "flag wins",
      "--preset",
      presetPath,
      "--color",
      "#00CCFF",
      "--y",
      "0.3",
    ]);
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    const draft = loadDraft(fix.path);
    const mat = draft.materials.texts.find((t) => t.id === r.json.material_id);
    assert.equal(mat.text_color, "#00CCFF", "flag overrides preset color");
    assert.equal(mat.font_size, 24, "unflagged fields still come from the preset");
    assert.equal(mat.border_width, 20);
    const seg = draft.tracks.flatMap((t) => t.segments).find((s) => s.id === r.json.segment_id);
    assert.deepEqual(seg.clip.transform, { x: 0.1, y: 0.3 }, "flagged y wins, preset x kept");
  });

  it("text-style: explicit flags beat preset values", () => {
    const added = spawnCli(["add-text", fix.path, "3s", "2s", "restyle me"]);
    assert.equal(added.status, 0, `stderr: ${added.stderr}`);
    const r = spawnCli(["text-style", fix.path, added.json.segment_id, "--preset", presetPath, "--border-width", "5"]);
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    const draft = loadDraft(fix.path);
    const mat = draft.materials.texts.find((t) => t.id === added.json.material_id);
    assert.equal(mat.border_width, 5, "flag overrides preset border width");
    assert.equal(mat.border_color, "#0000FF", "unflagged fields still come from the preset");
    assert.equal(mat.text_color, "#FF3300");
  });

  it("text-style accepts --preset with no styling flags", () => {
    const added = spawnCli(["add-text", fix.path, "6s", "2s", "preset only"]);
    assert.equal(added.status, 0, `stderr: ${added.stderr}`);
    const r = spawnCli(["text-style", fix.path, added.json.segment_id, "--preset", presetPath]);
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    assert.ok(r.json.applied.includes("style"));
  });

  it("rejects a missing preset file", () => {
    const r = spawnCli(["add-text", fix.path, "0s", "2s", "x", "--preset", join(out.dir, "nope.json")]);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /not found/i);
  });

  it("rejects a preset that is not valid JSON", () => {
    const bad = join(out.dir, "bad.json");
    writeFileSync(bad, "{");
    const r = spawnCli(["add-text", fix.path, "0s", "2s", "x", "--preset", bad]);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /not valid JSON/i);
  });

  it("rejects JSON without the capcutCliPreset marker", () => {
    const bad = join(out.dir, "marker.json");
    writeFileSync(bad, JSON.stringify({ style: { font_size: 24 } }));
    const r = spawnCli(["text-style", fix.path, "deadbeef", "--preset", bad]);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /capcutCliPreset/);
  });

  it("rejects an unsupported preset version", () => {
    const bad = join(out.dir, "v2.json");
    writeFileSync(bad, JSON.stringify({ capcutCliPreset: 2, style: {} }));
    const r = spawnCli(["add-text", fix.path, "0s", "2s", "x", "--preset", bad]);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /version/i);
  });

  it("caption refuses --style-ref together with --preset", () => {
    const r = spawnCli([
      "caption",
      fix.path,
      "--audio",
      "missing.wav",
      "--style-ref",
      "deadbeef",
      "--preset",
      presetPath,
    ]);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /mutually exclusive/i);
  });
});

describe("capcut make-preset errors", () => {
  const fix = tmpDraft();
  const out = tmpDir();
  after(() => {
    fix.cleanup();
    out.cleanup();
  });

  it("requires --out", () => {
    const texts = spawnCli(["texts", fix.path]).json ?? [];
    if (texts.length === 0) return;
    const r = spawnCli(["make-preset", fix.path, texts[0].id.slice(0, 8)]);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /--out/);
  });

  it("rejects a non-text segment", () => {
    const videoSegs = spawnCli(["segments", fix.path, "--track", "video"]).json ?? [];
    if (videoSegs.length === 0) return;
    const r = spawnCli(["make-preset", fix.path, videoSegs[0].id.slice(0, 8), "--out", join(out.dir, "p.json")]);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /text segments/i);
  });

  it("rejects an unknown segment", () => {
    const r = spawnCli(["make-preset", fix.path, "ffffffff", "--out", join(out.dir, "p.json")]);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /not found/i);
  });
});
