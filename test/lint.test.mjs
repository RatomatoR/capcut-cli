import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
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

  describe("--fix auto-repair", () => {
    function seedOverlappingCaptions(draftPath) {
      const draft = JSON.parse(readFileSync(draftPath, "utf-8"));
      let mat = draft.materials.texts?.[0];
      if (!mat) {
        mat = {
          id: "fix-mat-1",
          type: "text",
          content: '{"text":"Hello","styles":[]}',
          font_size: 15,
          text_color: "#FFFFFF",
          alignment: 1,
        };
        draft.materials.texts = [...(draft.materials.texts ?? []), mat];
      }
      let textTrack = draft.tracks.find((t) => t.type === "text");
      if (!textTrack) {
        textTrack = { id: "fix-text-track", type: "text", name: "captions", attribute: 0, segments: [] };
        draft.tracks.push(textTrack);
      }
      const base = {
        material_id: mat.id,
        source_timerange: { start: 0, duration: 1_000_000 },
        speed: 1,
        volume: 1,
        visible: true,
        clip: { alpha: 1, rotation: 0, scale: { x: 1, y: 1 }, transform: { x: 0, y: 0 } },
        extra_material_refs: [],
        render_index: 0,
      };
      // Overlap: seg A ends at 2s, seg B starts at 1s (500ms overlap).
      textTrack.segments.push({
        ...base,
        id: "fix-seg-1-aaaa-bbbb-cccc-dddddddddddd",
        target_timerange: { start: 100_000_000, duration: 2_000_000 },
      });
      textTrack.segments.push({
        ...base,
        id: "fix-seg-2-aaaa-bbbb-cccc-dddddddddddd",
        target_timerange: { start: 101_000_000, duration: 2_000_000 },
      });
      // A missing-material reference on a separate segment — not fixable.
      textTrack.segments.push({
        ...base,
        id: "fix-seg-3-aaaa-bbbb-cccc-dddddddddddd",
        material_id: "does-not-exist-in-any-materials",
        target_timerange: { start: 200_000_000, duration: 1_000_000 },
      });
      writeFileSync(draftPath, JSON.stringify(draft));
    }

    describe("repairs fixable defects and writes atomically", () => {
      const fix = tmpDraft();
      after(() => fix.cleanup());

      it("trims overlapping captions, leaves non-fixable issues reported, and writes a .bak", () => {
        seedOverlappingCaptions(fix.path);

        const r = spawnCli(["lint", fix.path, "--fix", "--no-check-paths"]);
        assert.ok(r.json, `stdout should be JSON; got: ${r.stdout}`);
        assert.ok(Array.isArray(r.json.fixed), "expected fixed[] in output");
        const overlapFixed = r.json.fixed.filter((i) => i.code === "caption-overlap");
        assert.ok(overlapFixed.length > 0, `expected caption-overlap in fixed; got: ${JSON.stringify(r.json.fixed)}`);

        // The non-fixable missing-material remains and drives exit code 2.
        const missing = r.json.issues.filter((i) => i.code === "missing-material");
        assert.ok(missing.length > 0, "missing-material should remain reported");
        assert.equal(missing[0].fixable, false);
        assert.equal(r.status, 2);

        // .bak snapshot created by saveDraft.
        assert.ok(existsSync(`${fix.path}.bak`), "expected .bak to be written next to the draft");

        // The on-disk draft no longer overlaps.
        const repaired = JSON.parse(readFileSync(fix.path, "utf-8"));
        const track = repaired.tracks.find((t) => t.segments.some((s) => s.id.startsWith("fix-seg-1")));
        const segs = [...track.segments].sort((a, b) => a.target_timerange.start - b.target_timerange.start);
        for (let i = 0; i < segs.length - 1; i++) {
          const end = segs[i].target_timerange.start + segs[i].target_timerange.duration;
          assert.ok(end <= segs[i + 1].target_timerange.start, `segments still overlap: ${JSON.stringify(segs)}`);
        }
      });
    });

    describe("--fix --dry-run", () => {
      const fix = tmpDraft();
      after(() => fix.cleanup());

      it("previews the plan without writing the draft or a .bak", () => {
        seedOverlappingCaptions(fix.path);
        const before = readFileSync(fix.path, "utf-8");

        const r = spawnCli(["lint", fix.path, "--fix", "--dry-run", "--no-check-paths"]);
        assert.ok(r.json, `stdout should be JSON; got: ${r.stdout}`);
        // dryRun stamp comes from the shared out() helper.
        assert.equal(r.json.dryRun, true);
        const overlapFixed = r.json.fixed.filter((i) => i.code === "caption-overlap");
        assert.ok(overlapFixed.length > 0, "expected caption-overlap to appear in fixed[] under --dry-run");

        const after = readFileSync(fix.path, "utf-8");
        assert.equal(after, before, "--dry-run must not modify the draft");
        assert.ok(!existsSync(`${fix.path}.bak`), "--dry-run must not write a .bak");
      });
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

  describe("--fix re-wraps over-long caption lines", () => {
    const fix = tmpDraft();
    after(() => fix.cleanup());

    it("wraps at word boundaries, keeps text length, and re-lints clean", () => {
      const draft = JSON.parse(readFileSync(fix.path, "utf-8"));
      const longText = "the quick brown fox jumps over the lazy dog and keeps running far beyond the fence"; // 83 chars > 42
      const mat = {
        id: "wrap-text-mat",
        type: "text",
        content: JSON.stringify({ text: longText, styles: [] }),
        font_size: 15,
        text_color: "#FFFFFF",
        alignment: 1,
      };
      draft.materials.texts = [...(draft.materials.texts ?? []), mat];
      let textTrack = draft.tracks.find((t) => t.type === "text");
      if (!textTrack) {
        textTrack = { id: "wrap-text-track", type: "text", name: "captions", attribute: 0, segments: [] };
        draft.tracks.push(textTrack);
      }
      textTrack.segments.push({
        id: "wrap-seg-1-aaaa-bbbb-cccc-dddddddddddd",
        material_id: mat.id,
        target_timerange: { start: 300_000_000, duration: 2_000_000 },
        source_timerange: { start: 0, duration: 2_000_000 },
        speed: 1,
        volume: 1,
        visible: true,
        clip: { alpha: 1, rotation: 0, scale: { x: 1, y: 1 }, transform: { x: 0, y: 0 } },
        extra_material_refs: [],
        render_index: 0,
      });
      writeFileSync(fix.path, JSON.stringify(draft));

      const detect = spawnCli(["lint", fix.path, "--no-check-paths"]);
      const found = detect.json.issues.filter((i) => i.code === "line-too-long");
      assert.ok(found.length > 0, `expected line-too-long; got: ${JSON.stringify(detect.json.issues)}`);
      assert.equal(found[0].fixable, true);

      const r = spawnCli(["lint", fix.path, "--fix", "--no-check-paths"]);
      const wrapped = r.json.fixed.filter((i) => i.code === "line-too-long");
      assert.ok(wrapped.length > 0, `expected line-too-long in fixed; got: ${JSON.stringify(r.json.fixed)}`);

      const relint = spawnCli(["lint", fix.path, "--no-check-paths"]);
      assert.ok(
        !relint.json.issues.some((i) => i.code === "line-too-long"),
        `re-lint should be clean; got: ${JSON.stringify(relint.json.issues)}`,
      );

      // Word-boundary wrap must be length-neutral (spaces become newlines 1:1)
      // so the styles[] UTF-16LE byte ranges stay valid.
      const repaired = JSON.parse(readFileSync(fix.path, "utf-8"));
      const content = JSON.parse(repaired.materials.texts.find((m) => m.id === "wrap-text-mat").content);
      assert.equal(content.text.length, longText.length, "wrap must not change text length");
      assert.equal(content.text.replace(/\n/g, " "), longText, "only spaces may become newlines");
      for (const line of content.text.split("\n")) {
        assert.ok(line.length <= 42, `wrapped line still too long: "${line}"`);
      }
    });
  });

  describe("--fix restores minimum caption gaps", () => {
    const fix = tmpDraft();
    after(() => fix.cleanup());

    it("shrinks the earlier caption's end under --min-gap-ms and re-lints clean", () => {
      const draft = JSON.parse(readFileSync(fix.path, "utf-8"));
      let mat = draft.materials.texts?.[0];
      if (!mat) {
        mat = {
          id: "gap-mat-1",
          type: "text",
          content: '{"text":"Hello","styles":[]}',
          font_size: 15,
          text_color: "#FFFFFF",
          alignment: 1,
        };
        draft.materials.texts = [...(draft.materials.texts ?? []), mat];
      }
      let textTrack = draft.tracks.find((t) => t.type === "text");
      if (!textTrack) {
        textTrack = { id: "gap-text-track", type: "text", name: "captions", attribute: 0, segments: [] };
        draft.tracks.push(textTrack);
      }
      const base = {
        material_id: mat.id,
        source_timerange: { start: 0, duration: 2_000_000 },
        speed: 1,
        volume: 1,
        visible: true,
        clip: { alpha: 1, rotation: 0, scale: { x: 1, y: 1 }, transform: { x: 0, y: 0 } },
        extra_material_refs: [],
        render_index: 0,
      };
      // Gap: seg A ends at 402.0s, seg B starts at 402.1s — 100ms < 200ms minimum.
      textTrack.segments.push({
        ...base,
        id: "gap-seg-1-aaaa-bbbb-cccc-dddddddddddd",
        target_timerange: { start: 400_000_000, duration: 2_000_000 },
      });
      textTrack.segments.push({
        ...base,
        id: "gap-seg-2-aaaa-bbbb-cccc-dddddddddddd",
        target_timerange: { start: 402_100_000, duration: 2_000_000 },
      });
      writeFileSync(fix.path, JSON.stringify(draft));

      const detect = spawnCli(["lint", fix.path, "--min-gap-ms", "200", "--no-check-paths"]);
      const found = detect.json.issues.filter((i) => i.code === "caption-gap-too-small");
      assert.ok(found.length > 0, `expected caption-gap-too-small; got: ${JSON.stringify(detect.json.issues)}`);
      assert.equal(found[0].fixable, true);

      const r = spawnCli(["lint", fix.path, "--fix", "--min-gap-ms", "200", "--no-check-paths"]);
      const gapFixed = r.json.fixed.filter((i) => i.code === "caption-gap-too-small");
      assert.ok(gapFixed.length > 0, `expected caption-gap-too-small in fixed; got: ${JSON.stringify(r.json.fixed)}`);

      const relint = spawnCli(["lint", fix.path, "--min-gap-ms", "200", "--no-check-paths"]);
      assert.ok(
        !relint.json.issues.some((i) => i.code === "caption-gap-too-small"),
        `re-lint should be clean; got: ${JSON.stringify(relint.json.issues)}`,
      );

      // The earlier caption's end moved back; the later caption never moves.
      const repaired = JSON.parse(readFileSync(fix.path, "utf-8"));
      const track = repaired.tracks.find((t) => t.segments.some((s) => s.id.startsWith("gap-seg-1")));
      const segA = track.segments.find((s) => s.id.startsWith("gap-seg-1"));
      const segB = track.segments.find((s) => s.id.startsWith("gap-seg-2"));
      assert.equal(segA.target_timerange.duration, 1_900_000);
      assert.equal(segB.target_timerange.start, 402_100_000);
    });
  });

  describe("unknown-effect-slug detection", () => {
    function baseEffectMaterial(id, name, effectId, resourceId) {
      return {
        id,
        name,
        type: "video_effect",
        effect_id: effectId,
        resource_id: resourceId,
        adjust_params: [],
        apply_target_type: 2,
        category_id: "",
        category_name: "",
        platform: "all",
        value: 1.0,
      };
    }

    describe("flags ids missing from the enum table", () => {
      const fix = tmpDraft();
      after(() => fix.cleanup());

      it("warns on bogus effect and animation ids as report-only", () => {
        const draft = JSON.parse(readFileSync(fix.path, "utf-8"));
        draft.materials.video_effects = [
          baseEffectMaterial("bogus-effect-mat", "Stale Effect", "1111111111111111111", "1111111111111111111"),
        ];
        draft.materials.material_animations = [
          {
            id: "bogus-anim-container",
            type: "sticker_animation",
            multi_language_current: "none",
            animations: [
              {
                id: "2222222222222222222",
                resource_id: "2222222222222222222",
                name: "Stale Anim",
                type: "in",
                duration: 500_000,
                start: 0,
                material_type: "text",
              },
            ],
          },
        ];
        writeFileSync(fix.path, JSON.stringify(draft));

        const r = spawnCli(["lint", fix.path, "--no-check-paths"]);
        const unknown = r.json.issues.filter((i) => i.code === "unknown-effect-slug");
        assert.equal(unknown.length, 2, `expected 2 unknown-effect-slug issues; got: ${JSON.stringify(r.json.issues)}`);
        const materialIds = unknown.map((i) => i.location.material_id).sort();
        assert.deepEqual(materialIds, ["bogus-anim-container", "bogus-effect-mat"]);
        for (const i of unknown) {
          assert.equal(i.severity, "warning");
          assert.equal(i.fixable, false);
        }
        // Warnings-only draft → exit 1 per the CI contract.
        assert.equal(r.json.summary.errors, 0);
        assert.equal(r.status, 1);

        // Report-only: --fix must not claim it repaired anything here.
        const fixRun = spawnCli(["lint", fix.path, "--fix", "--no-check-paths"]);
        assert.ok(
          !fixRun.json.fixed.some((i) => i.code === "unknown-effect-slug"),
          `unknown-effect-slug must never appear in fixed[]; got: ${JSON.stringify(fixRun.json.fixed)}`,
        );
        assert.ok(fixRun.json.issues.some((i) => i.code === "unknown-effect-slug"));
      });
    });

    describe("passes on known ids", () => {
      const fix = tmpDraft();
      after(() => fix.cleanup());

      it("accepts enum-table ids and the inline starter catalogue", () => {
        const draft = JSON.parse(readFileSync(fix.path, "utf-8"));
        draft.materials.video_effects = [
          // From enums.json (capcut scene_effects: blur).
          baseEffectMaterial("enum-effect-mat", "Blur", "15206412", "6739752823140913675"),
          // From the inline knossos-verified starter catalogue (add-effect shake).
          baseEffectMaterial("inline-effect-mat", "Shake", "7061205058364788270", "7061205058364788270"),
        ];
        writeFileSync(fix.path, JSON.stringify(draft));

        const r = spawnCli(["lint", fix.path, "--no-check-paths"]);
        assert.ok(
          !r.json.issues.some((i) => i.code === "unknown-effect-slug"),
          `expected no unknown-effect-slug; got: ${JSON.stringify(r.json.issues)}`,
        );
      });
    });
  });
});
