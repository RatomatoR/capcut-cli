import { spawnSync } from "node:child_process";

/**
 * Best-effort media dimension probe.
 *
 * `add-video` previously hardcoded 1920x1080 for every source, so a portrait
 * (1080x1920) clip landed in the draft as landscape and CapCut rendered it
 * letterboxed/cropped. This module shells out to `ffprobe` to read the real
 * stored dimensions AND the display rotation, then returns the dimensions as
 * they should appear on screen.
 *
 * Architecture mirrors `render`/`caption`: the parsing + rotation math is a
 * pure, deterministic function (`parseProbeStreams` / `displayDimensions`)
 * that tests can assert without invoking ffprobe; the live shell-out
 * (`probeVideoDimensions`) is best-effort and returns null whenever ffprobe is
 * missing, errors, or emits something we cannot parse. Callers fall back to
 * their previous defaults on null, so a host without ffprobe is never worse
 * off than before — it just does not get auto-detection.
 */

export interface ProbedDimensions {
  width: number;
  height: number;
  rotation: number; // normalized 0/90/180/270, clockwise
}

/**
 * Parse `ffprobe -show_streams -print_format json` output and pull the stored
 * width/height plus display rotation off the first video stream. Rotation is
 * read from `tags.rotate` (older ffmpeg) or a Display Matrix `side_data_list`
 * entry (newer ffmpeg), normalized to 0/90/180/270 clockwise. Returns null if
 * the JSON has no usable video stream.
 */
export function parseProbeStreams(json: string): ProbedDimensions | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  const streams = (parsed as { streams?: unknown }).streams;
  if (!Array.isArray(streams)) return null;

  const video = streams.find(
    (s) =>
      s &&
      typeof s === "object" &&
      (s as Record<string, unknown>).codec_type === "video" &&
      Number.isFinite(Number((s as Record<string, unknown>).width)) &&
      Number.isFinite(Number((s as Record<string, unknown>).height)),
  ) as Record<string, unknown> | undefined;
  if (!video) return null;

  const width = Number(video.width);
  const height = Number(video.height);
  if (!(width > 0) || !(height > 0)) return null;

  let rotation = 0;
  const tags = video.tags as Record<string, unknown> | undefined;
  if (tags && tags.rotate !== undefined && Number.isFinite(Number(tags.rotate))) {
    rotation = Number(tags.rotate);
  } else if (Array.isArray(video.side_data_list)) {
    for (const sd of video.side_data_list as Array<Record<string, unknown>>) {
      if (sd && Number.isFinite(Number(sd.rotation))) {
        rotation = Number(sd.rotation);
        break;
      }
    }
  }

  return { width, height, rotation: normalizeRotation(rotation) };
}

/** Normalize any degree value (negative or >360) to one of 0/90/180/270. */
export function normalizeRotation(rotation: number): number {
  const r = ((Math.round(rotation) % 360) + 360) % 360;
  // Snap to the nearest quarter turn; ffprobe occasionally reports e.g. -90.
  return (Math.round(r / 90) * 90) % 360;
}

/**
 * Apply rotation to stored dimensions to get on-screen (display) dimensions.
 * A 90/270 degree rotation swaps width and height.
 */
export function displayDimensions(d: ProbedDimensions): { width: number; height: number } {
  const rot = normalizeRotation(d.rotation);
  if (rot === 90 || rot === 270) return { width: d.height, height: d.width };
  return { width: d.width, height: d.height };
}

/**
 * Live, best-effort probe. Runs ffprobe against `path` and returns the
 * on-screen dimensions, or null if ffprobe is unavailable/fails/unparseable.
 * `ffprobeCmd` overrides the binary (mirrors render's `--ffmpeg-cmd`).
 */
export function probeVideoDimensions(
  path: string,
  ffprobeCmd = "ffprobe",
): { width: number; height: number; rotation: number } | null {
  let r: ReturnType<typeof spawnSync>;
  try {
    r = spawnSync(
      ffprobeCmd,
      ["-v", "quiet", "-print_format", "json", "-show_streams", "-select_streams", "v:0", path],
      { encoding: "utf-8", timeout: 30_000 },
    );
  } catch {
    return null;
  }
  if (r.status !== 0 || typeof r.stdout !== "string") return null;
  const parsed = parseProbeStreams(r.stdout);
  if (!parsed) return null;
  const { width, height } = displayDimensions(parsed);
  return { width, height, rotation: parsed.rotation };
}
