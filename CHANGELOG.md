# Changelog

All notable changes to capcut-cli are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); the project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.1] — 2026-05-15

### Added

- **`docs/draft-schema/`** — 7-file reference for the CapCut / JianYing project JSON: overview, tracks-and-segments, materials, keyframes-and-animations, effects-filters-stickers-masks-transitions, CapCut↔JianYing version differences. Practical, field-level, derived from real drafts + `pyJianYingDraft`. Closes the most-asked question for anyone writing tooling against the format: "what's the JSON shape?"
- **`node:test` fixture-backed test suite** — 36 tests across 5 test files (`inspect`, `edit`, `create`, `template`, `decorators`) covering the major CLI surface against the canonical `test/draft_content.json` fixture. ~1 second total runtime.
- **Husky pre-commit hook + Biome lint** — every commit runs `lint-staged` (Biome check/format on staged files only) followed by the full `node:test` suite. Cheap (<10s on a clean tree), catches regressions before they hit npm. Skipping with `--no-verify` should be rare.
- **`npm run test` / `test:fast` / `lint` / `lint:fix` / `format` scripts** in `package.json`.

### Changed

- Test runner: shell-based `scripts/_test.sh` (which tests skill wrappers) remains, but the canonical CLI test suite is now `test/*.test.mjs` via `node --test`. CI-friendly, parallel, cross-platform.

## [0.3.0] — 2026-05-15

Five phases of new commands ported from the upstream Python project (sun-guannan/VectCutAPI / CapCutAPI), all keeping the original zero-dep, local-only, JSON-by-default, pipeable design. No new runtime, no network beyond the Wikimedia gate, no Python at runtime.

### Added — Phase 1: decorators on existing segments

- **`capcut keyframe`** — add keyframe(s) to a segment for `position_x`, `position_y`, `rotation`, `scale_x`, `scale_y`, `uniform_scale`, `alpha`, `saturation`, `contrast`, `brightness`, `volume`. Single-shot and `--batch` (JSONL on stdin) modes. Value parsing accepts `"50%"`, `"+0.5"`, `"45deg"`. Writes to `common_keyframes` on the segment, appends to existing per-property lists, sorted by time offset.
- **`capcut transition`** — attach a transition between segments. Starter catalogue: `dissolve`, `rgb-glitch`, `radial-blur`, `horizontal-blur`, `vertical-blur-ii`, `twinkle-zoom`, `urban-glitch`, `shake-3`. `--duration <s>` override.
- **`capcut mask`** — attach a mask: `linear | mirror | circle | rectangle | heart | star`. Flags: `--center-x`, `--center-y`, `--size`, `--rotation`, `--feather`, `--invert`, `--rect-width`, `--round-corner`. `capcut mask <project> <id> --off` removes all masks.
- **`capcut bg-blur`** — background blur level 1–4 (light → maximum, mapping to `0.0625 / 0.375 / 0.75 / 1.0`). `--off` to clear.
- **`capcut text-style`** — rich text styling on an existing text segment: `--alpha`, `--vertical`, `--fixed-width/-height`, `--shadow` (+ `--shadow-alpha/-angle/-color/-distance/-smoothing`), `--border-width/-color/-alpha`, `--bg-color/-alpha/-style/-round-radius/-width/-height/-h-offset/-v-offset`.
- **`capcut text-anim`** — text intro/outro animations. Slugs: `fade-in`, `fade-out`, `typewriter`, `pop-up`, `throw-out`, `blur-text-in`, `zoom-in-text`. Per-side duration overrides.

### Added — Phase 2: new track types

- **`capcut add-sticker`** — create a sticker track + segment from a CapCut resource id, with `--x/-y/-scale/-rotation/-track-name` transforms.
- **`capcut add-effect`** — scene/character effect on its own effect track. Starter catalogue (CapCut namespace): `shake`, `vhs`, `cinematic`, `light-leak`, `film-grain`, `chromatic`, `vignette`. `--params <json-array>` of 0–100 effect parameters.
- **`capcut image-anim`** — intro/outro/combo animations on video / image segments. Slugs: `fade-in`, `flash-in`, `pulsing-zooms`, `scroll-up`, `stripe-merge`, `zoom-out`, `fade-out`, `blur-out`, `smoke`.

### Added — Phase 3: import + enum discovery

