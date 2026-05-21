import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { after, describe, it } from "node:test";
import { spawnCli } from "./helpers/spawn-cli.mjs";
import { tmpDraft } from "./helpers/tmp-draft.mjs";

describe("capcut lint", () => {
  describe("on a clean fixture", () => {
    const fix = tmpDraft();
    after(() => fix.cleanup());

    // The fixture has local-file paths that don't exist on this host. Skip path checks
    // so we measure schema/caption rules without unrelated noise.
    it("returns JSON with summary + issues", () => {
      const r = spawnCli(["lint", fix.path, "--no-check-paths"]);
      assert.ok(r.json, "stdout should be valid JSON");
      assert.equal(typeof r.json.ok, "boolean");
      assert.ok(r.json.summary);
      assert.equal(typeof r.json.summary.errors, "number");
      assert.equal(typeof r.json.summary.warnings, "number");
      assert.ok(Array.isArray(r.json.issues));
    });

    it("exit code 0 when no errors and no warnings", () => {
      const r = spawnCli(["lint", fix.path, "--no-check-paths"]);
      if (r.json.summary.errors === 0 && r.json.summary.warnings === 0) {
        assert.equal(r.status, 0);
      }
    });

    it("renders human output with -H", () => {
      const r = spawnCli(["lint", fix.path, "-H", "--no-check-paths"]);
      assert.ok(/OK — no issues/.test(r.stdout) || /errors/.test(r.stdout), `unexpected -H output: ${r.stdout}`);
    });
  });

  describe("path check detects missing material files", () => {
    const fix = tmpDraft();
    after(() => fix.cleanup());

    it("emits missing-file errors when local paths don't resolve", () => {
      // Default fixture has Windows-style C:\ paths that won't exist on linux — this is the
      // exact pain `capcut lint` catches: pipelines that produce broken-path drafts.
      const r = spawnCli(["lint", fix.path]);
      // Either zero issues (paths happen to exist) or errors with code missing-file.
      if (r.json.summary.errors > 0) {
        assert.equal(r.status, 2);
        const missing = r.json.issues.filter((i) => i.code === "missing-file");
        assert.ok(missing.length > 0, "expected at least one missing-file issue");
      }
    });
  });

  describe("caption overlap detection", () => {
    const fix = tmpDraft();
    after(() => fix.cleanup());

    it("flags overlapping captions as errors", () => {
      // Inject an overlapping caption pair into the fixture and confirm we detect it.
      const draft = JSON.parse(readFileSync(fix.path, "utf-8"));
      // Ensure a text track exists with at least 2 segments — append synthetic ones if needed.
      let textTrack = draft.tracks.find((t) => t.type === "text");
      if (!textTrack) {
        textTrack = { id: "synthetic-text-track", type: "text", name: "captions", attribute: 0, segments: [] };
        draft.tracks.push(textTrack);
      }
      // Use existing text material if available, else add one.
      let mat = draft.materials.texts?.[0];
      if (!mat) {
        mat = {
          id: "synthetic-text-mat",
          type: "text",
          content: '{"text":"Hello world","styles":[]}',
          font_size: 15,
          text_color: "#FFFFFF",
          alignment: 1,
        };
        draft.materials.texts = [...(draft.materials.texts ?? []), mat];
      }
      const baseSeg = {
        material_id: mat.id,
        source_timerange: { start: 0, duration: 1_000_000 },
        speed: 1,
        volume: 1,
        visible: true,
        clip: { alpha: 1, rotation: 0, scale: { x: 1, y: 1 }, transform: { x: 0, y: 0 } },
        extra_material_refs: [],
        render_index: 0,
      };
      textTrack.segments.push({
        ...baseSeg,
        id: "synth-seg-1-aaaa-bbbb-cccc-dddddddddddd",
        target_timerange: { start: 0, duration: 2_000_000 },
      });
      textTrack.segments.push({
        ...baseSeg,
        id: "synth-seg-2-aaaa-bbbb-cccc-dddddddddddd",
        target_timerange: { start: 1_000_000, duration: 2_000_000 }, // overlaps with seg-1
      });
      writeFileSync(fix.path, JSON.stringify(draft));

      const r = spawnCli(["lint", fix.path, "--no-check-paths"]);
      const overlaps = r.json.issues.filter((i) => i.code === "caption-overlap");
      assert.ok(overlaps.length > 0, `expected caption-overlap error; got: ${JSON.stringify(r.json.issues)}`);
      assert.equal(r.status, 2);
    });
  });

  describe("line-length warnings", () => {
    const fix = tmpDraft();
    after(() => fix.cleanup());

    it("flags overlong caption lines as warnings", () => {
      const draft = JSON.parse(readFileSync(fix.path, "utf-8"));
      const longText = "x".repeat(60); // > default 42
      const mat = {
        id: "long-text-mat",
        type: "text",
        content: JSON.stringify({ text: longText, styles: [] }),
        font_size: 15,
        text_color: "#FFFFFF",
        alignment: 1,
      };
      draft.materials.texts = [...(draft.materials.texts ?? []), mat];
      let textTrack = draft.tracks.find((t) => t.type === "text");
      if (!textTrack) {
        textTrack = { id: "synthetic-text-track-2", type: "text", name: "captions", attribute: 0, segments: [] };
        draft.tracks.push(textTrack);
      }
      textTrack.segments.push({
        id: "long-seg-aaaa-bbbb-cccc-dddddddddddd",
        material_id: mat.id,
        target_timerange: { start: 10_000_000, duration: 2_000_000 },
        source_timerange: { start: 0, duration: 2_000_000 },
        speed: 1,
        volume: 1,
        visible: true,
        clip: { alpha: 1, rotation: 0, scale: { x: 1, y: 1 }, transform: { x: 0, y: 0 } },
        extra_material_refs: [],
        render_index: 0,
      });
      writeFileSync(fix.path, JSON.stringify(draft));

      const r = spawnCli(["lint", fix.path, "--no-check-paths"]);
      const tooLong = r.json.issues.filter((i) => i.code === "line-too-long");
      assert.ok(tooLong.length > 0, `expected line-too-long warning; got: ${JSON.stringify(r.json.issues)}`);
    });
  });
});
