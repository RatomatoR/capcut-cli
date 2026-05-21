import { spawnSync } from "node:child_process";
import { randomUUID as uuid } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Draft, Segment, Track } from "./draft.js";
import { findSegment } from "./draft.js";
import { parseSrt } from "./srt.js";

export interface CaptionOptions {
  audio?: string; // path to audio file; if absent, derived from --from-segment
  fromSegment?: string; // segment ID of an audio segment in the draft to caption
  whisperCmd?: string; // shell-out command; e.g. "whisper" or "whisper-cli" or "faster-whisper"
  whisperModel?: string; // model name; default "base"
  language?: string; // ISO code; default "auto"
  trackName?: string; // default "captions"
  styleRef?: string; // segment ID whose styling to copy
}

export interface CaptionResult {
  ok: boolean;
  cues: number;
  language?: string;
  track_name: string;
  first_cue?: { start_us: number; text: string };
  last_cue?: { start_us: number; text: string };
  source_audio: string;
  engine: "whisper-cli" | "shell" | "openai" | "stdin-srt";
}

/**
 * Generate captions by running whisper on the project's audio and emitting
 * real CapCut caption-track segments (not text-segment mimics — fixes the
 * import-srt pain documented in pyJianYingDraft #148).
 *
 * Whisper integration is shell-out; user supplies the binary path. We support
 * the canonical whisper.cpp output naming convention (`<base>.srt`).
 *
 * Architecture:
 *   1. Resolve audio file (either --audio or extracted from --from-segment)
 *   2. Spawn whisper CLI; capture SRT output
 *   3. Parse SRT into caption cues
 *   4. Create captions track + real subtitle material per cue
 */
export function captionDraft(draft: Draft, opts: CaptionOptions): CaptionResult {
  const audio = resolveAudio(draft, opts);
  const srt = runWhisper(audio, opts);
  const cues = parseSrt(srt);
  if (cues.length === 0) {
    throw new Error("Whisper produced no cues. Check the audio file is not silent and the model name is valid.");
  }

  const trackName = opts.trackName ?? "captions";
  const styleSource = opts.styleRef ? findSegment(draft, opts.styleRef) : null;
  const baseStyle = styleSource ? extractTextStyle(draft, styleSource.segment.material_id) : defaultCaptionStyle();

  let track = draft.tracks.find((t) => t.type === "text" && t.name === trackName);
  if (!track) {
    track = {
      id: uuid(),
      type: "text",
      name: trackName,
      attribute: 0,
      segments: [],
    } as unknown as Track;
    draft.tracks.push(track);
  }

  if (!Array.isArray(draft.materials.texts)) draft.materials.texts = [];

  for (const cue of cues) {
    const matId = uuid();
    const content = JSON.stringify({
      text: cue.text,
      styles: [{ ...baseStyle, range: [0, Buffer.from(cue.text, "utf16le").length] }],
    });
    // Use type: "text" (known-working schema) plus caption-distinguishing fields.
    // import-srt produces text segments WITHOUT sub_type / caption_template_info, so
    // CapCut treats them as inline titles. Setting these fields marks the material as a
    // caption (per pyJianYingDraft #148 discussion) — schema may evolve across versions,
    // verify with `capcut version <project>` after import.
    const textMaterial = {
      id: matId,
      type: "text",
      content,
      font_size: baseStyle.font_size ?? 15,
      text_color: baseStyle.font_color ?? "#FFFFFF",
      alignment: 1,
      sub_type: 1,
      caption_template_info: { category_id: "", category_name: "", effect_id: "", is_new: false, resource_id: "" },
    };
    draft.materials.texts.push(textMaterial as unknown as Draft["materials"]["texts"][number]);

    const seg: Segment = {
      id: uuid(),
      material_id: matId,
      target_timerange: { start: cue.startUs, duration: cue.endUs - cue.startUs },
      source_timerange: { start: 0, duration: cue.endUs - cue.startUs },
      speed: 1,
      volume: 1,
      visible: true,
      clip: { alpha: 1, rotation: 0, scale: { x: 1, y: 1 }, transform: { x: 0, y: -0.6 } },
      extra_material_refs: [],
      render_index: 0,
    } as unknown as Segment;
    track.segments.push(seg);
  }

  return {
    ok: true,
    cues: cues.length,
    track_name: trackName,
    first_cue: { start_us: cues[0].startUs, text: cues[0].text },
    last_cue: { start_us: cues[cues.length - 1].startUs, text: cues[cues.length - 1].text },
    source_audio: audio,
    engine: opts.whisperCmd ? "shell" : "whisper-cli",
  };
}

