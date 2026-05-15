#!/usr/bin/env node

import { readFileSync, writeFileSync } from "node:fs";
import type {
  ImageAnimOptions,
  KeyframeInput,
  MaskOptions,
  TextAnimOptions,
  TextRangeInput,
  TextStyleOptions,
} from "./decorators.js";
import {
  addImageAnim,
  addKeyframes,
  addMask,
  addTextAnim,
  addTransition,
  imageAnimSlugs,
  keyframeProperties,
  maskSlugs,
  parseKeyframeValue,
  setBgBlur,
  setTextRanges,
  setTextStyle,
  textAnimSlugs,
  transitionSlugs,
} from "./decorators.js";
import type { Draft, Segment, Track } from "./draft.js";
import {
  extractText,
  findMaterial,
  findMaterialGlobal,
  findSegment,
  getMaterialTypes,
  getTracksByType,
  loadDraft,
  saveDraft,
  updateTextContent,
} from "./draft.js";
import { type Category, listEnum, type Namespace } from "./enums.js";
import type { AddAudioOptions, AddTextOptions, AddVideoOptions, CutOptions, InitOptions } from "./factory.js";
import {
  addAudio,
  addEffect,
  addSticker,
  addText,
  addVideo,
  applyTemplate,
  copyTextStyle,
  cutProject,
  effectSlugs,
  initDraft,
  resolveAssetPath,
  saveTemplate,
} from "./factory.js";
import { parseSrt } from "./srt.js";
import { formatDuration, formatTime, parseTimeInput, srtTime } from "./time.js";

const HELP = `capcut-cli -- fast edits to CapCut projects

Usage: capcut <command> <project> [options]

  <project> = path to draft_content.json, draft_info.json, or their parent directory

Global flags:
  -H, --human     Human-readable table output (default: JSON)
  -q, --quiet     No output on success, exit code only (write commands)
  --jianying      Use JianYing enum namespace (default: CapCut) for
                  transition, mask, text-anim, image-anim, add-effect, enums

Overview (start here):
  info       <project>                          Project overview + material summary
  tracks     <project>                          List all tracks
  materials  <project>                          List all material types + counts
  materials  <project> --type <type>            List items of one material type

Browse:
  segments   <project> [--track <type>]         List segments with timing
  texts      <project>                          List all text/subtitle content

Detail (drill into one item):
  segment    <project> <id>                     Full detail for one segment + its material
  material   <project> <id>                     Full detail for one material

Create:
  init       <name> [--template <dir>] [--drafts <dir>]
             Create a new empty draft from template. Defaults:
               --template   ../CapCutAPI/template (relative to capcut-cli)
               --drafts     ~/Movies/CapCut/User Data/Projects/com.lveditor.draft

Add:
  add-audio  <project> <file-or-wikimedia-url> <start> <duration> [options]
             Add an audio segment (VO, music, SFX). URLs to wikipedia.org /
             commons.wikimedia.org / upload.wikimedia.org are resolved via
             the Commons imageinfo API, license-checked, then downloaded to
             assets/audio/wikimedia/. Options:
               --volume <n>       Volume 0.0-1.0 (default: 1.0)
               --track-name <s>   Track name (default: "audio")
               --force-license    Bypass refusal on restrictive/unknown license

  add-video  <project> <file-or-wikimedia-url> <start> <duration> [options]
             Add a video or image segment. Accepts Wikimedia URLs (same as
             add-audio). Type auto-detected from extension.
             Options:
               --track-name <s>   Track name (default: "video")
               --force-license    Bypass refusal on restrictive/unknown license

  add-text   <project> <start> <duration> <text> [options]
             Add a text segment. Options:
               --font-size <n>    Font size (default: 15)
               --color <hex>      Text color (default: #FFFFFF)
               --align <0|1|2>    Left/center/right (default: 1)
               --x <n> --y <n>    Position (-1 to 1, default: 0,0)
               --track-name <s>   Track name (default: "text")

Edit:
  set-text   <project> <id> <text>              Change text content
  shift      <project> <id> <offset>            Shift segment timing (e.g. +0.5s, -1s)
  shift-all  <project> <offset> [--track <type>] Shift all segments on a track
  speed      <project> <id> <multiplier>        Set playback speed
  volume     <project> <id> <level>             Set volume (0.0-1.0)
  trim       <project> <id> <start> <duration>  Trim segment (times in seconds)
  opacity    <project> <id> <alpha>             Set opacity (0.0-1.0)
  export-srt <project>                          Export subtitles to SRT
  batch      <project>                          Run multiple edits from stdin (JSONL)

Animate:
  keyframe   <project> <id> <property> <time> <value>
             Add a keyframe to a segment. Single-shot.
  keyframe   <project> <id> --batch
             Read JSONL from stdin; each line = {"property","time","value"}.
             Properties: position_x, position_y, rotation, scale_x, scale_y,
                         uniform_scale, alpha, saturation, contrast, brightness, volume
             Values: "1.5", "50%" (alpha/volume), "45deg" (rotation),
                     "+0.5"/"-0.3" (saturation/contrast/brightness)

  transition <project> <id> <slug> [--duration <s>]
             Attach a transition to a video/image segment. Slug examples:
               dissolve, rgb-glitch, radial-blur, horizontal-blur, twinkle-zoom,
               urban-glitch, shake-3, vertical-blur-ii
  mask       <project> <id> <slug> [options]  |  <project> <id> --off
             Attach/remove a mask. Slugs: linear, mirror, circle, rectangle,
             heart, star. Options: --center-x --center-y --size --rotation
             --feather --invert --rect-width --round-corner (rect only).
  bg-blur    <project> <id> <1|2|3|4>  |  <project> <id> --off
             Set background blur level (0.0625 / 0.375 / 0.75 / 1.0).
  text-style <project> <id> [options]
             Rich text styling on an existing text segment. Options:
               --alpha --vertical --fixed-width --fixed-height
               --shadow --shadow-alpha --shadow-angle --shadow-color
               --shadow-distance --shadow-smoothing
               --border-width --border-color --border-alpha
               --bg-color --bg-alpha --bg-style --bg-round-radius
               --bg-width --bg-height --bg-h-offset --bg-v-offset
  text-ranges <project> <id> --styles @path.json  |  --styles '<inline-json>'
             Multi-colour text — write multiple styles to one text segment.
             JSON array of { "start": int, "end": int,
               "font_color":"#RRGGBB", "font_size":18, "font_alpha":1,
               "bold":true, "italic":true, "underline":true }.
             start/end are JS string code-unit indices (char-level for BMP).
             Gaps are auto-filled with the baseline style.
  text-anim  <project> <id> [--intro <slug>] [--outro <slug>]
                          [--intro-duration <s>] [--outro-duration <s>]
             Slugs: fade-in, fade-out, typewriter, pop-up, throw-out,
                    blur-text-in, zoom-in-text.
  image-anim <project> <id> [--intro <slug>] [--outro <slug>] [--combo <slug>]
                          [--intro-duration <s>] [--outro-duration <s>]
                          [--combo-duration <s>]
             Video/image intro/outro/combo animations. Slugs:
               fade-in, flash-in, pulsing-zooms, scroll-up, stripe-merge,
               zoom-out (intros); fade-out, blur-out, smoke (outros).

Tracks (Phase 2):
  add-sticker <project> <resource-id> <start> <duration> [options]
             Creates a sticker segment on a sticker track. Options:
               --x <n> --y <n>       Position (-1 to 1)
               --scale <n>           Uniform scale (default 1)
               --rotation <deg>      Clockwise rotation
               --track-name <s>      Sticker track name (default: "sticker")
  add-effect <project> <slug> <start> <duration> [options]
             Scene/character effect on an effect track. Slugs:
               shake, vhs, cinematic, light-leak, film-grain, chromatic,
               vignette.
             Options:
               --params <json-array> Effect parameters (0-100 each)
               --track-name <s>      Effect track name (default: "effect")

Templates:
  save-template <project> <id> <name> --out <path>
             Extract any segment as a reusable template (text, sticker, video, audio)
  apply-template <project> <template.json> <start> <duration> [text override]
             Stamp a template into a project at the given time
             Options: --x <n> --y <n> (override position)

Project:
  cut        <project> <start> <end> --out <path>
             Extract a time range into a new project (long-form → short)

Discovery (Phase 3):
  enums      --transitions | --masks | --image-intros | --image-outros |
             --image-combos | --text-intros | --text-outros |
             --text-loop-anims | --scene-effects | --character-effects |
             --audio-effects | --fonts
             List valid enum slugs (CapCut namespace by default).
             Add --jianying to switch namespace. Use -H for a table.

Subtitles (Phase 3):
  import-srt <project> <srt-path-or--> [options]
             Parse an SRT file and create one text segment per cue.
             Options:
               --track-name <s>      Text track (default: "subtitle")
               --time-offset <s>     Shift all cue timings (e.g. +0.5s)
               --style-ref <seg-id>  Copy styling from an existing text segment
               --font-size --color --align --x --y
               --alpha --vertical --shadow --shadow-color --shadow-distance
               --border-width --border-color --border-alpha
               --bg-color --bg-alpha --bg-style --bg-round-radius --bg-h-offset

Navigation: info → tracks/materials → segments → segment <id>
            info → materials --type X → material <id>
Time formats: 1.5s, 500ms, 1:30, +0.5s, -200ms
IDs: first 6+ chars of segment/material ID (prefix match)

Full viral-shorts pipeline (Claude skill + hooks + templates):
  https://renezander.gumroad.com/l/viral-youtube-shorts-blueprint
Guides & docs:  https://renezander.com/guides/capcut-automation
Sponsor:        https://github.com/sponsors/renezander030
Hire me:        https://renezander.com/contact`;

