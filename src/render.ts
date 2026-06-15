import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Draft, Segment } from "./draft.js";
import { extractText } from "./draft.js";

/**
 * Headless ffmpeg proxy renderer.
 *
 * Closes the blind-edit loop: a CapCut draft is opaque JSON you cannot watch
 * until you open the app. `render` flattens the draft's MAIN video track
 * (trim source range + apply per-segment speed + scale to a low-res proxy),
 * mixes every audio-track segment, and optionally burns the text segments in
 * with `--burn-captions`. The result is a watchable preview MP4 — NOT CapCut's
 * final render (no multi-track video compositing, no effects/transitions). It
 * exists to verify "did my edit land where I meant it" without launching CapCut.
 *
 * Architecture mirrors `caption` (shell-out to an external binary, here ffmpeg)
 * and `export --batch` (a deterministic, unit-tested command builder, with the
 * live run gated behind host availability). `buildRenderPlan` is pure so the
 * filter graph can be asserted in tests without invoking ffmpeg; `renderDraft`
 * runs it unless `--dry-run`.
 */

const US = 1_000_000; // microseconds per second — CapCut's timing unit

export interface RenderOptions {
  out?: string; // output file; default <draftdir>/preview.mp4
  scale?: number; // proxy scale factor applied to canvas dims (default 0.5)
  fps?: number; // output fps override (default draft.fps or 30)
  ffmpegCmd?: string; // ffmpeg binary (default "ffmpeg")
  burnCaptions?: boolean; // draw text-track segments onto the video
  dryRun?: boolean; // build the plan, do not execute ffmpeg
}

export interface RenderInput {
  index: number;
  path: string;
  kind: "video" | "photo" | "audio";
}

export interface RenderPlan {
  output: string;
  width: number;
  height: number;
  fps: number;
  inputs: RenderInput[];
  filterComplex: string;
  args: string[];
  videoSegments: number;
  audioSegments: number;
  textOverlays: number;
  skipped: Array<{ segmentId: string; reason: string }>;
}

export interface RenderResult extends RenderPlan {
  ok: boolean;
  executed: boolean;
}

function findVideoPath(draft: Draft, materialId: string): string | undefined {
  const m = draft.materials.videos?.find((v) => v.id === materialId);
  return m?.path;
}

function findAudioPath(draft: Draft, materialId: string): string | undefined {
  const m = draft.materials.audios?.find((a) => a.id === materialId);
  return m?.path;
}

function isPhoto(draft: Draft, materialId: string): boolean {
  const m = draft.materials.videos?.find((v) => v.id === materialId);
  return (m?.type ?? "video") === "photo";
}

// The "main" video track = the first track of type "video" (CapCut lays the
// timeline out bottom->top from the tracks array, so the first video track is
// the base layer). Overlay video tracks are not composited in the proxy.
function mainVideoSegments(draft: Draft): Segment[] {
  const track = draft.tracks.find((t) => t.type === "video");
  if (!track) return [];
  return [...track.segments].sort((a, b) => a.target_timerange.start - b.target_timerange.start);
}

function audioSegments(draft: Draft): Segment[] {
  const segs: Segment[] = [];
  for (const t of draft.tracks) {
    if (t.type === "audio") segs.push(...t.segments);
  }
  return segs.sort((a, b) => a.target_timerange.start - b.target_timerange.start);
}

function textSegments(draft: Draft): Array<{ seg: Segment; text: string }> {
  const out: Array<{ seg: Segment; text: string }> = [];
  for (const t of draft.tracks) {
    if (t.type !== "text") continue;
    for (const s of t.segments) {
      const mat = draft.materials.texts?.find((m) => m.id === s.material_id);
      const raw = typeof mat?.content === "string" ? extractText(mat.content) : "";
      if (raw) out.push({ seg: s, text: raw });
    }
  }
  return out.sort((a, b) => a.seg.target_timerange.start - b.seg.target_timerange.start);
}

