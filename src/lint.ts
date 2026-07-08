import { existsSync, statSync } from "node:fs";
import { imageAnimCatalogue } from "./decorators.js";
import type { Draft, Segment, Track } from "./draft.js";
import { extractText, findMaterial, getTracksByType } from "./draft.js";
import { type Category, listEnum, type Namespace } from "./enums.js";
import { effectCatalogue, filterCatalogue } from "./factory.js";

export type Severity = "error" | "warning" | "info";

export interface LintIssue {
  severity: Severity;
  code: string;
  message: string;
  fixable: boolean;
  location?: {
    track?: string;
    segment_id?: string;
    material_id?: string;
    path?: string;
  };
}

// Codes that lintDraft can mechanically repair via fixDraft. Any issue whose
// code appears here is emitted with fixable:true.
//
// Deliberately NOT here: missing-material and missing-file (the only safe
// repair would delete user timeline content or guess a path — report-only;
// `relink` and `replace` are the intended repairs), and unknown-effect-slug
// (repair would mean guessing which resource the author meant).
const FIXABLE_CODES = new Set<string>(["cue-too-long", "caption-overlap", "caption-gap-too-small", "line-too-long"]);

export interface LintOptions {
  maxCharsPerLine: number;
  maxCueDurationUs: number;
  minGapBetweenCaptionsUs: number;
  checkLocalPaths: boolean;
}

export const DEFAULT_LINT_OPTIONS: LintOptions = {
  maxCharsPerLine: 42, // BBC subtitle standard
  maxCueDurationUs: 7_000_000, // 7s; longer caps are hard to read
  minGapBetweenCaptionsUs: 0, // overlap = error; gap = no rule by default
  checkLocalPaths: true,
};