- **`capcut import-srt`** — parse an SRT file and create one text segment per cue. Accepts a file path or `-` for stdin. Flags: `--track-name`, `--time-offset <s>`, `--style-ref <segment-id>` (copy styling from an existing text segment), plus explicit text-style flags. Zero-dep parser; single `saveDraft` for the whole file (fast on hundreds of cues).
- **`capcut enums`** — list valid enum values for AI agents: `--transitions`, `--masks`, `--text-intros/-outros/-loop-anims`, `--image-intros/-outros/-combos`, `--scene-effects`, `--character-effects`, `--audio-effects`, `--fonts`. Output is JSON by default (`slug`, `member`, `name`, effect/resource ids, md5, durations) or a human-readable table with `-H`. Reads from a committed `enums.json` extracted from `pyJianYingDraft` (13 categories × 2 namespaces, ~790 KB).

### Added — Phase 4: multi-style text + JianYing namespace

- **`capcut text-ranges`** — multi-style text. Different styling per character range in a single text segment. `--styles @path.json` or inline JSON: `[{"start":0,"end":5,"font_color":"#FFD700","font_size":18,"bold":true},…]`. Sorts + validates non-overlap, emits baseline-style fillers for gaps so CapCut renders the whole text. Unlocks word-level highlight captions.
- **`--jianying` global flag** — threaded through `transition`, `mask`, `text-anim`, `image-anim`, `add-effect`, and `enums`. Selects the JianYing enum namespace (default is CapCut). Lookup falls back to `member` name, so `capcut transition <project> <id> "_3D空间" --jianying` works.

### Added — Phase 5: Wikimedia Commons input

- **`add-video` / `add-audio` accept Wikimedia URLs** — `commons.wikimedia.org`, `*.wikipedia.org`, `upload.wikimedia.org` page URLs and direct CDN URLs all resolve through the Commons imageinfo API to a canonical `File:` title.
- **License classifier + refusal gate** — `permissive` (CC*, PD, CC0, etc.), `fair-use`, `restrictive` (NC, ND, ©), `unknown`. Restrictive/unknown require `--force-license`. Fair-use downloads with a warning. Output JSON carries a `wikimedia` block with `artist`, `credit`, `description_url`, license raw + class, dimensions, mime — drop-in attribution for YouTube descriptions.
- **Single on-disk copy** — assets download directly into `<draft>/assets/<kind>/`. No temp-dir churn; `addVideo` / `addAudio` `copyFileSync` becomes a no-op.

### Added — packaging

- **Ready-made templates** ship in `templates/`: `gold-title.json`, `end-card.json`, `subscribe-cta.json`. Use directly via `capcut apply-template ./project ./node_modules/capcut-cli/templates/<name>.json <start> <duration>`.
- **`.github/FUNDING.yml`** — enables GitHub Sponsors + Gumroad links on the repo sidebar.
- **`--help` footer** — every `capcut --help` now ends with links to the full viral-shorts pipeline (Gumroad / Stripe), guides, Sponsors, and contact.

### Skill + docs

- `skills/capcut-edit/` reorganised into `references/` + `scripts/` + `assets/`. `SKILL.md` trimmed; `references/api-reference.md` covers every command and flag; `references/workflows.md` documents which `scripts/*.sh` to call (not how to reconstruct them); `references/pitfalls.md` covers the gotchas (close-project-first, `.bak`, `clip=null` on audio, etc.).
- Wrapper scripts: `fade-in.sh`, `fade-out.sh`, `anim.sh`, `ken-burns.sh`, `long-to-short.sh`, `stamp-cta.sh`. All covered by `scripts/_test.sh` (7/7 passing).

### Changed

- `npm run build` now does `tsc && cp src/enums.json dist/enums.json` so the runtime reads the dist copy via `import.meta.url`.
- `npm run extract-enums` regenerates `src/enums.json` from `pyJianYingDraft`.

### Notes

- All five phases keep capcut-cli zero-dep at runtime — no Python, no FFmpeg, no network beyond the explicit Wikimedia opt-in (which is `fetch`-based, no external deps).
- HTTP server, MCP server, ffprobe-based duration probing, FFmpeg letterboxing, and cloud rendering remain explicitly out of scope per `PLAN.md`.

## [0.2.2] — 2026-04-26

- README CTAs to Viral Story Shorts Blueprint (Gumroad).

## [0.2.1] — 2026-04-26

- npm tarball now includes `examples/` and Chinese README.

## [0.2.0] — 2026-04-26

- Long-form videos to shorts, end to end.

[0.3.1]: https://github.com/renezander030/capcut-cli/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/renezander030/capcut-cli/compare/v0.2.2...v0.3.0
[0.2.2]: https://github.com/renezander030/capcut-cli/compare/v0.2.1...v0.2.2
[0.2.1]: https://github.com/renezander030/capcut-cli/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/renezander030/capcut-cli/releases/tag/v0.2.0
