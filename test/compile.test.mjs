import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { spawnCli } from "./helpers/spawn-cli.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Media files only need to EXIST for compile (factory copies them; it never
// reads their content), so empty placeholder files are enough here.
function setup() {
  const dir = mkdtempSync(join(tmpdir(), "capcut-compile-"));
  writeFileSync(join(dir, "clip1.mp4"), "");
  writeFileSync(join(dir, "clip2.mp4"), "");
  writeFileSync(join(dir, "music.mp3"), "");
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

function writeSpec(dir, spec) {
  const p = join(dir, "spec.json");
  writeFileSync(p, JSON.stringify(spec));
  return p;
}

const VALID = {
  name: "T",
  width: 720,
  height: 1280,
  fps: 30,
  ratio: "9:16",
  tracks: [
    {
      type: "video",
      items: [
        { path: "clip1.mp4", start: 0, duration: 2 },
        { path: "clip2.mp4", start: 2, duration: 3 },
      ],
    },
    { type: "audio", items: [{ path: "music.mp3", start: 0, duration: 5, volume: 0.4 }] },
    { type: "text", items: [{ text: "Hook", start: 0, duration: 2, fontSize: 18, color: "#FFD700", y: -0.6 }] },
  ],
};

describe("compile", () => {
  it("builds a valid draft from a JSON spec (both draft files, consistent)", () => {
    const s = setup();
    after(s.cleanup);
    const spec = writeSpec(s.dir, VALID);
    const out = join(s.dir, "Built");
    const r = spawnCli(["compile", spec, "--out", out]);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.json.ok, true);
    assert.equal(r.json.tracks, 3);
    assert.equal(r.json.segments, 4);
    assert.equal(r.json.duration_us, 5_000_000);

    const content = JSON.parse(readFileSync(join(out, "draft_content.json"), "utf-8"));
    const info = JSON.parse(readFileSync(join(out, "draft_info.json"), "utf-8"));
    // Canvas + fps come from the spec.
    assert.deepEqual(content.canvas_config, { width: 720, height: 1280, ratio: "9:16" });
    assert.equal(content.fps, 30);
    assert.equal(content.duration, 5_000_000);
    // Times converted seconds -> microseconds.
    const vTrack = content.tracks.find((t) => t.type === "video");
    assert.equal(vTrack.segments.length, 2);
    assert.equal(vTrack.segments[0].target_timerange.duration, 2_000_000);
    // Both files mirror the same built draft so every downstream tool agrees.
    assert.equal(JSON.stringify(content), JSON.stringify(info));
  });

  it("produces a draft that passes lint (cross-tool validity)", () => {
    const s = setup();
    after(s.cleanup);
    const spec = writeSpec(s.dir, VALID);
    const out = join(s.dir, "Built");
    assert.equal(spawnCli(["compile", spec, "--out", out]).status, 0);
    const lint = spawnCli(["lint", out, "--no-check-paths"]);
    assert.equal(lint.status, 0, `lint failed: ${lint.stdout}${lint.stderr}`);
  });

  it("supports refs, decorators, templates, captions, and --check planning", () => {
    const s = setup();
    after(s.cleanup);
    writeFileSync(join(s.dir, "captions.srt"), "1\n00:00:00,000 --> 00:00:01,000\nHello\n");
    const rich = structuredClone(VALID);
    rich.tracks[0].items = [
      { path: "clip1.mp4", start: 0, duration: 2, ref: "hero", speed: 1.25, opacity: 0.8, scale: 1.1 },
    ];
    rich.tracks[1].items[0].ref = "music";
    rich.tracks[2].items[0].ref = "hook";
    rich.operations = [
      { op: "transition", target: "hero", slug: "dissolve", duration: 0.4 },
      { op: "keyframe", target: "hero", property: "uniform_scale", time: 0, value: 1 },
      { op: "audio-fade", target: "music", fadeIn: 0.5, fadeOut: 0.5 },
      { op: "text-style", target: "hook", style: { borderWidth: 0.08, borderColor: "#000000" } },
      { op: "text-ranges", target: "hook", ranges: [{ start: 0, end: 4, font_color: "#FFD700" }] },
      { op: "filter", slug: "vintage", start: 0, duration: 2 },
      { op: "effect", slug: "shake", start: 0, duration: 1 },
      {
        op: "template",
        path: join(__dirname, "..", "templates", "subscribe-cta.json"),
        start: 1,
        duration: 1,
        text: "Follow",
      },
      { op: "captions", path: "captions.srt" },
    ];
    const spec = writeSpec(s.dir, rich);
    const out = join(s.dir, "Rich");

    const check = spawnCli(["compile", spec, "--out", out, "--check"]);
    assert.equal(check.status, 0, check.stderr);
    assert.equal(check.json.write, false);
    assert.equal(check.json.operations, rich.operations.length);
    assert.equal(check.json.refs.length, 3);
    assert.equal(readFileSync(spec, "utf-8").length > 0, true);

    const result = spawnCli(["compile", spec, "--out", out]);
    assert.equal(result.status, 0, result.stderr);
    assert.ok(result.json.refs.hero);
    const draft = JSON.parse(readFileSync(join(out, "draft_content.json"), "utf-8"));
    const hero = draft.tracks
      .flatMap((track) => track.segments)
      .find((segment) => segment.id === result.json.refs.hero);
    assert.equal(hero.speed, 1.25);
    assert.equal(hero.clip.alpha, 0.8);
    assert.equal(hero.clip.scale.x, 1.1);
    assert.ok(hero.common_keyframes.length > 0);
    assert.ok(draft.materials.transitions.length > 0);
    assert.ok(draft.materials.audio_fades.length > 0);
    assert.ok(draft.tracks.some((track) => track.type === "filter"));
    assert.ok(draft.tracks.some((track) => track.type === "effect"));
    assert.ok(draft.tracks.some((track) => track.name === "captions"));
  });

  it("rejects a spec with no tracks", () => {
    const s = setup();
    after(s.cleanup);
    const spec = writeSpec(s.dir, { name: "X", tracks: [] });
    const r = spawnCli(["compile", spec, "--out", join(s.dir, "X")]);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /tracks must be a non-empty array/);
  });

  it("fails before writing when a media file is missing", () => {
    const s = setup();
    after(s.cleanup);
    const spec = writeSpec(s.dir, {
      name: "X",
      tracks: [{ type: "video", items: [{ path: "does-not-exist.mp4", start: 0, duration: 2 }] }],
    });
    const r = spawnCli(["compile", spec, "--out", join(s.dir, "X")]);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /media file not found/);
  });

  it("requires text and duration on text items", () => {
    const s = setup();
    after(s.cleanup);
    const spec = writeSpec(s.dir, {
      name: "X",
      tracks: [{ type: "text", items: [{ start: 0, duration: 2 }] }],
    });
    const r = spawnCli(["compile", spec, "--out", join(s.dir, "X")]);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /\.text is required/);
  });

  it("rejects invalid JSON with a clear error", () => {
    const s = setup();
    after(s.cleanup);
    const p = join(s.dir, "bad.json");
    writeFileSync(p, "{not json");
    const r = spawnCli(["compile", p, "--out", join(s.dir, "X")]);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /not valid JSON/);
  });
});

