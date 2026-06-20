# Version support matrix

CapCut and JianYing evolve an undocumented on-disk schema. This matrix deliberately separates fixture-backed evidence from compatibility expectations.

Run `capcut version <project>` for schema flags and `capcut diagnose <project> -H` for canonical-file selection, timeline divergence, and editor-process safety. `capcut diagnose <project> --bundle support.json` creates a redacted report suitable for an issue.

## Evidence levels

- **fixture-tested** — committed fixture exercised by automated tests.
- **synthetic-tested** — a minimal version/OS shape exercises an observed storage or schema behavior; still needs a real app-created bundle.
- **reported** — behavior comes from a reproducible user report but is not yet represented by a sanitized real fixture.
- **expected-compatible** — schema inspection suggests compatibility; not a claim of testing in the desktop app.
- **known-broken** — the CLI detects the incompatibility and reports a workaround or refusal.

## CapCut (`platform.app_source == "cc"`)

| Version | Evidence | Status | Notes |
|---|---|---|---|
| 6.2.8 | fixture-tested | supported | Canonical fixture in `test/draft_content.json`; full command suite. |
| 6.5–8.0 | expected-compatible | unverified | No committed app-created fixtures. Enum/schema changes appear additive. |
| 8.7 Windows | reported + synthetic-tested | adapter shipped, real validation pending | Issue #35 reports that `draft_content.json` edits may be ignored in favour of `template-2.tmp` / `draft_meta_info.json`. v0.11 discovers nested/string JSON timeline envelopes, selects modern storage, synchronizes every readable target, and provides `diagnose --bundle`. A reporter-provided real folder is still required before marking this fixture-tested. |
| 9.x | expected-compatible | unverified | `common_masks` may coexist with legacy mask fields. Use `version`, `diagnose`, and `migrate`; do not treat this row as desktop-app verification. |

There is no blanket “6.x–9.x tested” claim. Only versions with committed fixtures receive that label.

## JianYing (`platform.app_source == "lv"`)

| Version | Evidence | Status | Notes |
|---|---|---|---|
| 5.9.x | community-reported | expected-compatible | Last widely used plaintext line; no sanitized app-created fixture is currently committed. |
| 6.0+ | reported | known-broken for encrypted files | `capcut decrypt` detects encryption and explains the workaround; it does not decrypt the file. Plaintext/exported variants can still be inspected normally. |

## v0.11 storage and write safety

`capcut-cli` inspects these files in a project directory:

1. `draft_content.json`
2. `draft_info.json`
3. `draft_meta_info.json`
4. `template-2.tmp`

It recognizes a timeline at the root or inside a shallow object/string JSON envelope. For CapCut 8.7+, readable `template-2.tmp` / `draft_meta_info.json` timelines take precedence; older versions retain the content/info preference. Every readable timeline target is synchronized by one atomic save.

Writes use same-directory temporary files, fsync, and rename. Before committing, the CLI refuses if a target changed since it was loaded. Managed CapCut/JianYing draft paths are also protected while the desktop editor is detected. `--force-write` is an explicit override, not a default recovery path.

## Schema feature detection

`capcut version` reports:

| Flag | Meaning |
|---|---|
| `mask_field` | Legacy `mask`, newer `common_masks`, both, or neither. |
| `has_text_ranges` | At least one text material contains multi-style ranges. |
| `has_audio_fades` | `materials.audio_fades[]` exists. |
| `new_version_field` | Top-level `new_version`, when present. |
| `last_modified_platform` | Cross-platform modification marker, when present. |

## Reporting a broken version

1. Close CapCut/JianYing.
2. Run `capcut diagnose <project> --bundle support.json`.
3. Run `capcut version <project>`.
4. Open an issue with app version, OS, exact command, JSON error, and `support.json`.
5. If possible, attach a sanitized project folder. Remove private media and paths first.

A version moves to **fixture-tested** only after the sanitized fixture and regression test are committed.