export function lintDraft(draft: Draft, opts: LintOptions = DEFAULT_LINT_OPTIONS): LintIssue[] {
  const issues: LintIssue[] = [];

  for (const seg of allSegments(draft)) {
    const s = seg.segment;
    if (!draft.materials || !s.material_id) continue;
    if (!materialExistsAnywhere(draft, s.material_id)) {
      issues.push({
        severity: "error",
        code: "missing-material",
        message: `Segment ${shortId(s.id)} references material ${shortId(s.material_id)} that does not exist in any materials.*`,
        fixable: FIXABLE_CODES.has("missing-material"),
        location: { track: seg.track.name, segment_id: s.id, material_id: s.material_id },
      });
    }
  }

  for (const track of getTracksByType(draft, "text")) {
    const segs = [...track.segments].sort((a, b) => a.target_timerange.start - b.target_timerange.start);
    for (let i = 0; i < segs.length; i++) {
      const s = segs[i];
      const mat = findMaterial(draft.materials.texts, s.material_id);
      const text = mat ? extractText(mat.content) : "";

      if (s.target_timerange.duration > opts.maxCueDurationUs) {
        issues.push({
          severity: "warning",
          code: "cue-too-long",
          message: `Caption ${shortId(s.id)} runs ${Math.round(s.target_timerange.duration / 1000)}ms (>${opts.maxCueDurationUs / 1_000_000}s)`,
          fixable: FIXABLE_CODES.has("cue-too-long"),
          location: { track: track.name, segment_id: s.id },
        });
      }

      for (const line of text.split(/\r?\n/)) {
        if (line.length > opts.maxCharsPerLine) {
          issues.push({
            severity: "warning",
            code: "line-too-long",
            message: `Caption ${shortId(s.id)} has ${line.length}-char line (>${opts.maxCharsPerLine}): "${line.slice(0, 50)}…"`,
            fixable: FIXABLE_CODES.has("line-too-long"),
            location: { track: track.name, segment_id: s.id },
          });
          break;
        }
      }

      const next = segs[i + 1];
      if (next) {
        const end = s.target_timerange.start + s.target_timerange.duration;
        const gap = next.target_timerange.start - end;
        if (gap < 0) {
          issues.push({
            severity: "error",
            code: "caption-overlap",
            message: `Captions ${shortId(s.id)} and ${shortId(next.id)} overlap by ${Math.round(-gap / 1000)}ms on track "${track.name}"`,
            fixable: FIXABLE_CODES.has("caption-overlap"),
            location: { track: track.name, segment_id: s.id },
          });
        } else if (gap > 0 && gap < opts.minGapBetweenCaptionsUs) {
          issues.push({
            severity: "warning",
            code: "caption-gap-too-small",
            message: `Captions ${shortId(s.id)} and ${shortId(next.id)} are ${Math.round(gap / 1000)}ms apart (<${opts.minGapBetweenCaptionsUs / 1000}ms)`,
            fixable: FIXABLE_CODES.has("caption-gap-too-small"),
            location: { track: track.name, segment_id: s.id },
          });
        }
      }
    }
  }

  if (opts.checkLocalPaths) {
    for (const kind of ["videos", "audios"] as const) {
      for (const mat of draft.materials[kind] ?? []) {
        const m = mat as { id: string; path?: string };
        if (typeof m.path !== "string" || m.path.length === 0) continue;
        if (m.path.startsWith("http://") || m.path.startsWith("https://")) continue;
        if (!fileExists(m.path)) {
          issues.push({
            severity: "error",
            code: "missing-file",
            message: `Material ${shortId(m.id)} (${kind}) references file that doesn't exist: ${m.path}`,
            fixable: FIXABLE_CODES.has("missing-file"),
            location: { material_id: m.id, path: m.path },
          });
        }
      }
    }
  }

  // Effect/filter/animation resource ids the bundled enum table doesn't know.
  // CapCut silently drops unknown resource ids (GuanYixuan/pyCapCut#12), so
  // surface them before the app eats them. Report-only: a repair would mean
  // guessing which resource the author meant.
  const known = knownEffectIds();
  const pushUnknown = (kind: string, name: string, badId: string, materialId: string) => {
    issues.push({
      severity: "warning",
      code: "unknown-effect-slug",
      message: `${kind} "${name}" (material ${shortId(materialId)}) uses effect_id ${badId} not in the bundled enum table — CapCut may silently ignore it`,
      fixable: FIXABLE_CODES.has("unknown-effect-slug"),
      location: { material_id: materialId },
    });
  };
  for (const mat of draft.materials.video_effects ?? []) {
    const m = mat as { id?: string; name?: string; type?: string; effect_id?: string; resource_id?: string };
    const effectId = typeof m.effect_id === "string" ? m.effect_id : "";
    const resourceId = typeof m.resource_id === "string" ? m.resource_id : "";
    if (!effectId && !resourceId) continue;
    if (known.has(effectId) || known.has(resourceId)) continue;
    pushUnknown(m.type ?? "effect", m.name ?? "?", effectId || resourceId, m.id ?? "");
  }
  for (const mat of draft.materials.material_animations ?? []) {
    const container = mat as { id?: string; animations?: Array<Record<string, unknown>> };
    for (const anim of container.animations ?? []) {
      const a = anim as { id?: string; name?: string; type?: string; resource_id?: string };
      const effectId = typeof a.id === "string" ? a.id : "";
      const resourceId = typeof a.resource_id === "string" ? a.resource_id : "";
      if (!effectId && !resourceId) continue;
      if (known.has(effectId) || known.has(resourceId)) continue;
      pushUnknown(`${a.type ?? "?"} animation`, a.name ?? "?", effectId || resourceId, container.id ?? "");
    }
  }

  return issues;
}

// Every effect_id/resource_id the CLI could have written into a draft: the
// bundled enums.json (both namespaces, all categories) plus the inline
// knossos-verified starter catalogues that enums.json doesn't carry.
const ENUM_CATEGORIES: Category[] = [
  "transitions",
  "masks",
  "image_intros",
  "image_outros",
  "image_combos",
  "text_intros",
  "text_outros",
  "text_loop_anims",
  "scene_effects",
  "character_effects",
  "audio_effects",
  "fonts",
  "filters",
];