// v0.13.0 review: validateSpec never checked the keyframe `easing` field, so
// `compile --check` exited 0 on a spec the real compile would reject — and the
// real compile only threw AFTER initDraft had seeded the draft directory,
// leaving an orphan half-built draft that CapCut lists.
describe("compile: keyframe easing pre-flight", () => {
  const specWithEasing = (easing) => ({
    name: "K",
    tracks: [{ type: "video", items: [{ path: "clip1.mp4", start: 0, duration: 2, ref: "v1" }] }],
    operations: [{ op: "keyframe", target: "v1", property: "uniform_scale", time: 1, value: 1.2, easing }],
  });

  it("--check rejects an invalid easing instead of green-lighting it", () => {
    const s = setup();
    after(s.cleanup);
    const spec = writeSpec(s.dir, specWithEasing("cubic-out"));
    const r = spawnCli(["compile", spec, "--check"]);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /Unsupported keyframe easing: cubic-out/);
  });

  it("real compile fails before initDraft writes anything (no orphan draft dir)", () => {
    const s = setup();
    after(s.cleanup);
    const spec = writeSpec(s.dir, specWithEasing("cubic-out"));
    const out = join(s.dir, "outdraft");
    const r = spawnCli(["compile", spec, "--out", out]);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /Unsupported keyframe easing: cubic-out/);
    assert.equal(existsSync(out), false, "orphan half-built draft dir left behind");
  });

  it("rejects inherited prototype names in specs too", () => {
    const s = setup();
    after(s.cleanup);
    const spec = writeSpec(s.dir, specWithEasing("hasOwnProperty"));
    const r = spawnCli(["compile", spec, "--check"]);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /Unsupported keyframe easing: hasOwnProperty/);
  });

  it("--check and compile both accept every supported easing", () => {
    const s = setup();
    after(s.cleanup);
    const spec = writeSpec(s.dir, specWithEasing("ease-out"));
    assert.equal(spawnCli(["compile", spec, "--check"]).status, 0);
    const out = join(s.dir, "Built");
    const r = spawnCli(["compile", spec, "--out", out]);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.json.ok, true);
  });
});