// --- Flag parsing ---

interface Flags {
  human: boolean;
  quiet: boolean;
  batch: boolean;
  track?: string;
  out?: string;
  fontSize?: number;
  color?: string;
  align?: number;
  x?: number;
  y?: number;
  trackName?: string;
  volume?: number;
  template?: string;
  drafts?: string;
  // Phase 1 decorators
  duration?: string;
  off?: boolean;
  centerX?: number;
  centerY?: number;
  size?: number;
  rotation?: number;
  feather?: number;
  invert?: boolean;
  rectWidth?: number;
  roundCorner?: number;
  // text-style
  alpha?: number;
  vertical?: boolean;
  fixedWidth?: number;
  fixedHeight?: number;
  shadow?: boolean;
  shadowNo?: boolean;
  shadowAlpha?: number;
  shadowAngle?: number;
  shadowColor?: string;
  shadowDistance?: number;
  shadowSmoothing?: number;
  borderWidth?: number;
  borderColor?: string;
  borderAlpha?: number;
  bgColor?: string;
  bgAlpha?: number;
  bgStyle?: number;
  bgRoundRadius?: number;
  bgWidth?: number;
  bgHeight?: number;
  bgHOffset?: number;
  bgVOffset?: number;
  // text-anim / image-anim
  intro?: string;
  outro?: string;
  combo?: string;
  introDuration?: string;
  outroDuration?: string;
  comboDuration?: string;
  // sticker
  scale?: number;
  resourceId?: string;
  // effect
  params?: string;
  // enums
  enumCategory?: Category;
  jianying?: boolean;
  // import-srt
  styleRef?: string;
  timeOffset?: string;
  font?: string;
  // text-ranges
  styles?: string;
  // wikimedia
  forceLicense?: boolean;
}

// Map CLI enum flags -> enums.json category key. Order matters for HELP text.
const ENUM_FLAG_MAP: Array<{ flag: string; category: Category }> = [
  { flag: "--transitions", category: "transitions" },
  { flag: "--masks", category: "masks" },
  { flag: "--image-intros", category: "image_intros" },
  { flag: "--image-outros", category: "image_outros" },
  { flag: "--image-combos", category: "image_combos" },
  { flag: "--text-intros", category: "text_intros" },
  { flag: "--text-outros", category: "text_outros" },
  { flag: "--text-loop-anims", category: "text_loop_anims" },
  { flag: "--scene-effects", category: "scene_effects" },
  { flag: "--character-effects", category: "character_effects" },
  { flag: "--audio-effects", category: "audio_effects" },
  { flag: "--fonts", category: "fonts" },
];

function parseFlags(args: string[]): { positional: string[]; flags: Flags } {
  const positional: string[] = [];
  const flags: Flags = { human: false, quiet: false, batch: false };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "-H" || a === "--human") flags.human = true;
    else if (a === "-q" || a === "--quiet") flags.quiet = true;
    else if (a === "--batch") flags.batch = true;
    else if ((a === "--track" || a === "--type") && i + 1 < args.length) {
      flags.track = args[++i];
    } else if (a === "--out" && i + 1 < args.length) {
      flags.out = args[++i];
    } else if (a === "--font-size" && i + 1 < args.length) {
      flags.fontSize = parseFloat(args[++i]);
    } else if (a === "--color" && i + 1 < args.length) {
      flags.color = args[++i];
    } else if (a === "--align" && i + 1 < args.length) {
      flags.align = parseInt(args[++i]);
    } else if (a === "--x" && i + 1 < args.length) {
      flags.x = parseFloat(args[++i]);
    } else if (a === "--y" && i + 1 < args.length) {
      flags.y = parseFloat(args[++i]);
    } else if (a === "--track-name" && i + 1 < args.length) {
      flags.trackName = args[++i];
    } else if (a === "--volume" && i + 1 < args.length) {
      flags.volume = parseFloat(args[++i]);
    } else if (a === "--template" && i + 1 < args.length) {
      flags.template = args[++i];
    } else if (a === "--drafts" && i + 1 < args.length) {
      flags.drafts = args[++i];
    } else if (a === "--duration" && i + 1 < args.length) {
      flags.duration = args[++i];
    } else if (a === "--off") {
      flags.off = true;
    } else if (a === "--center-x" && i + 1 < args.length) {
      flags.centerX = parseFloat(args[++i]);
    } else if (a === "--center-y" && i + 1 < args.length) {
      flags.centerY = parseFloat(args[++i]);
    } else if (a === "--size" && i + 1 < args.length) {
      flags.size = parseFloat(args[++i]);
    } else if (a === "--rotation" && i + 1 < args.length) {
      flags.rotation = parseFloat(args[++i]);
    } else if (a === "--feather" && i + 1 < args.length) {
      flags.feather = parseFloat(args[++i]);
    } else if (a === "--invert") {
      flags.invert = true;
    } else if (a === "--rect-width" && i + 1 < args.length) {
      flags.rectWidth = parseFloat(args[++i]);
    } else if (a === "--round-corner" && i + 1 < args.length) {
      flags.roundCorner = parseFloat(args[++i]);
    } else if (a === "--alpha" && i + 1 < args.length) {
      flags.alpha = parseFloat(args[++i]);
    } else if (a === "--vertical") {
      flags.vertical = true;
    } else if (a === "--fixed-width" && i + 1 < args.length) {
      flags.fixedWidth = parseFloat(args[++i]);
    } else if (a === "--fixed-height" && i + 1 < args.length) {
      flags.fixedHeight = parseFloat(args[++i]);
    } else if (a === "--shadow") {
      flags.shadow = true;
    } else if (a === "--no-shadow") {
      flags.shadow = false;
    } else if (a === "--shadow-alpha" && i + 1 < args.length) {
      flags.shadowAlpha = parseFloat(args[++i]);
    } else if (a === "--shadow-angle" && i + 1 < args.length) {
      flags.shadowAngle = parseFloat(args[++i]);
    } else if (a === "--shadow-color" && i + 1 < args.length) {
      flags.shadowColor = args[++i];
    } else if (a === "--shadow-distance" && i + 1 < args.length) {
      flags.shadowDistance = parseFloat(args[++i]);
    } else if (a === "--shadow-smoothing" && i + 1 < args.length) {
      flags.shadowSmoothing = parseFloat(args[++i]);
    } else if (a === "--border-width" && i + 1 < args.length) {
      flags.borderWidth = parseFloat(args[++i]);
    } else if (a === "--border-color" && i + 1 < args.length) {
      flags.borderColor = args[++i];
    } else if (a === "--border-alpha" && i + 1 < args.length) {
      flags.borderAlpha = parseFloat(args[++i]);
    } else if (a === "--bg-color" && i + 1 < args.length) {
      flags.bgColor = args[++i];
    } else if (a === "--bg-alpha" && i + 1 < args.length) {
      flags.bgAlpha = parseFloat(args[++i]);
    } else if (a === "--bg-style" && i + 1 < args.length) {
      flags.bgStyle = parseInt(args[++i]);
    } else if (a === "--bg-round-radius" && i + 1 < args.length) {
      flags.bgRoundRadius = parseFloat(args[++i]);
    } else if (a === "--bg-width" && i + 1 < args.length) {
      flags.bgWidth = parseFloat(args[++i]);
    } else if (a === "--bg-height" && i + 1 < args.length) {
      flags.bgHeight = parseFloat(args[++i]);
    } else if (a === "--bg-h-offset" && i + 1 < args.length) {
      flags.bgHOffset = parseFloat(args[++i]);
    } else if (a === "--bg-v-offset" && i + 1 < args.length) {
      flags.bgVOffset = parseFloat(args[++i]);
    } else if (a === "--intro" && i + 1 < args.length) {
      flags.intro = args[++i];
    } else if (a === "--outro" && i + 1 < args.length) {
      flags.outro = args[++i];
    } else if (a === "--intro-duration" && i + 1 < args.length) {
      flags.introDuration = args[++i];
    } else if (a === "--outro-duration" && i + 1 < args.length) {
      flags.outroDuration = args[++i];
    } else if (a === "--combo" && i + 1 < args.length) {
      flags.combo = args[++i];
    } else if (a === "--combo-duration" && i + 1 < args.length) {
      flags.comboDuration = args[++i];
    } else if (a === "--scale" && i + 1 < args.length) {
      flags.scale = parseFloat(args[++i]);
    } else if (a === "--resource-id" && i + 1 < args.length) {
      flags.resourceId = args[++i];
    } else if (a === "--params" && i + 1 < args.length) {
      flags.params = args[++i];
    } else if (a === "--style-ref" && i + 1 < args.length) {
      flags.styleRef = args[++i];
    } else if (a === "--time-offset" && i + 1 < args.length) {
      flags.timeOffset = args[++i];
    } else if (a === "--font" && i + 1 < args.length) {
      flags.font = args[++i];
    } else if (a === "--jianying") {
      flags.jianying = true;
    } else if (a === "--styles" && i + 1 < args.length) {
      flags.styles = args[++i];
    } else if (a === "--force-license") {
      flags.forceLicense = true;
    } else {
      const hit = ENUM_FLAG_MAP.find((f) => f.flag === a);
      if (hit) {
        flags.enumCategory = hit.category;
      } else positional.push(a);
    }
  }
  return { positional, flags };
}