let knownIdCache: Set<string> | null = null;

function knownEffectIds(): Set<string> {
  if (knownIdCache) return knownIdCache;
  const ids = new Set<string>();
  const add = (id?: string) => {
    if (id) ids.add(id);
  };
  for (const namespace of ["capcut", "jianying"] as Namespace[]) {
    for (const category of ENUM_CATEGORIES) {
      for (const e of listEnum(category, namespace)) {
        add(e.effect_id);
        add(e.resource_id);
      }
    }
  }
  for (const e of [...effectCatalogue(), ...filterCatalogue(), ...imageAnimCatalogue()]) {
    add(e.effect_id);
    add(e.resource_id);
  }
  knownIdCache = ids;
  return ids;
}

export function summarize(issues: LintIssue[]): { errors: number; warnings: number; info: number; total: number } {
  let errors = 0;
  let warnings = 0;
  let info = 0;
  for (const i of issues) {
    if (i.severity === "error") errors++;
    else if (i.severity === "warning") warnings++;
    else info++;
  }
  return { errors, warnings, info, total: issues.length };
}

export function lintExitCode(summary: { errors: number; warnings: number }): number {
  if (summary.errors > 0) return 2;
  if (summary.warnings > 0) return 1;
  return 0;
}

export interface FixResult {
  fixed: LintIssue[];
  remaining: LintIssue[];
}

// Mechanically repair fixable issues on `draft` in place. Only issues whose
// code is in FIXABLE_CODES are touched — everything else is returned in
// `remaining` for the caller to report. Repairs are ordered so that earlier
// passes can uncover issues the next pass would fix (e.g. shortening an
// overlong cue may resolve an overlap on the same track).
export function fixDraft(draft: Draft, opts: LintOptions = DEFAULT_LINT_OPTIONS): FixResult {
  const before = lintDraft(draft, opts);
  const fixed: LintIssue[] = [];

  // Pass 1: cap over-long cues. Shrinking these first can also close overlaps.
  for (const track of getTracksByType(draft, "text")) {
    for (const s of track.segments) {
      if (s.target_timerange.duration > opts.maxCueDurationUs) {
        const before = s.target_timerange.duration;
        s.target_timerange.duration = opts.maxCueDurationUs;
        if (s.source_timerange && s.source_timerange.duration === before) {
          s.source_timerange.duration = opts.maxCueDurationUs;
        }
      }
    }
  }

  // Pass 2: trim overlapping captions so each ends where the next begins.
  for (const track of getTracksByType(draft, "text")) {
    const segs = [...track.segments].sort((a, b) => a.target_timerange.start - b.target_timerange.start);
    for (let i = 0; i < segs.length - 1; i++) {
      const s = segs[i];
      const next = segs[i + 1];
      const end = s.target_timerange.start + s.target_timerange.duration;
      const overlap = end - next.target_timerange.start;
      if (overlap > 0) {
        const newDuration = Math.max(0, s.target_timerange.duration - overlap);
        const oldDuration = s.target_timerange.duration;
        s.target_timerange.duration = newDuration;
        if (s.source_timerange && s.source_timerange.duration === oldDuration) {
          s.source_timerange.duration = newDuration;
        }
      }
    }
  }

  // Pass 3: widen under-min gaps by pulling the earlier caption's end back —
  // the same mutation direction as pass 2, so it can never create a new
  // overlap or move a start. Skipped when the shrink would erase the caption.
  if (opts.minGapBetweenCaptionsUs > 0) {
    for (const track of getTracksByType(draft, "text")) {
      const segs = [...track.segments].sort((a, b) => a.target_timerange.start - b.target_timerange.start);
      for (let i = 0; i < segs.length - 1; i++) {
        const s = segs[i];
        const next = segs[i + 1];
        const end = s.target_timerange.start + s.target_timerange.duration;
        const gap = next.target_timerange.start - end;
        if (gap > 0 && gap < opts.minGapBetweenCaptionsUs) {
          const newDuration = s.target_timerange.duration - (opts.minGapBetweenCaptionsUs - gap);
          if (newDuration <= 0) continue;
          const oldDuration = s.target_timerange.duration;
          s.target_timerange.duration = newDuration;
          if (s.source_timerange && s.source_timerange.duration === oldDuration) {
            s.source_timerange.duration = newDuration;
          }
        }
      }
    }
  }

  // Pass 4: re-wrap over-long caption lines at word boundaries. Each break
  // swaps one space for one newline — string length never changes, so the
  // UTF-16LE byte offsets in the content's styles[] ranges stay valid. Words
  // longer than the limit are never split and stay reported.
  for (const track of getTracksByType(draft, "text")) {
    for (const s of track.segments) {
      const mat = findMaterial(draft.materials.texts, s.material_id);
      if (!mat) continue;
      let parsed: { text?: unknown };
      try {
        parsed = JSON.parse(mat.content);
      } catch {
        continue;
      }
      if (typeof parsed.text !== "string") continue;
      const wrapped = rewrapText(parsed.text, opts.maxCharsPerLine);
      if (wrapped === parsed.text) continue;
      parsed.text = wrapped;
      mat.content = JSON.stringify(parsed);
    }
  }

  const after = lintDraft(draft, opts);
  const remaining: LintIssue[] = [];
  const afterKeys = new Set(after.map(issueKey));
  for (const issue of before) {
    if (!afterKeys.has(issueKey(issue))) fixed.push(issue);
  }
  for (const issue of after) remaining.push(issue);
  return { fixed, remaining };
}

