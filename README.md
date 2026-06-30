<p align="center">
  <img src="https://raw.githubusercontent.com/renezander030/capcut-cli/master/media/og-card.png" alt="capcut-cli — the CapCut/JianYing CLI any LLM agent can drive: zero dependencies, no server, both namespaces" width="640">
</p>

# capcut-cli

[![CI](https://github.com/renezander030/capcut-cli/actions/workflows/ci.yml/badge.svg)](https://github.com/renezander030/capcut-cli/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/capcut-cli.svg)](https://www.npmjs.com/package/capcut-cli)
[![npm downloads](https://img.shields.io/npm/dm/capcut-cli.svg)](https://www.npmjs.com/package/capcut-cli)
[![node](https://img.shields.io/node/v/capcut-cli.svg)](https://nodejs.org)
[![license](https://img.shields.io/npm/l/capcut-cli.svg)](./LICENSE)

English | [中文](./README.zh-CN.md)

> **Disclaimer:** This is an independent, community-maintained project. It is **not affiliated with, sponsored by, or endorsed by** CapCut, JianYing, or ByteDance Ltd. "CapCut" and "JianYing" (剪映) are trademarks of ByteDance Ltd. All product names, logos, and brands are the property of their respective owners and are used here only for identification (nominative) purposes.

**An independent CLI for CapCut / JianYing that any LLM agent can drive — zero dependencies, no server, both namespaces in one binary.**

JSON in, JSON out: every command reads and writes the local draft store directly, with no MCP server or HTTP daemon. On newer CapCut versions it detects and synchronizes every readable timeline target instead of assuming `draft_content.json` is the only source of truth. That gives any model (Claude, DeepSeek, GLM, Kimi) a deterministic boundary for inspection, building, subtitles, captions, translation, and long-form cuts.

**Use it three ways:**

- **CLI** — `npm install -g capcut-cli`, then `capcut <command> <project>`
- **Library** — `import { loadDraft, lintDraft, saveDraft } from "capcut-cli"` (typed, zero-dep)
- **Queue runner** — `capcut serve` reads JSONL jobs from stdin, for [n8n / Make / Coze](./examples/serve-automation.md)

## Install

**Prerequisites:** Node ≥ 18 (built-ins only — no native modules). Optional tools unlock specific commands: Whisper for `caption`, FFmpeg for `render`, ffprobe for automatic media metadata, and `ANTHROPIC_API_KEY` for `translate`.

```bash
npm install -g capcut-cli      # or: npx capcut-cli <command>
```

Build from source instead: `git clone https://github.com/renezander030/capcut-cli && cd capcut-cli && npm install && npm run build` (then `npm link` to expose `capcut`).

## Quickstart

```bash
capcut doctor                                  # verify Node, FFmpeg, whisper, draft dirs
capcut quickstart my-first --video clip.mp4    # create + add input + lint, prints the "open in CapCut" step
capcut info ./my-first/                         # inspect the draft (add -H for a table)
```

Then open the project in CapCut to review and render. Every short-video platform forbids automated upload, so the publish click stays human.

## Commands

JSON by default (pipe to `jq`); add `-H` for a human-readable table. Pass `--jianying` to use the JianYing enum namespace. Run `capcut <command> --help` for full flags.

| Group | Commands |
|-------|----------|
| **Inspect** | `info` · `tracks` · `materials` · `version` · `lint` |
| **Browse / drill in** | `segments` · `texts` · `segment` · `material` |
| **Create** | `init` · `quickstart` · `compile` (build a draft from a JSON spec) |
| **Preview** | `render` (low-res ffmpeg proxy — not CapCut's final render) |
| **Add** | `add-video` · `add-audio` · `add-text` (Wikimedia URLs supported, license-checked) |
| **Edit / animate** | trim · speed · volume · transitions · masks · text/image animations |
| **Templates** | apply and extract reusable layouts |
| **Subtitles & i18n** | `caption` · `import-srt` · `translate` (multi-language draft clone) |
| **Effects** | `sfx` · `chroma` (chroma key) |
| **Long-form → short** | `cut` |
| **Automation** | `serve` (stateless JSONL runner) · `migrate` · `doctor` |

**Full reference** for every command, option, and exit code: **[docs/command-reference.md](./docs/command-reference.md)**.

## How it works

CapCut/JianYing store each project as local JSON. capcut-cli loads that store, validates against a version-aware schema, applies your edit, and writes it back atomically (with a `.bak`). No project files are uploaded anywhere; nothing runs as a service. See [docs/version-support.md](./docs/version-support.md) for the CapCut/JianYing versions and schema flags it understands.

## Docs & examples

- [docs/command-reference.md](./docs/command-reference.md) — every command and flag
- [examples/](./examples/) — end-to-end recipes (VO alignment, serve automation, batch subtitle correction)
- [docs/version-support.md](./docs/version-support.md) · [docs/jianying-encryption.md](./docs/jianying-encryption.md)
- [CHANGELOG.md](./CHANGELOG.md) · [Releases](https://github.com/renezander030/capcut-cli/releases) — what's new
- [draftcat](https://github.com/renezander030/draftcat) — sibling project: governed AI pipelines (Go, MIT), same single-binary, no-API design

## Trademarks

CapCut™ and JianYing™ (剪映) are trademarks of ByteDance Ltd. This project is unofficial and is not affiliated with or endorsed by ByteDance; the marks are used nominatively to describe interoperability.

## License

MIT