// --- Output ---

function out(data: unknown, flags: Flags): void {
  if (flags.quiet) return;
  process.stdout.write(JSON.stringify(data) + "\n");
}

class CliError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "CliError";
  }
}

function die(msg: string): never {
  throw new CliError(msg);
}

function requireArgs(args: string[], min: number, usage: string): void {
  if (args.length < min) die(`Missing arguments. Usage: ${usage}`);
}

// --- Commands ---

function cmdInfo(draft: Draft, flags: Flags): void {
  const totalSegments = draft.tracks.reduce((n, t) => n + t.segments.length, 0);
  const matTypes = getMaterialTypes(draft);
  const matWithItems = matTypes.filter((m) => m.count > 0);
  const data = {
    id: draft.id,
    name: draft.name || draft.id,
    duration_us: draft.duration,
    fps: draft.fps,
    width: draft.canvas_config.width,
    height: draft.canvas_config.height,
    ratio: draft.canvas_config.ratio,
    tracks: draft.tracks.length,
    segments: totalSegments,
    platform: draft.platform
      ? `${draft.platform.app_source === "cc" ? "CapCut" : "JianYing"} ${draft.platform.app_version}`
      : null,
    material_types: matTypes.length,
    materials_with_items: matWithItems.length,
    material_summary: matWithItems.map((m) => ({ type: m.type, count: m.count })),
  };
  if (flags.human) {
    const d = data;
    console.log(`Project:    ${d.name}`);
    console.log(`Duration:   ${formatDuration(d.duration_us)}`);
    console.log(`Resolution: ${d.width}x${d.height} (${d.ratio})`);
    console.log(`FPS:        ${d.fps}`);
    console.log(`Tracks:     ${d.tracks}`);
    console.log(`Segments:   ${d.segments}`);
    if (d.platform) console.log(`Platform:   ${d.platform}`);
    console.log(`Materials:  ${d.materials_with_items} types with data (${d.material_types} total)`);
    for (const m of d.material_summary) {
      console.log(`  ${m.type.padEnd(28)} ${m.count}`);
    }
  } else {
    out(data, flags);
  }
}

function cmdTracks(draft: Draft, flags: Flags): void {
  const data = draft.tracks.map((t, i) => {
    const end = t.segments.reduce((max, s) => {
      const e = s.target_timerange.start + s.target_timerange.duration;
      return e > max ? e : max;
    }, 0);
    return {
      index: i,
      id: t.id,
      type: t.type,
      name: t.name,
      segments: t.segments.length,
      duration_us: end,
      muted: !!(t.attribute & 1),
      hidden: !!(t.attribute & 2),
      locked: !!(t.attribute & 4),
    };
  });
  if (flags.human) {
    console.log(`#   Type     Name           Segs    Duration`);
    for (const t of data) {
      const fl: string[] = [];
      if (t.muted) fl.push("muted");
      if (t.hidden) fl.push("hidden");
      if (t.locked) fl.push("locked");
      console.log(
        `${String(t.index).padStart(2)}  ${t.type.padEnd(8)} ${t.name.padEnd(14)} ${String(t.segments).padStart(4)} segs  ${formatDuration(t.duration_us).padStart(10)}${fl.length ? "  [" + fl.join(",") + "]" : ""}`,
      );
    }
  } else {
    out(data, flags);
  }
}

function segmentData(draft: Draft, track: Track, seg: Segment) {
  const t = seg.target_timerange;
  let label = "";
  if (track.type === "text") {
    const mat = findMaterial(draft.materials.texts, seg.material_id);
    if (mat) label = extractText(mat.content);
  } else if (track.type === "video") {
    const mat = findMaterial(draft.materials.videos, seg.material_id);
    if (mat) label = mat.material_name;
  } else if (track.type === "audio") {
    const mat = findMaterial(draft.materials.audios, seg.material_id);
    if (mat) label = mat.name || "";
  }
  return {
    id: seg.id,
    type: track.type,
    start_us: t.start,
    duration_us: t.duration,
    speed: seg.speed,
    volume: seg.volume,
    opacity: seg.clip?.alpha ?? 1,
    label,
  };
}

function cmdSegments(draft: Draft, flags: Flags): void {
  const tracks = flags.track ? getTracksByType(draft, flags.track) : draft.tracks;
  if (tracks.length === 0) die(`No tracks of type "${flags.track}"`);
  const data = tracks.flatMap((track) => track.segments.map((seg) => segmentData(draft, track, seg)));
  if (flags.human) {
    console.log(`ID        Type   Start   -End         Dur   Spd  Label`);
    for (const s of data) {
      const end = s.start_us + s.duration_us;
      console.log(
        `${s.id.slice(0, 8)}  ${s.type.padEnd(6)} ${formatTime(s.start_us).padStart(8)}-${formatTime(end).padStart(8)}  ${formatDuration(s.duration_us).padStart(8)}  ${s.speed !== 1 ? s.speed + "x" : "   "}  ${s.label.slice(0, 40)}`,
      );
    }
  } else {
    out(data, flags);
  }
}

