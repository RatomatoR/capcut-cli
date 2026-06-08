import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { loadDraft, saveDraft } from "./draft.js";
import { addAudio, addText, addVideo, initDraft } from "./factory.js";

/**
 * Declarative draft compiler: a spec file -> a guaranteed-valid CapCut draft.
 *
 * The inverse of `describe`. Instead of an agent chaining 30 mutating commands
 * (each a place to drift), it emits one declarative spec and `compile` builds
 * the draft atomically via the same proven factory functions the imperative
 * `add-*` commands use. The draft is the compile target.
 *
 * Times in the spec are in SECONDS (human/LLM friendly); they are converted to
 * CapCut's microsecond unit here. Media paths are resolved relative to the spec
 * file's directory unless absolute. The compiler validates the whole spec up
 * front, so a bad path or shape fails before any draft is written.
 *
 * Spec shape (JSON):
 * {
 *   "name": "My Short",
 *   "width": 1080, "height": 1920, "fps": 30, "ratio": "9:16",
 *   "tracks": [
 *     { "type": "video", "items": [
 *       { "path": "clip1.mp4", "start": 0, "duration": 3 },
 *       { "path": "photo.png", "start": 3, "duration": 2, "type": "photo" }
 *     ] },
 *     { "type": "audio", "items": [
 *       { "path": "music.mp3", "start": 0, "duration": 5, "volume": 0.4 }
 *     ] },
 *     { "type": "text", "items": [
 *       { "text": "Hook line", "start": 0, "duration": 2, "fontSize": 18, "color": "#FFD700", "y": -0.6 }
 *     ] }
 *   ]
 * }
 */

const US = 1_000_000;

export interface CompileItem {
  path?: string;
  text?: string;
  start: number; // seconds
  duration?: number; // seconds (video/text required; audio 0 = whole file)
  volume?: number;
  fontSize?: number;
  color?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  type?: "video" | "photo";
}

export interface CompileTrack {
  type: "video" | "audio" | "text";
  name?: string;
  items: CompileItem[];
}

export interface CompileSpec {
  name?: string;
  width?: number;
  height?: number;
  fps?: number;
  ratio?: string;
  tracks: CompileTrack[];
}

export interface CompileOptions {
  templateDir: string; // bundled _init template
  outDir: string; // target draft directory (must not already exist)
  specDir: string; // directory the spec lives in, for relative path resolution
}

export interface CompileResult {
  ok: boolean;
  name: string;
  draft_path: string;
  file_path: string;
  tracks: number;
  segments: number;
  duration_us: number;
  warnings: string[];
}

const VALID_TRACK_TYPES = new Set(["video", "audio", "text"]);

export function parseSpec(raw: string): CompileSpec {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error(`compile: spec is not valid JSON: ${(e as Error).message}`);
  }
  validateSpec(parsed);
  return parsed as CompileSpec;
}

function validateSpec(spec: unknown): asserts spec is CompileSpec {
  if (!spec || typeof spec !== "object") throw new Error("compile: spec must be a JSON object");
  const s = spec as Record<string, unknown>;
  if (!Array.isArray(s.tracks) || s.tracks.length === 0) {
    throw new Error("compile: spec.tracks must be a non-empty array");
  }
  s.tracks.forEach((t, ti) => {
    if (!t || typeof t !== "object") throw new Error(`compile: tracks[${ti}] must be an object`);
    const track = t as Record<string, unknown>;
    if (typeof track.type !== "string" || !VALID_TRACK_TYPES.has(track.type)) {
      throw new Error(`compile: tracks[${ti}].type must be one of video|audio|text (got ${String(track.type)})`);
    }
    if (!Array.isArray(track.items) || track.items.length === 0) {
      throw new Error(`compile: tracks[${ti}].items must be a non-empty array`);
    }
    track.items.forEach((it, ii) => {
      const item = it as Record<string, unknown>;
      const where = `tracks[${ti}].items[${ii}]`;
      if (typeof item.start !== "number" || item.start < 0) {
        throw new Error(`compile: ${where}.start must be a number >= 0 (seconds)`);
      }
      if (track.type === "text") {
        if (typeof item.text !== "string" || item.text.length === 0) {
          throw new Error(`compile: ${where}.text is required for text tracks`);
        }
        if (typeof item.duration !== "number" || item.duration <= 0) {
          throw new Error(`compile: ${where}.duration (seconds) is required for text tracks`);
        }
      } else {
        if (typeof item.path !== "string" || item.path.length === 0) {
          throw new Error(`compile: ${where}.path is required for ${track.type} tracks`);
        }
        if (track.type === "video" && (typeof item.duration !== "number" || item.duration <= 0)) {
          throw new Error(`compile: ${where}.duration (seconds) is required for video tracks`);
        }
      }
    });
  });
}

