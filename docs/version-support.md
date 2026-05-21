# Version support matrix

`capcut-cli` reads `draft_content.json` (Windows) / `draft_info.json` (macOS) directly. Both CapCut and JianYing evolve the schema across releases. This page tracks which app versions we test against and what's known-broken.

Run `capcut version <project>` on any draft to detect the app, version, and which schema fields it carries. The command also flags whether the draft uses fields we don't yet write (e.g. `common_masks` introduced in JianYing 9.6+ / newer CapCut builds).

## Tested versions

### CapCut (`platform.app_source == "cc"`)

| Version | Status | Notes |
|---|---|---|
| 6.2.8 | tested | Fixture in `test/draft_content.json`; full coverage |
| 6.5.0 | tested | No schema-breaking changes from 6.2 |
| 7.0.0 | tested | New transition slugs; covered by `enums.json` |
| 8.0.0 | tested | No schema-breaking changes |
| 9.0.0 | tested | `common_masks` field present alongside legacy `mask` — `capcut mask` still writes legacy field (works in 9.x; `capcut migrate` for 10.x+) |

Supported range: **6.x — 9.x**. CapCut International is **not encrypted** and the schema is largely stable across these versions.

### JianYing (`platform.app_source == "lv"`)

| Version | Status | Notes |
|---|---|---|
| 5.9.0 | tested | The "safe" version pre-encryption. Pin and block auto-update — see below |
| 6.0.0+ | known-broken | `draft_content.json` is encrypted; `capcut decrypt` ships in v0.6.0 |

Supported range: **5.9.x only**.

## Why JianYing pinning matters

JianYing auto-updates aggressively and replaces v5.9 with newer encrypted versions. Once that happens, every open-source draft toolchain breaks. The widely-used workarounds (recorded across the ecosystem, see [pyJianYingDraft #115](https://github.com/GuanYixuan/pyJianYingDraft/issues/115)):

- **Windows**: delete `update.exe` and `VEDetector.exe` from the JianYing install dir, set the parent directory of `update.exe` read-only via folder-permission ACLs
- **macOS**: no clean workaround documented as of May 2026 — community is asking for help
- **Cloud Windows VM**: install once, snapshot, restore on every boot

`capcut-cli` does not yet ship `capcut decrypt`; once it does, the pin requirement relaxes.

## Schema feature detection

`capcut version` reports four schema flags on every draft:

| Flag | Meaning |
|---|---|
| `mask_field: "mask"` | Legacy mask schema (`materials.masks[]`) — what `capcut mask` writes |
| `mask_field: "common_masks"` | New mask schema (`materials.common_masks[]`) — needs `capcut migrate` to read/write |
| `mask_field: "both"` | Draft was edited across versions — safe but unusual |
| `mask_field: "none"` | No masks in this draft |
| `has_text_ranges` | At least one text material has a multi-style `styles[]` array (Phase 3, v0.3.0) |
| `has_audio_fades` | `materials.audio_fades[]` exists — required for fade-in/fade-out commands (roadmap) |
| `new_version_field` | Value of the top-level `new_version` field — non-null on some CapCut International builds |
| `last_modified_platform` | Value of `last_modified_platform` — non-null when draft was edited in multiple platforms |

## What changes between versions

For the full schema diff, see [`docs/draft-schema/05-version-differences.md`](./draft-schema/05-version-differences.md).

Short version:
- **CapCut ↔ JianYing**: enum slug namespace differs (transitions, masks, etc.). `capcut enums --jianying` switches namespace; per-draft auto-detection happens via `platform.app_source`.
- **Within CapCut**: enum library grows on each release. New slugs appear but old ones keep working. Schema fields are additive.
- **Within JianYing**: 5.9 → 6.0 introduced field encryption and the `mask` → `common_masks` rename. Other changes additive.

## Reporting a broken version

If `capcut version` reports `support.status: untested` and a command misbehaves on that draft:

1. Copy `draft_content.json` to a gist (strip private file paths first).
2. Open an issue with: app version, OS, the exact command, and the JSON error output.
3. The fixture lands in `test/fixtures/<version>/` and the version moves from `untested` to `tested` (or `known-broken` with a documented fallback).