function cmdTexts(draft: Draft, flags: Flags): void {
  const textTracks = getTracksByType(draft, "text");
  const data = textTracks.flatMap((track) =>
    track.segments.map((seg) => {
      const mat = findMaterial(draft.materials.texts, seg.material_id);
      const t = seg.target_timerange;
      return {
        id: seg.id,
        start_us: t.start,
        duration_us: t.duration,
        text: mat ? extractText(mat.content) : "",
      };
    }),
  );
  if (flags.human) {
    if (data.length === 0) {
      console.log("No text segments found.");
      return;
    }
    console.log(`ID        Start   -End       Text`);
    for (const s of data) {
      console.log(
        `${s.id.slice(0, 8)}  ${formatTime(s.start_us).padStart(8)}-${formatTime(s.start_us + s.duration_us).padStart(8)}  ${s.text}`,
      );
    }
  } else {
    out(data, flags);
  }
}

function cmdSetText(draft: Draft, filePath: string, segId: string, newText: string, flags: Flags, save = true): void {
  const result = findSegment(draft, segId);
  if (!result) die(`Segment not found: ${segId}`);
  const mat = findMaterial(draft.materials.texts, result.segment.material_id);
  if (!mat) die(`Text material not found for segment ${segId}`);
  const oldText = extractText(mat.content);
  mat.content = updateTextContent(mat.content, newText);
  if (save) saveDraft(filePath, draft);
  out({ ok: true, id: result.segment.id, old: oldText, new: newText }, flags);
}

function cmdShift(draft: Draft, filePath: string, segId: string, offsetStr: string, flags: Flags, save = true): void {
  const result = findSegment(draft, segId);
  if (!result) die(`Segment not found: ${segId}`);
  const offset = parseTimeInput(offsetStr);
  const seg = result.segment;
  const oldStart = seg.target_timerange.start;
  seg.target_timerange.start = Math.max(0, oldStart + offset);
  if (save) saveDraft(filePath, draft);
  out({ ok: true, id: seg.id, old_start_us: oldStart, new_start_us: seg.target_timerange.start }, flags);
}

function cmdShiftAll(draft: Draft, filePath: string, offsetStr: string, flags: Flags, save = true): void {
  const offset = parseTimeInput(offsetStr);
  const tracks = flags.track ? getTracksByType(draft, flags.track) : draft.tracks;
  let count = 0;
  for (const track of tracks) {
    for (const seg of track.segments) {
      seg.target_timerange.start = Math.max(0, seg.target_timerange.start + offset);
      count++;
    }
  }
  if (save) saveDraft(filePath, draft);
  out({ ok: true, shifted: count, offset_us: offset }, flags);
}

function cmdSpeed(draft: Draft, filePath: string, segId: string, multiplier: string, flags: Flags, save = true): void {
  const result = findSegment(draft, segId);
  if (!result) die(`Segment not found: ${segId}`);
  const speed = parseFloat(multiplier);
  if (isNaN(speed) || speed <= 0) die("Speed must be a positive number");
  const seg = result.segment;
  const oldSpeed = seg.speed;
  seg.speed = speed;
  seg.source_timerange.duration = Math.round(seg.target_timerange.duration * speed);
  for (const refId of seg.extra_material_refs) {
    const speedMat = findMaterial(draft.materials.speeds, refId);
    if (speedMat) speedMat.speed = speed;
  }
  if (save) saveDraft(filePath, draft);
  out({ ok: true, id: seg.id, old_speed: oldSpeed, new_speed: speed }, flags);
}

function cmdVolume(draft: Draft, filePath: string, segId: string, levelStr: string, flags: Flags, save = true): void {
  const result = findSegment(draft, segId);
  if (!result) die(`Segment not found: ${segId}`);
  const level = parseFloat(levelStr);
  if (isNaN(level) || level < 0) die("Volume must be >= 0");
  const old = result.segment.volume;
  result.segment.volume = level;
  if (save) saveDraft(filePath, draft);
  out({ ok: true, id: result.segment.id, old_volume: old, new_volume: level }, flags);
}

function cmdTrim(
  draft: Draft,
  filePath: string,
  segId: string,
  startStr: string,
  durationStr: string,
  flags: Flags,
  save = true,
): void {
  const result = findSegment(draft, segId);
  if (!result) die(`Segment not found: ${segId}`);
  const start = parseTimeInput(startStr);
  const duration = parseTimeInput(durationStr);
  const seg = result.segment;
  seg.source_timerange.start = start;
  seg.source_timerange.duration = duration;
  seg.target_timerange.duration = Math.round(duration / seg.speed);
  if (save) saveDraft(filePath, draft);
  out(
    {
      ok: true,
      id: seg.id,
      source_start_us: start,
      source_duration_us: duration,
      target_duration_us: seg.target_timerange.duration,
    },
    flags,
  );
}

function cmdOpacity(draft: Draft, filePath: string, segId: string, alphaStr: string, flags: Flags, save = true): void {
  const result = findSegment(draft, segId);
  if (!result) die(`Segment not found: ${segId}`);
  const alpha = parseFloat(alphaStr);
  if (isNaN(alpha) || alpha < 0 || alpha > 1) die("Opacity must be 0.0-1.0");
  if (!result.segment.clip) die(`Segment ${segId} has no clip (audio segment?)`);
  const old = result.segment.clip.alpha;
  result.segment.clip.alpha = alpha;
  if (save) saveDraft(filePath, draft);
  out({ ok: true, id: result.segment.id, old_opacity: old, new_opacity: alpha }, flags);
}

function cmdExportSrt(draft: Draft): void {
  const textTracks = getTracksByType(draft, "text");
  const entries: Array<{ start: number; end: number; text: string }> = [];
  for (const track of textTracks) {
    for (const seg of track.segments) {
      const mat = findMaterial(draft.materials.texts, seg.material_id);
      if (!mat) continue;
      const t = seg.target_timerange;
      entries.push({ start: t.start, end: t.start + t.duration, text: extractText(mat.content) });
    }
  }
  entries.sort((a, b) => a.start - b.start);
  const srt = entries.map((e, i) => `${i + 1}\n${srtTime(e.start)} --> ${srtTime(e.end)}\n${e.text}\n`).join("\n");
  process.stdout.write(srt);
}

// --- Discovery & drill-down ---

function cmdMaterials(draft: Draft, flags: Flags): void {
  const matTypes = getMaterialTypes(draft);
  if (flags.track) {
    // --type filter: list items of that material type
    const key = flags.track; // reuse --track flag as --type
    const arr = draft.materials[key];
    if (!arr || !Array.isArray(arr)) die(`Unknown material type: ${key}`);
    const items = arr.map((m: Record<string, unknown>) => {
      const summary: Record<string, unknown> = { id: m.id };
      if (m.name !== undefined) summary.name = m.name;
      if (m.material_name !== undefined) summary.name = m.material_name;
      if (m.path !== undefined) summary.path = m.path;
      if (m.duration !== undefined) summary.duration_us = m.duration;
      if (m.type !== undefined) summary.type = m.type;
      summary.fields = Object.keys(m).length;
      return summary;
    });
    if (flags.human) {
      if (items.length === 0) {
        console.log(`No ${key} materials.`);
        return;
      }
      console.log(`ID        Name/Path                                    Fields`);
      for (const item of items) {
        const label = (item.name || item.path || "") as string;
        console.log(
          `${(item.id as string).slice(0, 8)}  ${label.slice(0, 44).padEnd(44)} ${String(item.fields).padStart(3)}`,
        );
      }
    } else {
      out(items, flags);
    }
    return;
  }
  if (flags.human) {
    console.log(`Type                          Count`);
    for (const m of matTypes) {
      console.log(`${m.type.padEnd(28)} ${String(m.count).padStart(5)}`);
    }
  } else {
    out(matTypes, flags);
  }
}