function resolveAudio(draft: Draft, opts: CaptionOptions): string {
  if (opts.audio) {
    if (!existsSync(opts.audio)) throw new Error(`Audio file not found: ${opts.audio}`);
    return opts.audio;
  }
  if (opts.fromSegment) {
    const found = findSegment(draft, opts.fromSegment);
    if (!found) throw new Error(`Segment not found: ${opts.fromSegment}`);
    if (found.track.type !== "audio")
      throw new Error(`--from-segment must be on an audio track (got ${found.track.type})`);
    const mat = draft.materials.audios.find((m) => m.id === found.segment.material_id);
    if (!mat?.path) throw new Error(`Audio segment ${opts.fromSegment} has no resolvable material path`);
    if (!existsSync(mat.path)) throw new Error(`Audio material path doesn't exist on disk: ${mat.path}`);
    return mat.path;
  }
  throw new Error("Missing --audio <path> or --from-segment <id>. Provide one.");
}

function runWhisper(audio: string, opts: CaptionOptions): string {
  const cmd = opts.whisperCmd ?? "whisper";
  const model = opts.whisperModel ?? "base";
  const language = opts.language ?? "auto";
  const tmpdirPath = mkdtempSync(join(tmpdir(), "capcut-caption-"));
  try {
    // Try the openai-whisper CLI flag shape first (most common installation).
    const r = spawnSync(
      cmd,
      [audio, "--model", model, "--language", language, "--output_format", "srt", "--output_dir", tmpdirPath],
      {
        encoding: "utf-8",
        timeout: 300_000,
      },
    );
    if (r.error || r.status !== 0) {
      const stderr = r.stderr || r.error?.message || `whisper exited ${r.status}`;
      throw new Error(
        `whisper CLI failed: ${stderr}\nTried: ${cmd} ${audio} --model ${model} --language ${language} --output_format srt --output_dir ${tmpdirPath}\n` +
          `Install one of: \`pip install openai-whisper\`, \`brew install whisper-cpp\`, or pass --whisper-cmd <path-to-binary>.`,
      );
    }
    // openai-whisper names output by audio basename + .srt
    const base =
      audio
        .split(/[\\/]/)
        .pop()
        ?.replace(/\.[^.]+$/, "") ?? "audio";
    const srtPath = join(tmpdirPath, `${base}.srt`);
    if (!existsSync(srtPath)) {
      throw new Error(`whisper finished but no SRT found at ${srtPath}. stdout: ${r.stdout?.slice(0, 200)}`);
    }
    return readFileSync(srtPath, "utf-8");
  } finally {
    try {
      rmSync(tmpdirPath, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}

function extractTextStyle(draft: Draft, materialId: string): Record<string, unknown> {
  const mat = draft.materials.texts.find((m) => m.id === materialId);
  if (!mat) return defaultCaptionStyle();
  try {
    const parsed = JSON.parse(mat.content) as { styles?: Array<Record<string, unknown>> };
    if (Array.isArray(parsed.styles) && parsed.styles.length > 0) {
      const s = parsed.styles[0];
      return { ...s, range: undefined };
    }
  } catch {
    /* ignore */
  }
  return defaultCaptionStyle();
}

function defaultCaptionStyle(): Record<string, unknown> {
  return {
    font_color: "#FFFFFF",
    font_size: 15,
    bold: false,
    italic: false,
    underline: false,
  };
}
