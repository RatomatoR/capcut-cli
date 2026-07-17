# keyword-emphasis (v0.14 candidate)

### Added

- `caption` / `import-srt` — per-word keyword emphasis and per-cue colour cycling as ergonomic flags, replacing hand-written `--styles` JSON for the viral-caption workflow (prior art: capcut-cli-david `--keyword-size` v1.15 and `import-captions --color-cycle`):
  - `--highlight-words <w1,w2,...|@file>` — case-insensitive **whole-word** matches per cue get an emphasis text range; `@file` reads one word/phrase per line (phrases match across spaces). Word boundaries are Unicode-aware, so `für` matches in `Grüße für alle` but never inside `fürs`, and `cap` never matches inside `capcut`. Overlapping matches (e.g. `New York` + `York`) keep the earlier one.
  - `--keyword-color <#RRGGBB>` — emphasis colour; defaults to `#FFD700`, the same gold `caption --karaoke` paints the active word with (now the shared `KARAOKE_HIGHLIGHT_COLOR` constant). Requires `--highlight-words`.
  - `--keyword-size <multiplier>` — emphasis size as a multiplier on the **cue's base font size** (style-ref/preset/`--font-size` aware), default 1.2 when `--highlight-words` is present. Validated: must be > 0 and <= 10. Requires `--highlight-words`.
  - `--color-cycle <#hex1,#hex2,...>` — rotates the BASE text colour per cue in list order, wrapping around; an independent axis from keyword emphasis. Precedence: explicit `--color` still sets the base colour for all cues unless `--color-cycle` is given (then the cycle wins per cue).
  - **Precedence contract (documented in `--help`):** keyword emphasis ranges sit on top of base/karaoke styling and override the matched words' colour/size; with `--karaoke`, karaoke ranges are built first and keyword matches override those words while inheriting their bold — the v0.13 "explicit flags beat preset ranges" spirit.
  - **One offset scheme.** Emphasis ranges are computed in the exact code-unit → UTF-16LE-byte scheme `text-ranges`/`setTextRanges` and the karaoke writer already use — correct for multibyte text (umlauts, CJK); no second offset scheme was introduced.
  - The four flags are release-scoped like the v0.13 parser additions: on commands that don't declare them (everything except `caption` and `import-srt`) the tokens fall through to free-text positionals verbatim.
  - JSON output gains `keyword_matches` / `color_cycle` **only when the flags are used**; with no flags, behaviour and output are byte-identical to v0.13.