function cmdSegmentDetail(draft: Draft, segId: string, flags: Flags): void {
  const result = findSegment(draft, segId);
  if (!result) die(`Segment not found: ${segId}`);
  const seg = result.segment;
  // Resolve the primary material
  const mat = findMaterialGlobal(draft, seg.material_id);
  const detail = {
    ...seg,
    _track_type: result.track.type,
    _track_name: result.track.name,
    _track_id: result.track.id,
    _material: mat ? { _type: mat.type, ...mat.material } : null,
  };
  if (flags.human) {
    console.log(JSON.stringify(detail, null, 2));
  } else {
    out(detail, flags);
  }
}

function cmdMaterialDetail(draft: Draft, matId: string, flags: Flags): void {
  const result = findMaterialGlobal(draft, matId);
  if (!result) die(`Material not found: ${matId}`);
  const detail = { _type: result.type, ...result.material };
  if (flags.human) {
    console.log(JSON.stringify(detail, null, 2));
  } else {
    out(detail, flags);
  }
}

// --- Add commands ---

async function cmdAddAudio(draft: Draft, filePath: string, positional: string[], flags: Flags): Promise<void> {
  const audioPath = positional[2];
  const startStr = positional[3];
  const durationStr = positional[4];
  if (!audioPath || !startStr || !durationStr)
    die("Usage: capcut add-audio <project> <file-or-wikimedia-url> <start> <duration>");
  // Wikimedia URLs go through the license-gated fetcher; locals pass through.
  const { localPath, asset, warning } = await resolveAssetPath(audioPath, filePath, "audio", flags.forceLicense);
  const absPath = localPath.startsWith("/") ? localPath : process.cwd() + "/" + localPath;
  const start = parseTimeInput(startStr);
  const duration = parseTimeInput(durationStr);
  const opts: AddAudioOptions = {
    path: absPath,
    start,
    duration,
    volume: flags.volume,
    trackName: flags.trackName,
  };
  const result = addAudio(draft, filePath, opts);
  saveDraft(filePath, draft);
  const payload: Record<string, unknown> = {
    ok: true,
    segment_id: result.segmentId,
    material_id: result.materialId,
    track_id: result.trackId,
    path: absPath,
    start_us: start,
    duration_us: duration,
  };
  if (asset) {
    payload.wikimedia = {
      file_title: asset.fileTitle,
      license: asset.license.raw,
      license_class: asset.license.class,
      artist: asset.license.artist,
      credit: asset.license.credit,
      description_url: asset.descriptionUrl,
    };
  }
  if (warning) payload.warning = warning;
  out(payload, flags);
}

async function cmdAddVideo(draft: Draft, filePath: string, positional: string[], flags: Flags): Promise<void> {
  const videoPath = positional[2];
  const startStr = positional[3];
  const durationStr = positional[4];
  if (!videoPath || !startStr || !durationStr)
    die("Usage: capcut add-video <project> <file-or-wikimedia-url> <start> <duration>");
  const { localPath, asset, warning } = await resolveAssetPath(videoPath, filePath, "video", flags.forceLicense);
  const absPath = localPath.startsWith("/") ? localPath : process.cwd() + "/" + localPath;
  const start = parseTimeInput(startStr);
  const duration = parseTimeInput(durationStr);
  const opts: AddVideoOptions = {
    path: absPath,
    start,
    duration,
    trackName: flags.trackName,
  };
  const result = addVideo(draft, filePath, opts);
  saveDraft(filePath, draft);
  const payload: Record<string, unknown> = {
    ok: true,
    segment_id: result.segmentId,
    material_id: result.materialId,
    track_id: result.trackId,
    path: absPath,
    start_us: start,
    duration_us: duration,
  };
  if (asset) {
    payload.wikimedia = {
      file_title: asset.fileTitle,
      license: asset.license.raw,
      license_class: asset.license.class,
      artist: asset.license.artist,
      credit: asset.license.credit,
      description_url: asset.descriptionUrl,
      width: asset.width,
      height: asset.height,
      mime: asset.mime,
    };
  }
  if (warning) payload.warning = warning;
  out(payload, flags);
}

function cmdAddText(draft: Draft, filePath: string, positional: string[], flags: Flags): void {
  const startStr = positional[2];
  const durationStr = positional[3];
  const text = positional.slice(4).join(" ");
  if (!text) die("Missing text. Usage: capcut add-text <project> <start> <duration> <text>");
  const start = parseTimeInput(startStr);
  const duration = parseTimeInput(durationStr);
  const opts: AddTextOptions = {
    text,
    start,
    duration,
    fontSize: flags.fontSize,
    color: flags.color,
    alignment: flags.align,
    x: flags.x,
    y: flags.y,
    trackName: flags.trackName,
  };
  const result = addText(draft, filePath, opts);
  saveDraft(filePath, draft);
  out(
    {
      ok: true,
      segment_id: result.segmentId,
      material_id: result.materialId,
      track_id: result.trackId,
      text,
      start_us: start,
      duration_us: duration,
    },
    flags,
  );
}

function cmdKeyframe(draft: Draft, filePath: string, positional: string[], flags: Flags): void {
  const segId = positional[2];
  if (!segId) die("Usage: capcut keyframe <project> <id> <property> <time> <value>  (or --batch with JSONL on stdin)");

  const inputs: KeyframeInput[] = [];

  if (flags.batch) {
    const raw = readFileSync("/dev/stdin", "utf-8").trim();
    if (!raw) die("No input on stdin for --batch");
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const op = JSON.parse(trimmed) as { property?: string; time?: string | number; value?: string | number };
      if (!op.property || op.time === undefined || op.value === undefined) {
        die(`batch keyframe requires {property, time, value} per line; got: ${trimmed}`);
      }
      const timeUs = typeof op.time === "number" ? op.time : parseTimeInput(op.time);
      const value = parseKeyframeValue(op.property, String(op.value));
      inputs.push({ property: op.property, timeUs, value });
    }
  } else {
    const property = positional[3];
    const timeStr = positional[4];
    const valueStr = positional[5];
    if (!property || !timeStr || valueStr === undefined) {
      die(
        `Usage: capcut keyframe <project> <id> <property> <time> <value>\nProperties: ${keyframeProperties().join(", ")}`,
      );
    }
    const timeUs = parseTimeInput(timeStr);
    const value = parseKeyframeValue(property, valueStr);
    inputs.push({ property, timeUs, value });
  }

  const result = addKeyframes(draft, segId, inputs);
  saveDraft(filePath, draft);
  out({ ok: true, id: result.segmentId, added: result.added, lists: result.lists }, flags);
}

function cmdTransition(draft: Draft, filePath: string, positional: string[], flags: Flags): void {
  const segId = positional[2];
  const slug = positional[3];
  const ns: Namespace = flags.jianying ? "jianying" : "capcut";
  if (!segId || !slug)
    die(
      `Usage: capcut transition <project> <id> <slug> [--duration <s>] [--jianying]\nSlugs: capcut enums --transitions${ns === "jianying" ? " --jianying" : ""}`,
    );
  const durUs = flags.duration ? parseTimeInput(flags.duration) : undefined;
  const result = addTransition(draft, segId, slug, durUs, ns);
  saveDraft(filePath, draft);
  out({ ok: true, ...result }, flags);
}