// atempo only accepts 0.5..2.0 per filter instance; we keep proxy audio simple
// and only retime when a single atempo can express it.
function atempoFor(speed: number): string | null {
  if (!speed || speed === 1) return null;
  if (speed >= 0.5 && speed <= 2) return `atempo=${round3(speed)}`;
  return null; // out of single-stage range — leave audio at source rate for the proxy
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

// drawtext is whitespace/colon/quote sensitive; sanitize aggressively for a proxy.
function escapeDrawtext(s: string): string {
  return s
    .replace(/\\/g, "")
    .replace(/:/g, " ")
    .replace(/'/g, "")
    .replace(/"/g, "")
    .replace(/%/g, " ")
    .replace(/\r?\n/g, " ")
    .trim()
    .slice(0, 120);
}

/**
 * Build the ffmpeg invocation for a draft. Pure and deterministic given the
 * draft + options (no uuids, no clock) so it can be asserted in tests.
 */
export function buildRenderPlan(draft: Draft, opts: RenderOptions): RenderPlan {
  const scale = opts.scale && opts.scale > 0 ? opts.scale : 0.5;
  const canvas = draft.canvas_config ?? { width: 1920, height: 1080, ratio: "16:9" };
  const width = Math.max(2, Math.round((canvas.width * scale) / 2) * 2);
  const height = Math.max(2, Math.round((canvas.height * scale) / 2) * 2);
  const fps = opts.fps && opts.fps > 0 ? opts.fps : draft.fps || 30;
  const output = opts.out ?? join(dirname(""), "preview.mp4");

  const inputs: RenderInput[] = [];
  const skipped: Array<{ segmentId: string; reason: string }> = [];
  const inputArgs: string[] = [];
  const filterParts: string[] = [];
  const videoLabels: string[] = [];

  // --- video segments (main track) ---
  const vSegs = mainVideoSegments(draft);
  for (const seg of vSegs) {
    const path = findVideoPath(draft, seg.material_id);
    if (!path) {
      skipped.push({ segmentId: seg.id, reason: "no material path" });
      continue;
    }
    if (!existsSync(path)) {
      skipped.push({ segmentId: seg.id, reason: `file missing: ${path}` });
      continue;
    }
    const photo = isPhoto(draft, seg.material_id);
    const targetDur = round3(seg.target_timerange.duration / US);
    const idx = inputs.length;
    inputs.push({ index: idx, path, kind: photo ? "photo" : "video" });
    if (photo) {
      inputArgs.push("-loop", "1", "-t", String(targetDur), "-i", path);
    } else {
      inputArgs.push("-i", path);
    }
    const label = `v${idx}`;
    if (photo) {
      filterParts.push(
        `[${idx}:v]scale=${width}:${height}:force_original_aspect_ratio=decrease,` +
          `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${fps},format=yuv420p,` +
          `trim=duration=${targetDur},setpts=PTS-STARTPTS[${label}]`,
      );
    } else {
      const srcStart = round3(seg.source_timerange.start / US);
      const srcDur = round3(seg.source_timerange.duration / US);
      const speed = seg.speed || 1;
      const setpts = speed === 1 ? "setpts=PTS-STARTPTS" : `setpts=(PTS-STARTPTS)/${round3(speed)}`;
      filterParts.push(
        `[${idx}:v]trim=start=${srcStart}:duration=${srcDur},${setpts},` +
          `scale=${width}:${height}:force_original_aspect_ratio=decrease,` +
          `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${fps},format=yuv420p[${label}]`,
      );
    }
    videoLabels.push(`[${label}]`);
  }

  if (videoLabels.length === 0) {
    throw new Error(
      "render: no usable video segments found on the main video track " +
        "(missing material paths or files). Proxy render needs at least one video segment.",
    );
  }

  // concat video parts into a single stream
  let vOut = "vout";
  if (videoLabels.length === 1) {
    // single segment: rename its label to vout via a passthrough null filter
    filterParts.push(`${videoLabels[0]}null[${vOut}]`);
  } else {
    filterParts.push(`${videoLabels.join("")}concat=n=${videoLabels.length}:v=1:a=0[${vOut}]`);
  }

  // --- captions (optional) ---
  const texts = opts.burnCaptions ? textSegments(draft) : [];
  let textOverlays = 0;
  for (const { seg, text } of texts) {
    const t = escapeDrawtext(text);
    if (!t) continue;
    const start = round3(seg.target_timerange.start / US);
    const end = round3((seg.target_timerange.start + seg.target_timerange.duration) / US);
    const next = `vt${textOverlays}`;
    filterParts.push(
      `[${vOut}]drawtext=text='${t}':fontcolor=white:fontsize=${Math.round(height / 18)}:` +
        `box=1:boxcolor=black@0.5:boxborderw=8:x=(w-text_w)/2:y=h-(h/6):` +
        `enable='between(t,${start},${end})'[${next}]`,
    );
    vOut = next;
    textOverlays++;
  }

  // --- audio segments ---
  const aSegs = audioSegments(draft);
  const audioLabels: string[] = [];
  for (const seg of aSegs) {
    const path = findAudioPath(draft, seg.material_id);
    if (!path) {
      skipped.push({ segmentId: seg.id, reason: "no audio material path" });
      continue;
    }
    if (!existsSync(path)) {
      skipped.push({ segmentId: seg.id, reason: `file missing: ${path}` });
      continue;
    }
    const idx = inputs.length;
    inputs.push({ index: idx, path, kind: "audio" });
    inputArgs.push("-i", path);
    const srcStart = round3(seg.source_timerange.start / US);
    const srcDur = round3(seg.source_timerange.duration / US);
    const startMs = Math.round(seg.target_timerange.start / 1000);
    const vol = seg.volume ?? 1;
    const tempo = atempoFor(seg.speed || 1);
    const chain = [
      `atrim=start=${srcStart}:duration=${srcDur}`,
      "asetpts=PTS-STARTPTS",
      tempo,
      vol !== 1 ? `volume=${round3(vol)}` : null,
      `adelay=${startMs}|${startMs}`,
    ].filter(Boolean);
    const label = `a${idx}`;
    filterParts.push(`[${idx}:a]${chain.join(",")}[${label}]`);
    audioLabels.push(`[${label}]`);
  }

  let aOut: string | null = null;
  if (audioLabels.length === 1) {
    aOut = "aout";
    filterParts.push(`${audioLabels[0]}anull[${aOut}]`);
  } else if (audioLabels.length > 1) {
    aOut = "aout";
    filterParts.push(`${audioLabels.join("")}amix=inputs=${audioLabels.length}:normalize=0[${aOut}]`);
  }

  const filterComplex = filterParts.join(";");
  const args = [
    "-y",
    ...inputArgs,
    "-filter_complex",
    filterComplex,
    "-map",
    `[${vOut}]`,
    ...(aOut ? ["-map", `[${aOut}]`] : []),
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "28",
    "-pix_fmt",
    "yuv420p",
    ...(aOut ? ["-c:a", "aac", "-b:a", "128k"] : ["-an"]),
    "-shortest",
    output,
  ];

  return {
    output,
    width,
    height,
    fps,
    inputs,
    filterComplex,
    args,
    videoSegments: videoLabels.length,
    audioSegments: audioLabels.length,
    textOverlays,
    skipped,
  };
}

export function renderDraft(draft: Draft, filePath: string, opts: RenderOptions): RenderResult {
  const out = opts.out ?? join(dirname(filePath), "preview.mp4");
  const plan = buildRenderPlan(draft, { ...opts, out });

  if (opts.dryRun) {
    return { ...plan, ok: true, executed: false };
  }

  const cmd = opts.ffmpegCmd ?? "ffmpeg";
  const r = spawnSync(cmd, plan.args, { encoding: "utf-8", timeout: 600_000 });
  if (r.error || r.status !== 0) {
    const stderr = r.stderr?.slice(-600) || r.error?.message || `ffmpeg exited ${r.status}`;
    throw new Error(
      `render: ffmpeg failed.\n${stderr}\n` +
        "Install ffmpeg (`brew install ffmpeg` / `apt install ffmpeg`) or pass --ffmpeg-cmd <path>. " +
        "Re-run with --dry-run to inspect the filter graph without executing.",
    );
  }
  return { ...plan, ok: true, executed: true };
}
