import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { displayDimensions, normalizeRotation, parseProbeStreams, probeVideoDimensions } from "../dist/probe.js";
import { spawnCli } from "./helpers/spawn-cli.mjs";
import { tmpDraft } from "./helpers/tmp-draft.mjs";

const hasFfprobe = spawnSync("ffprobe", ["-version"], { encoding: "utf-8" }).status === 0;

const REAL_MEDIA = join(process.cwd(), "media", "two-sisters-vietnam-short.mp4"); // 64x64

describe("probe: parseProbeStreams", () => {
  it("reads width/height off the first video stream", () => {
    const json = JSON.stringify({ streams: [{ codec_type: "video", width: 1920, height: 1080 }] });
    assert.deepEqual(parseProbeStreams(json), { width: 1920, height: 1080, rotation: 0 });
  });

  it("reads rotation from tags.rotate (older ffmpeg)", () => {
    const json = JSON.stringify({
      streams: [{ codec_type: "video", width: 1920, height: 1080, tags: { rotate: "90" } }],
    });
    assert.deepEqual(parseProbeStreams(json), { width: 1920, height: 1080, rotation: 90 });
  });

  it("reads rotation from a Display Matrix side_data entry (newer ffmpeg)", () => {
    const json = JSON.stringify({
      streams: [
        {
          codec_type: "video",
          width: 1920,
          height: 1080,
          side_data_list: [{ side_data_type: "Display Matrix", rotation: -90 }],
        },
      ],
    });
    assert.deepEqual(parseProbeStreams(json), { width: 1920, height: 1080, rotation: 270 });
  });

  it("skips audio-only streams and returns null", () => {
    const json = JSON.stringify({ streams: [{ codec_type: "audio" }] });
    assert.equal(parseProbeStreams(json), null);
  });

  it("returns null on malformed JSON", () => {
    assert.equal(parseProbeStreams("not json"), null);
  });
});

describe("probe: displayDimensions", () => {
  it("leaves landscape unchanged at 0/180", () => {
    assert.deepEqual(displayDimensions({ width: 1920, height: 1080, rotation: 0 }), {
      width: 1920,
      height: 1080,
    });
    assert.deepEqual(displayDimensions({ width: 1920, height: 1080, rotation: 180 }), {
      width: 1920,
      height: 1080,
    });
  });

  it("swaps W/H for a 90/270 rotation (portrait phone clip)", () => {
    assert.deepEqual(displayDimensions({ width: 1920, height: 1080, rotation: 90 }), {
      width: 1080,
      height: 1920,
    });
    assert.deepEqual(displayDimensions({ width: 1920, height: 1080, rotation: 270 }), {
      width: 1080,
      height: 1920,
    });
  });
});

describe("probe: normalizeRotation", () => {
  it("normalizes negatives and overflows to 0/90/180/270", () => {
    assert.equal(normalizeRotation(-90), 270);
    assert.equal(normalizeRotation(450), 90);
    assert.equal(normalizeRotation(360), 0);
    assert.equal(normalizeRotation(-270), 90);
  });
});

describe("add-video: dimension resolution", () => {
  const fix = tmpDraft();
  after(() => fix.cleanup());

  function dummyMedia(name) {
    const p = join(fix.dir, name);
    writeFileSync(p, "not a real video");
    return p;
  }

  it("honors explicit --width/--height (no probe needed)", () => {
    const media = dummyMedia("flags.mp4");
    const r = spawnCli(["add-video", fix.path, media, "0", "1s", "--width", "1080", "--height", "1920"]);
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    assert.equal(r.json.width, 1080);
    assert.equal(r.json.height, 1920);
    assert.equal(r.json.dimension_source, "flags");
  });

  it("falls back to 1920x1080 + warning when dimensions cannot be probed", () => {
    const media = dummyMedia("garbage.mp4");
    const r = spawnCli(["add-video", fix.path, media, "0", "1s"]);
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    assert.equal(r.json.width, 1920);
    assert.equal(r.json.height, 1080);
    assert.equal(r.json.dimension_source, "default");
    assert.match(r.json.warning, /ffprobe|--width/);
  });

  it("auto-probes a real file via ffprobe", (t) => {
    if (!hasFfprobe) return t.skip("ffprobe not installed");
    const probed = probeVideoDimensions(REAL_MEDIA);
    if (!probed) return t.skip("test media not available");
    const r = spawnCli(["add-video", fix.path, REAL_MEDIA, "0", "1s", "--track-name", "probe"]);
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    assert.equal(r.json.dimension_source, "ffprobe");
    assert.equal(r.json.width, probed.width);
    assert.equal(r.json.height, probed.height);
  });
});