function cmdMask(draft: Draft, filePath: string, positional: string[], flags: Flags): void {
  const segId = positional[2];
  const slug = positional[3];
  const ns: Namespace = flags.jianying ? "jianying" : "capcut";
  if (!segId) die(`Usage: capcut mask <project> <id> <slug> [flags]  |  --off\nSlugs: ${maskSlugs(ns).join(", ")}`);
  if (flags.off) {
    const found = findSegment(draft, segId);
    if (!found) die(`Segment not found: ${segId}`);
    const seg = found.segment;
    const masksArr = (draft.materials.common_mask || []) as Array<Record<string, unknown>>;
    const before = (seg.extra_material_refs || []).length;
    seg.extra_material_refs = (seg.extra_material_refs || []).filter(
      (r) => !masksArr.some((m) => (m as { id?: string }).id === r),
    );
    saveDraft(filePath, draft);
    out({ ok: true, id: seg.id, removed: before - (seg.extra_material_refs || []).length }, flags);
    return;
  }
  if (!slug) die(`Usage: capcut mask <project> <id> <slug> [flags]\nSlugs: ${maskSlugs(ns).join(", ")}`);
  const opts: MaskOptions = {
    centerX: flags.centerX,
    centerY: flags.centerY,
    size: flags.size,
    rotation: flags.rotation,
    feather: flags.feather,
    invert: flags.invert,
    rectWidth: flags.rectWidth,
    roundCorner: flags.roundCorner,
  };
  const result = addMask(draft, segId, slug, opts, ns);
  saveDraft(filePath, draft);
  out({ ok: true, ...result }, flags);
}

function cmdBgBlur(draft: Draft, filePath: string, positional: string[], flags: Flags): void {
  const segId = positional[2];
  const arg = positional[3];
  if (!segId) die(`Usage: capcut bg-blur <project> <id> <1|2|3|4>  |  --off`);
  let level: 1 | 2 | 3 | 4 | "off";
  if (flags.off) level = "off";
  else {
    const n = parseInt(arg ?? "");
    if (![1, 2, 3, 4].includes(n)) die(`bg-blur level must be 1, 2, 3, or 4 (or --off)`);
    level = n as 1 | 2 | 3 | 4;
  }
  const result = setBgBlur(draft, segId, level);
  saveDraft(filePath, draft);
  out({ ok: true, ...result }, flags);
}

function cmdTextStyle(draft: Draft, filePath: string, positional: string[], flags: Flags): void {
  const segId = positional[2];
  if (!segId) die(`Usage: capcut text-style <project> <id> [flags]`);
  const opts: TextStyleOptions = {
    alpha: flags.alpha,
    vertical: flags.vertical,
    fixedWidth: flags.fixedWidth,
    fixedHeight: flags.fixedHeight,
    shadow: flags.shadow,
    shadowAlpha: flags.shadowAlpha,
    shadowAngle: flags.shadowAngle,
    shadowColor: flags.shadowColor,
    shadowDistance: flags.shadowDistance,
    shadowSmoothing: flags.shadowSmoothing,
    borderWidth: flags.borderWidth,
    borderColor: flags.borderColor,
    borderAlpha: flags.borderAlpha,
    bgColor: flags.bgColor,
    bgAlpha: flags.bgAlpha,
    bgStyle: flags.bgStyle,
    bgRoundRadius: flags.bgRoundRadius,
    bgWidth: flags.bgWidth,
    bgHeight: flags.bgHeight,
    bgHOffset: flags.bgHOffset,
    bgVOffset: flags.bgVOffset,
  };
  const result = setTextStyle(draft, segId, opts);
  if (result.applied.length === 0) die(`No styling flags provided. See 'capcut --help'.`);
  saveDraft(filePath, draft);
  out({ ok: true, id: segId, material_id: result.materialId, applied: result.applied }, flags);
}

function cmdTextAnim(draft: Draft, filePath: string, positional: string[], flags: Flags): void {
  const segId = positional[2];
  const ns: Namespace = flags.jianying ? "jianying" : "capcut";
  if (!segId)
    die(
      `Usage: capcut text-anim <project> <id> [--intro <slug>] [--outro <slug>] [--jianying]\nFeatured slugs: ${textAnimSlugs().join(", ")}`,
    );
  const opts: TextAnimOptions = {
    intro: flags.intro,
    outro: flags.outro,
    introDurationUs: flags.introDuration ? parseTimeInput(flags.introDuration) : undefined,
    outroDurationUs: flags.outroDuration ? parseTimeInput(flags.outroDuration) : undefined,
  };
  const result = addTextAnim(draft, segId, opts, ns);
  saveDraft(filePath, draft);
  out({ ok: true, ...result }, flags);
}

function cmdAddSticker(draft: Draft, filePath: string, positional: string[], flags: Flags): void {
  const resId = positional[2];
  const startStr = positional[3];
  const durStr = positional[4];
  if (!resId || !startStr || !durStr)
    die(`Usage: capcut add-sticker <project> <resource-id> <start> <duration> [flags]`);
  const start = parseTimeInput(startStr);
  const duration = parseTimeInput(durStr);
  const result = addSticker(draft, {
    resourceId: resId,
    start,
    duration,
    x: flags.x,
    y: flags.y,
    scale: flags.scale,
    rotation: flags.rotation,
    trackName: flags.trackName,
  });
  saveDraft(filePath, draft);
  out({ ok: true, ...result, start_us: start, duration_us: duration }, flags);
}

function cmdAddEffect(draft: Draft, filePath: string, positional: string[], flags: Flags): void {
  const slug = positional[2];
  const startStr = positional[3];
  const durStr = positional[4];
  const ns: Namespace = flags.jianying ? "jianying" : "capcut";
  if (!slug || !startStr || !durStr)
    die(
      `Usage: capcut add-effect <project> <slug> <start> <duration> [--params <json-array>] [--jianying]\nFeatured slugs: ${effectSlugs().join(", ")}`,
    );
  const start = parseTimeInput(startStr);
  const duration = parseTimeInput(durStr);
  let params: number[] | undefined;
  if (flags.params) {
    const parsed = JSON.parse(flags.params);
    if (!Array.isArray(parsed)) die(`--params must be a JSON array of numbers`);
    params = parsed.map((v) => Number(v));
  }
  const result = addEffect(draft, { slug, start, duration, params, trackName: flags.trackName, namespace: ns });
  saveDraft(filePath, draft);
  out({ ok: true, ...result, start_us: start, duration_us: duration }, flags);
}

function cmdImageAnim(draft: Draft, filePath: string, positional: string[], flags: Flags): void {
  const segId = positional[2];
  const ns: Namespace = flags.jianying ? "jianying" : "capcut";
  if (!segId)
    die(
      `Usage: capcut image-anim <project> <id> [--intro <slug>] [--outro <slug>] [--combo <slug>] [--jianying]\nFeatured slugs: ${imageAnimSlugs().join(", ")}`,
    );
  const opts: ImageAnimOptions = {
    intro: flags.intro,
    outro: flags.outro,
    combo: flags.combo,
    introDurationUs: flags.introDuration ? parseTimeInput(flags.introDuration) : undefined,
    outroDurationUs: flags.outroDuration ? parseTimeInput(flags.outroDuration) : undefined,
    comboDurationUs: flags.comboDuration ? parseTimeInput(flags.comboDuration) : undefined,
  };
  const result = addImageAnim(draft, segId, opts, ns);
  saveDraft(filePath, draft);
  out({ ok: true, ...result }, flags);
}

function cmdCut(draft: Draft, filePath: string, positional: string[], flags: Flags): void {
  if (!flags.out) die("Missing --out <path>. Usage: capcut cut <project> <start> <end> --out <path>");
  const start = parseTimeInput(positional[2]);
  const end = parseTimeInput(positional[3]);
  if (end <= start) die("End time must be after start time");
  const opts: CutOptions = { start, end };
  const result = cutProject(draft, opts);
  // Write to new file (not in-place)
  const indent = 0;
  writeFileSync(flags.out, JSON.stringify(draft, null, indent), "utf-8");
  out({ ok: true, kept: result.kept, removed: result.removed, duration_us: end - start, out: flags.out }, flags);
}

// --- Templates ---

