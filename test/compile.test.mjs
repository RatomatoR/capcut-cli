import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { spawnCli } from "./helpers/spawn-cli.mjs";

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
