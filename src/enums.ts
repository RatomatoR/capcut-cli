import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Reads enums.json next to this module. After `tsc && cp src/enums.json dist/enums.json`,
// the compiled module in dist/ sees dist/enums.json; in dev (tsx src/...), src/enums.json.

export type Namespace = "capcut" | "jianying";

// Union of fields across meta types — callers destructure what they need.
export interface EnumEntry {
  member: string; // Python enum member identifier, e.g. "Dissolve_II"
  slug: string; // kebab-case alias, e.g. "dissolve-ii". "" for non-ASCII JianYing names.
  name?: string; // effect / transition / mask display name
  title?: string; // animation display name (Animation_meta uses `title` not `name`)
  effect_id?: string;
  resource_id?: string;
  md5?: string;
  default_duration?: number; // microseconds (transitions, animations)
  duration?: number; // microseconds (Animation_meta)
  is_overlap?: boolean; // transitions
  is_vip?: boolean;
  resource_type?: string; // masks
  default_aspect_ratio?: number; // masks
}

export type Category =
  | "transitions"
  | "masks"
  | "image_intros"
  | "image_outros"
  | "image_combos"
  | "text_intros"
  | "text_outros"
  | "text_loop_anims"
  | "scene_effects"
  | "character_effects"
  | "audio_effects"
  | "fonts"
  | "filters";

interface EnumsFile {
  capcut: Partial<Record<Category, EnumEntry[]>>;
  jianying: Partial<Record<Category, EnumEntry[]>>;
}

let cache: EnumsFile | null = null;

function load(): EnumsFile {
  if (cache) return cache;
  const here = dirname(fileURLToPath(import.meta.url));
  const raw = readFileSync(resolve(here, "enums.json"), "utf-8");
  cache = JSON.parse(raw) as EnumsFile;
  return cache;
}

export function listEnum(category: Category, namespace: Namespace = "capcut"): EnumEntry[] {
  const ns = load()[namespace];
  return ns[category] ?? [];
}

/**
 * Look up an enum entry by slug or by raw Python member name.
 * Alias map lets legacy CLI slugs (e.g. "linear" -> "Split") stay backward compatible.
 */
export function findEnum(
  category: Category,
  slugOrMember: string,
  namespace: Namespace = "capcut",
  aliases?: Record<string, string>,
): EnumEntry | null {
  const want = (aliases?.[slugOrMember] ?? slugOrMember).toLowerCase();
  for (const e of listEnum(category, namespace)) {
    if (e.slug && e.slug.toLowerCase() === want) return e;
    if (e.member.toLowerCase() === want) return e;
  }
  return null;
}

export function slugsFor(category: Category, namespace: Namespace = "capcut"): string[] {
  return listEnum(category, namespace)
    .map((e) => e.slug)
    .filter((s) => s.length > 0);
}