function cmdSaveTemplate(draft: Draft, positional: string[], flags: Flags): void {
  const segId = positional[2];
  const name = positional[3];
  if (!flags.out) die("Missing --out <path>. Usage: capcut save-template <project> <id> <name> --out <path>");
  const template = saveTemplate(draft, segId, name, flags.out);
  out(
    {
      ok: true,
      name: template.name,
      type: template.type,
      material_type: template.material.type,
      extra_materials: template.extra_materials.length,
      out: flags.out,
    },
    flags,
  );
}

function cmdApplyTemplate(draft: Draft, filePath: string, positional: string[], flags: Flags): void {
  const templatePath = positional[2];
  const startStr = positional[3];
  const durationStr = positional[4];
  const start = parseTimeInput(startStr);
  const duration = parseTimeInput(durationStr);
  const textOverride = positional.length > 5 ? positional.slice(5).join(" ") : undefined;
  const result = applyTemplate(draft, templatePath, start, duration, {
    x: flags.x,
    y: flags.y,
    text: textOverride,
  });
  saveDraft(filePath, draft);
  out(
    {
      ok: true,
      segment_id: result.segmentId,
      material_id: result.materialId,
      track_id: result.trackId,
      start_us: start,
      duration_us: duration,
    },
    flags,
  );
}

// --- Phase 4: multi-style text ranges ---