function resolvePath(p: string, specDir: string): string {
  return isAbsolute(p) ? p : resolve(specDir, p);
}

export function compileDraft(spec: CompileSpec, opts: CompileOptions): CompileResult {
  const warnings: string[] = [];
  // The output DIRECTORY name comes from --out (so the draft lands exactly where
  // the caller asked); the draft's internal display name comes from spec.name.
  // These are independent — conflating them writes to the wrong folder.
  const dirName = basename(opts.outDir);
  const displayName = spec.name ?? dirName;

  // Pre-flight: every media path must exist before we write anything.
  for (const track of spec.tracks) {
    if (track.type === "text") continue;
    for (const item of track.items) {
      const abs = resolvePath(item.path as string, opts.specDir);
      if (!existsSync(abs)) {
        throw new Error(`compile: media file not found: ${item.path} (resolved: ${abs})`);
      }
    }
  }

  // Seed a fresh draft from the bundled template, then populate it.
  const { filePath } = initDraft({ name: dirName, templateDir: opts.templateDir, draftsDir: dirname(opts.outDir) });
  const { draft } = loadDraft(filePath);

  // Canvas + fps from the spec.
  if (spec.width && spec.height) {
    draft.canvas_config = {
      width: spec.width,
      height: spec.height,
      ratio: spec.ratio ?? draft.canvas_config?.ratio ?? "original",
    };
  }
  if (spec.fps) draft.fps = spec.fps;
  draft.name = displayName;

  let segments = 0;
  let maxEnd = 0;

  for (const track of spec.tracks) {
    for (const item of track.items) {
      const start = Math.round(item.start * US);
      const duration = Math.round((item.duration ?? 0) * US);
      if (track.type === "video") {
        addVideo(draft, filePath, {
          path: resolvePath(item.path as string, opts.specDir),
          start,
          duration,
          type: item.type,
          width: item.width,
          height: item.height,
          trackName: track.name,
        });
        maxEnd = Math.max(maxEnd, start + duration);
      } else if (track.type === "audio") {
        addAudio(draft, filePath, {
          path: resolvePath(item.path as string, opts.specDir),
          start,
          duration,
          volume: item.volume,
          trackName: track.name,
        });
        // duration 0 => whole-file; we can't know length without probing, so the
        // draft duration is driven by the explicit-duration segments.
        if (duration > 0) maxEnd = Math.max(maxEnd, start + duration);
      } else {
        addText(draft, filePath, {
          text: item.text as string,
          start,
          duration,
          fontSize: item.fontSize,
          color: item.color,
          x: item.x,
          y: item.y,
          trackName: track.name,
        });
        maxEnd = Math.max(maxEnd, start + duration);
      }
      segments++;
    }
  }

  draft.duration = maxEnd;
  saveDraft(filePath, draft);

  // The _init template ships BOTH draft_content.json and draft_info.json.
  // initDraft populated one of them; mirror the finished draft into the sibling
  // so every downstream command sees the same data regardless of which file it
  // prefers (findDraft prefers draft_content.json; CapCut reads draft_info.json).
  const built = readFileSync(filePath, "utf-8");
  for (const sibling of ["draft_content.json", "draft_info.json"]) {
    const sp = join(opts.outDir, sibling);
    if (sp !== filePath && existsSync(sp)) writeFileSync(sp, built, "utf-8");
  }

  return {
    ok: true,
    name: displayName,
    draft_path: opts.outDir,
    file_path: filePath,
    tracks: spec.tracks.length,
    segments,
    duration_us: maxEnd,
    warnings,
  };
}