// Re-wrap only lines that exceed maxChars; existing line breaks are kept.
function rewrapText(text: string, maxChars: number): string {
  return text
    .split(/(\r?\n)/)
    .map((part, i) => (i % 2 === 0 && part.length > maxChars ? wrapLine(part, maxChars) : part))
    .join("");
}

// Greedy word wrap that only swaps spaces for newlines (1:1, length-neutral).
// A multi-space separator keeps its extra spaces at the end of the broken line.
function wrapLine(line: string, maxChars: number): string {
  const tokens = line.split(/( +)/); // words at even indices, space runs at odd
  let out = tokens[0] ?? "";
  let lineLen = out.length;
  for (let i = 1; i < tokens.length; i += 2) {
    const sep = tokens[i];
    const word = tokens[i + 1] ?? "";
    if (lineLen > 0 && lineLen + sep.length + word.length > maxChars) {
      out += `${sep.slice(0, -1)}\n${word}`;
      lineLen = word.length;
    } else {
      out += sep + word;
      lineLen += sep.length + word.length;
    }
  }
  return out;
}

function issueKey(i: LintIssue): string {
  return `${i.code}|${i.location?.segment_id ?? ""}|${i.location?.material_id ?? ""}|${i.location?.path ?? ""}`;
}

function allSegments(draft: Draft): Array<{ track: Track; segment: Segment }> {
  const result: Array<{ track: Track; segment: Segment }> = [];
  for (const track of draft.tracks) {
    for (const seg of track.segments) {
      result.push({ track, segment: seg });
    }
  }
  return result;
}

function materialExistsAnywhere(draft: Draft, id: string): boolean {
  for (const arr of Object.values(draft.materials)) {
    if (!Array.isArray(arr)) continue;
    for (const m of arr) {
      if (m && typeof m === "object" && (m as { id?: string }).id === id) return true;
    }
  }
  return false;
}

function fileExists(path: string): boolean {
  try {
    return existsSync(path) && statSync(path).isFile();
  } catch {
    return false;
  }
}

function shortId(id: string): string {
  return id.slice(0, 8);
}