function cmdTextRanges(draft: Draft, filePath: string, positional: string[], flags: Flags): void {
  const segId = positional[2];
  if (!segId) die(`Usage: capcut text-ranges <project> <id> --styles @path.json  (or --styles '<inline-json>')`);
  if (!flags.styles) die(`Missing --styles. Accepts @path.json or inline JSON array.`);
  let raw = flags.styles;
  if (raw.startsWith("@")) {
    raw = readFileSync(raw.slice(1), "utf-8");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    die(`--styles is not valid JSON: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!Array.isArray(parsed)) die(`--styles must be a JSON array of {start,end,...} ranges`);
  const ranges = parsed as TextRangeInput[];
  const result = setTextRanges(draft, segId, ranges);
  saveDraft(filePath, draft);
  out({ ok: true, ...result }, flags);
}

// --- Phase 3: enums + import-srt ---

function cmdEnums(flags: Flags): void {
  if (!flags.enumCategory) {
    const flagList = ENUM_FLAG_MAP.map((f) => f.flag).join(" | ");
    die(`Usage: capcut enums <flag> [--jianying] [-H]\nFlags: ${flagList}`);
  }
  const ns: Namespace = flags.jianying ? "jianying" : "capcut";
  const entries = listEnum(flags.enumCategory, ns);
  if (flags.human) {
    if (entries.length === 0) {
      console.log(`No ${flags.enumCategory} in ${ns} namespace.`);
      return;
    }
    console.log(`Slug                              Name                             Member`);
    for (const e of entries) {
      const display = (e.name ?? e.title ?? "") as string;
      console.log(`${(e.slug || "(non-ascii)").padEnd(33)} ${display.slice(0, 32).padEnd(32)} ${e.member}`);
    }
    process.stderr.write(`\n${entries.length} ${flags.enumCategory} (${ns})\n`);
  } else {
    out(entries, flags);
  }
}

function cmdImportSrt(draft: Draft, filePath: string, positional: string[], flags: Flags): void {
  const srtArg = positional[2];
  if (!srtArg) die(`Usage: capcut import-srt <project> <srt-path-or-->`);
  let srtContent: string;
  if (srtArg === "-") {
    srtContent = readFileSync("/dev/stdin", "utf-8");
  } else {
    srtContent = readFileSync(srtArg, "utf-8");
  }

  const cues = parseSrt(srtContent);
  if (cues.length === 0) die(`SRT produced 0 cues`);

  const offsetUs = flags.timeOffset ? parseTimeInput(flags.timeOffset) : 0;

  // Resolve the style-ref segment once, before writing anything, so a bad ref
  // fails fast instead of halfway through a 200-cue import.
  if (flags.styleRef) {
    const ref = findSegment(draft, flags.styleRef);
    if (!ref) die(`Style-ref segment not found: ${flags.styleRef}`);
  }

  const styleOpts: TextStyleOptions = {
    alpha: flags.alpha,
    vertical: flags.vertical,
    fixedWidth: flags.fixedWidth,
    fixedHeight: flags.fixedHeight,
    shadow: flags.shadow,
    shadowAlpha: flags.shadowAlpha,
    shadowAngle: flags.shadowAngle,
    shadowColor: flags.shadowColor,
    shadowDistance: flags.shadowDistance,
    shadowSmoothing: flags.shadowSmoothing,
    borderWidth: flags.borderWidth,
    borderColor: flags.borderColor,
    borderAlpha: flags.borderAlpha,
    bgColor: flags.bgColor,
    bgAlpha: flags.bgAlpha,
    bgStyle: flags.bgStyle,
    bgRoundRadius: flags.bgRoundRadius,
    bgWidth: flags.bgWidth,
    bgHeight: flags.bgHeight,
    bgHOffset: flags.bgHOffset,
    bgVOffset: flags.bgVOffset,
  };
  const hasStyleFlags = Object.values(styleOpts).some((v) => v !== undefined);

  const created: Array<{ id: string; start_us: number; duration_us: number; text: string }> = [];
  for (const cue of cues) {
    const start = cue.startUs + offsetUs;
    const duration = cue.endUs - cue.startUs;
    if (start < 0) die(`Cue ${cue.index} has negative start after --time-offset (${start}us)`);
    const opts: AddTextOptions = {
      text: cue.text,
      start,
      duration,
      fontSize: flags.fontSize,
      color: flags.color,
      alignment: flags.align,
      x: flags.x,
      y: flags.y,
      trackName: flags.trackName ?? "subtitle",
    };
    const res = addText(draft, filePath, opts);
    if (flags.styleRef) copyTextStyle(draft, flags.styleRef, res.materialId);
    if (hasStyleFlags) setTextStyle(draft, res.segmentId, styleOpts);
    created.push({ id: res.segmentId, start_us: start, duration_us: duration, text: cue.text });
  }

  saveDraft(filePath, draft);
  out(
    {
      ok: true,
      cues: created.length,
      track_name: flags.trackName ?? "subtitle",
      style_ref: flags.styleRef ?? null,
      time_offset_us: offsetUs,
      first: created[0],
      last: created[created.length - 1],
    },
    flags,
  );
}

// --- Batch ---

interface BatchOp {
  cmd: string;
  id?: string;
  text?: string;
  offset?: string;
  speed?: number;
  volume?: number;
  opacity?: number;
  start?: string;
  duration?: string;
  track?: string;
}

function execBatchOp(draft: Draft, filePath: string, op: BatchOp, flags: Flags): void {
  const silent = { ...flags, quiet: true };
  switch (op.cmd) {
    case "set-text":
      if (!op.id || op.text === undefined) die(`batch set-text requires id and text`);
      cmdSetText(draft, filePath, op.id, op.text, silent, false);
      break;
    case "shift":
      if (!op.id || !op.offset) die(`batch shift requires id and offset`);
      cmdShift(draft, filePath, op.id, op.offset, silent, false);
      break;
    case "shift-all":
      if (!op.offset) die(`batch shift-all requires offset`);
      cmdShiftAll(draft, filePath, op.offset, { ...silent, track: op.track }, false);
      break;
    case "speed":
      if (!op.id || op.speed === undefined) die(`batch speed requires id and speed`);
      cmdSpeed(draft, filePath, op.id, String(op.speed), silent, false);
      break;
    case "volume":
      if (!op.id || op.volume === undefined) die(`batch volume requires id and volume`);
      cmdVolume(draft, filePath, op.id, String(op.volume), silent, false);
      break;
    case "opacity":
      if (!op.id || op.opacity === undefined) die(`batch opacity requires id and opacity`);
      cmdOpacity(draft, filePath, op.id, String(op.opacity), silent, false);
      break;
    case "trim":
      if (!op.id || !op.start || !op.duration) die(`batch trim requires id, start, duration`);
      cmdTrim(draft, filePath, op.id, op.start, op.duration, silent, false);
      break;
    default:
      die(`Unknown batch command: ${op.cmd}`);
  }
}

function cmdBatch(draft: Draft, filePath: string, flags: Flags): void {
  const input = readFileSync("/dev/stdin", "utf-8").trim();
  if (!input) die("No input on stdin");
  const lines = input.split("\n");
  let ok = 0;
  let fail = 0;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const op = JSON.parse(trimmed) as BatchOp;
      execBatchOp(draft, filePath, op, flags);
      ok++;
    } catch (e) {
      fail++;
      const msg = e instanceof Error ? e.message : String(e);
      process.stderr.write(JSON.stringify({ error: msg, line: trimmed }) + "\n");
    }
  }
  saveDraft(filePath, draft);
  out({ ok: true, succeeded: ok, failed: fail }, flags);
}

// --- Main ---

async function main(): Promise<void> {
  const raw = process.argv.slice(2);
  if (raw.length === 0 || raw[0] === "--help" || raw[0] === "-h") {
    console.log(HELP);
    process.exit(0);
  }

  const { positional, flags } = parseFlags(raw);
  const cmd = positional[0];
  const projectPath = positional[1];

  // `enums` is a pure lookup — no project needed.
  if (cmd === "enums") {
    cmdEnums(flags);
    process.exit(0);
  }

  // init doesn't need an existing project
  if (cmd === "init") {
    const name = projectPath; // positional[1] is the name for init
    if (!name) die("Missing name. Usage: capcut init <name> [--template <dir>] [--drafts <dir>]");
    const cliDir = new URL(".", import.meta.url).pathname.replace(/\/dist\/$/, "");
    const templateDir = flags.template ?? cliDir + "/../CapCutAPI/template";
    const draftsDir =
      flags.drafts ?? (process.env.HOME || "~") + "/Movies/CapCut/User Data/Projects/com.lveditor.draft";
    const result = initDraft({ name, templateDir, draftsDir });
    out({ ok: true, name, draft_path: result.draftPath, file_path: result.filePath }, flags);
    if (!flags.quiet) process.stderr.write(`Created: ${result.draftPath}\n`);
    process.exit(0);
  }

  if (!projectPath) die("Missing project path. Run 'capcut --help' for usage.");

  const { draft, filePath } = loadDraft(projectPath);

  switch (cmd) {
    case "info":
      cmdInfo(draft, flags);
      break;
    case "tracks":
      cmdTracks(draft, flags);
      break;
    case "segments":
      cmdSegments(draft, flags);
      break;
    case "texts":
      cmdTexts(draft, flags);
      break;
    case "set-text":
      requireArgs(positional, 4, "capcut set-text <project> <id> <text>");
      cmdSetText(draft, filePath, positional[2], positional.slice(3).join(" "), flags);
      break;
    case "shift":
      requireArgs(positional, 4, "capcut shift <project> <id> <offset>");
      cmdShift(draft, filePath, positional[2], positional[3], flags);
      break;
    case "shift-all":
      requireArgs(positional, 3, "capcut shift-all <project> <offset> [--track <type>]");
      cmdShiftAll(draft, filePath, positional[2], flags);
      break;
    case "speed":
      requireArgs(positional, 4, "capcut speed <project> <id> <multiplier>");
      cmdSpeed(draft, filePath, positional[2], positional[3], flags);
      break;
    case "volume":
      requireArgs(positional, 4, "capcut volume <project> <id> <level>");
      cmdVolume(draft, filePath, positional[2], positional[3], flags);
      break;
    case "trim":
      requireArgs(positional, 5, "capcut trim <project> <id> <start> <duration>");
      cmdTrim(draft, filePath, positional[2], positional[3], positional[4], flags);
      break;
    case "opacity":
      requireArgs(positional, 4, "capcut opacity <project> <id> <alpha>");
      cmdOpacity(draft, filePath, positional[2], positional[3], flags);
      break;
    case "export-srt":
      cmdExportSrt(draft);
      break;
    case "materials":
      cmdMaterials(draft, flags);
      break;
    case "segment":
      requireArgs(positional, 3, "capcut segment <project> <id>");
      cmdSegmentDetail(draft, positional[2], flags);
      break;
    case "material":
      requireArgs(positional, 3, "capcut material <project> <id>");
      cmdMaterialDetail(draft, positional[2], flags);
      break;
    case "add-audio":
      requireArgs(positional, 5, "capcut add-audio <project> <file-or-wikimedia-url> <start> <duration>");
      await cmdAddAudio(draft, filePath, positional, flags);
      break;
    case "add-video":
      requireArgs(positional, 5, "capcut add-video <project> <file-or-wikimedia-url> <start> <duration>");
      await cmdAddVideo(draft, filePath, positional, flags);
      break;
    case "add-text":
      requireArgs(positional, 5, "capcut add-text <project> <start> <duration> <text>");
      cmdAddText(draft, filePath, positional, flags);
      break;
    case "cut":
      requireArgs(positional, 4, "capcut cut <project> <start> <end> --out <path>");
      cmdCut(draft, filePath, positional, flags);
      break;
    case "keyframe":
      requireArgs(positional, 3, "capcut keyframe <project> <id> <property> <time> <value>");
      cmdKeyframe(draft, filePath, positional, flags);
      break;
    case "transition":
      requireArgs(positional, 4, "capcut transition <project> <id> <slug> [--duration <s>]");
      cmdTransition(draft, filePath, positional, flags);
      break;
    case "mask":
      requireArgs(positional, 3, "capcut mask <project> <id> <slug> [flags]  |  --off");
      cmdMask(draft, filePath, positional, flags);
      break;
    case "bg-blur":
      requireArgs(positional, 3, "capcut bg-blur <project> <id> <1|2|3|4>  |  --off");
      cmdBgBlur(draft, filePath, positional, flags);
      break;
    case "text-style":
      requireArgs(positional, 3, "capcut text-style <project> <id> [flags]");
      cmdTextStyle(draft, filePath, positional, flags);
      break;
    case "text-anim":
      requireArgs(positional, 3, "capcut text-anim <project> <id> [--intro <slug>] [--outro <slug>]");
      cmdTextAnim(draft, filePath, positional, flags);
      break;
    case "image-anim":
      requireArgs(positional, 3, "capcut image-anim <project> <id> [--intro <slug>] [--outro <slug>] [--combo <slug>]");
      cmdImageAnim(draft, filePath, positional, flags);
      break;
    case "add-sticker":
      requireArgs(positional, 5, "capcut add-sticker <project> <resource-id> <start> <duration>");
      cmdAddSticker(draft, filePath, positional, flags);
      break;
    case "add-effect":
      requireArgs(positional, 5, "capcut add-effect <project> <slug> <start> <duration>");
      cmdAddEffect(draft, filePath, positional, flags);
      break;
    case "save-template":
      requireArgs(positional, 4, "capcut save-template <project> <id> <name> --out <path>");
      cmdSaveTemplate(draft, positional, flags);
      break;
    case "apply-template":
      requireArgs(positional, 5, "capcut apply-template <project> <template.json> <start> <duration>");
      cmdApplyTemplate(draft, filePath, positional, flags);
      break;
    case "batch":
      cmdBatch(draft, filePath, flags);
      break;
    case "import-srt":
      requireArgs(positional, 3, "capcut import-srt <project> <srt-path-or-->");
      cmdImportSrt(draft, filePath, positional, flags);
      break;
    case "text-ranges":
      requireArgs(positional, 3, "capcut text-ranges <project> <id> --styles @path.json");
      cmdTextRanges(draft, filePath, positional, flags);
      break;
    default:
      die(`Unknown command: ${cmd}. Run 'capcut --help' for usage.`);
  }
}

main().catch((e) => {
  const msg = e instanceof Error ? e.message : String(e);
  process.stderr.write(JSON.stringify({ error: msg }) + "\n");
  process.exit(1);
});
