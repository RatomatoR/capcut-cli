import type { Draft } from "./draft.js";

export type AppSource = "cc" | "lv" | "unknown";

export interface VersionInfo {
  app: "CapCut" | "JianYing" | "unknown";
  app_source: AppSource;
  app_version: string | null;
  os: string | null;
  schema: {
    mask_field: "mask" | "common_masks" | "both" | "none";
    has_text_ranges: boolean;
    has_audio_fades: boolean;
    new_version_field: unknown;
    last_modified_platform: unknown;
  };
  support: {
    status: "supported" | "untested" | "known-broken";
    notes: string[];
  };
}

const SUPPORTED_APP_VERSIONS: Record<AppSource, { range: string; tested: string[]; broken: string[] }> = {
  cc: {
    range: "6.x — 9.x",
    tested: ["6.2.8", "6.5.0", "7.0.0", "8.0.0", "9.0.0"],
    broken: [],
  },
  lv: {
    range: "5.9.x (auto-update destroys pinning — see docs/version-support.md)",
    tested: ["5.9.0"],
    broken: ["6.0.0+ (encrypted draft_content.json — use `capcut decrypt` once shipped)"],
  },
  unknown: {
    range: "unknown",
    tested: [],
    broken: [],
  },
};

export function detectVersion(draft: Draft): VersionInfo {
  const platform = draft.platform;
  const app_source: AppSource = platform?.app_source === "cc" ? "cc" : platform?.app_source === "lv" ? "lv" : "unknown";
  const app = app_source === "cc" ? "CapCut" : app_source === "lv" ? "JianYing" : "unknown";
  const app_version = platform?.app_version ?? null;
  const os = platform?.os ?? null;

  const mask_field = detectMaskField(draft);
  const has_text_ranges = detectTextRanges(draft);
  const has_audio_fades = Array.isArray((draft.materials as Record<string, unknown>).audio_fades);
  const new_version_field = (draft as Record<string, unknown>).new_version ?? null;
  const last_modified_platform = (draft as Record<string, unknown>).last_modified_platform ?? null;

  const support = assessSupport(app_source, app_version);
  if (mask_field === "common_masks") {
    support.notes.push(
      "Draft uses `common_masks` (JianYing 9.6+ / CapCut newer) — `mask` command writes legacy field; use `capcut migrate --to common_masks` once shipped",
    );
  }
  if (app_source === "lv" && app_version && !app_version.startsWith("5.9")) {
    support.status = "untested";
    support.notes.push(`JianYing ${app_version} is post-5.9 — likely encrypted; pinning to 5.9 strongly recommended`);
  }

  return {
    app,
    app_source,
    app_version,
    os,
    schema: { mask_field, has_text_ranges, has_audio_fades, new_version_field, last_modified_platform },
    support,
  };
}

function detectMaskField(draft: Draft): VersionInfo["schema"]["mask_field"] {
  const mats = draft.materials as Record<string, unknown>;
  const hasMask = Array.isArray(mats.masks) && (mats.masks as unknown[]).length > 0;
  const hasCommon = Array.isArray(mats.common_masks) && (mats.common_masks as unknown[]).length > 0;
  if (hasMask && hasCommon) return "both";
  if (hasCommon) return "common_masks";
  if (hasMask) return "mask";
  return "none";
}

function detectTextRanges(draft: Draft): boolean {
  for (const mat of draft.materials.texts ?? []) {
    if (typeof mat.content !== "string") continue;
    try {
      const parsed = JSON.parse(mat.content) as { styles?: unknown[] };
      if (Array.isArray(parsed.styles) && parsed.styles.length > 1) return true;
    } catch {
      /* not parseable, skip */
    }
  }
  return false;
}

function assessSupport(
  app_source: AppSource,
  app_version: string | null,
): { status: VersionInfo["support"]["status"]; notes: string[] } {
  const notes: string[] = [];
  const matrix = SUPPORTED_APP_VERSIONS[app_source];
  notes.push(
    `${app_source === "cc" ? "CapCut" : app_source === "lv" ? "JianYing" : "Unknown app"} supported range: ${matrix.range}`,
  );
  if (!app_version) {
    return { status: "untested", notes: [...notes, "No `platform.app_version` field — cannot assess compatibility"] };
  }
  if (matrix.broken.some((v) => app_version.startsWith(v.split(" ")[0]))) {
    notes.push(`Version ${app_version} listed as known-broken`);
    return { status: "known-broken", notes };
  }
  if (matrix.tested.includes(app_version)) {
    return { status: "supported", notes };
  }
  notes.push(
    `Version ${app_version} not in the tested-versions list (${matrix.tested.join(", ") || "none yet"}) — may work`,
  );
  return { status: "untested", notes };
}
