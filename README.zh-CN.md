<p align="center">
  <img src="https://raw.githubusercontent.com/renezander030/capcut-cli/master/media/og-card.png" alt="capcut-cli — 任何大模型 Agent 都能驱动的剪映 / CapCut 命令行：零依赖、无服务、双命名空间" width="640">
</p>

# capcut-cli

[![CI](https://github.com/renezander030/capcut-cli/actions/workflows/ci.yml/badge.svg)](https://github.com/renezander030/capcut-cli/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/capcut-cli.svg)](https://www.npmjs.com/package/capcut-cli)
[![npm downloads](https://img.shields.io/npm/dm/capcut-cli.svg)](https://www.npmjs.com/package/capcut-cli)
[![node](https://img.shields.io/node/v/capcut-cli.svg)](https://nodejs.org)
[![license](https://img.shields.io/npm/l/capcut-cli.svg)](./LICENSE)

[English](./README.md) | 中文

> **免责声明：** 本项目为独立的、社区维护的项目，与 CapCut、剪映或字节跳动有限公司（ByteDance Ltd.）**无任何隶属、赞助或背书关系**。"CapCut" 与 "剪映" 为字节跳动有限公司的商标，所有产品名称、徽标与品牌均归各自所有者所有，此处仅用于标识（指称性使用）目的。

_一个独立的、社区维护的 CapCut / 剪映草稿文件命令行工具。_

**任何大模型 Agent 都能驱动的剪映 / CapCut 命令行 —— 零依赖、无服务、CapCut + 剪映共用一个二进制。**

每个命令都通过版本感知的本地草稿存储层工作：JSON 进、JSON 出，不用 MCP 服务或 HTTP 守护进程。新版 CapCut 会自动检测并同步 `draft_content.json`、`draft_info.json`、`draft_meta_info.json` 与 `template-2.tmp` 中可读的时间线，不再假设只有一个文件是真源。

**三种用法：**

- **命令行** —— `npm install -g capcut-cli`，然后 `capcut <command> <project>`
- **代码库** —— `import { loadDraft, lintDraft, saveDraft, runCommand } from "capcut-cli"`（带类型、零依赖）
- **队列执行器** —— `capcut serve` 从 stdin 读 JSONL 任务，支持并发、重试、去重与同项目串行化，可对接 [n8n / Make / 扣子 Coze](./examples/serve-automation.md)

先跑 `capcut doctor` 检查环境（Node、Whisper、ffprobe、FFmpeg 能力、草稿目录）。

**当前版本：v0.11.3。** v0.11 系列加入 CapCut 8.7 多文件存储适配、原子/冲突安全写入、事务式 `batch`、命令契约 v2、`compile` v2、卡拉 OK 字幕、完整媒体探测、多视频轨代理预览，以及可靠的并发队列执行器。v0.11.2 修复了 Windows 盘符路径下的 `init`、`compile`、`serve`、ESM 导入与精确恢复；v0.11.3 同步更新中英文文档。详见 [v0.11.3 Release](https://github.com/renezander030/capcut-cli/releases/tag/v0.11.3)。

**v0.6 新增** —— `doctor`（环境预检）、可导入的 Node 代码库（`import { … } from "capcut-cli"`）、官方 [Dockerfile](./Dockerfile)、在 CI 里检查草稿的 [GitHub Action](./action.yml)、三个新模板（`caption-pop`、`lower-third`、`hook-question`），以及覆盖 Node 18/20/22 的 CI 矩阵。

**v0.4 新增** —— `caption`（whisper → 真字幕对象，不再是 import-srt 那种文本伪装）、`migrate`（剪映 5.9 / CapCut 9.6 之间的 `mask` ↔ `common_masks` schema 迁移）、`lint`（字幕检查：重叠、行长、缺失素材文件）、`version`（检测兼容状态）、`translate`（多语言草稿克隆，走 Anthropic API）、`add-sfx`、`chroma`、`serve`（无状态 JSONL 队列 —— 对接 n8n / Coze / 扣子 / Make）、`export --batch`（**实验性** macOS UI 自动化批量导出）。

## v0.5 已发布（社区投票决定）

下面六个功能都是在 **[Discussion #1](https://github.com/renezander030/capcut-cli/discussions/1)** 投票选出、并在 v0.5 一起发布的。想决定下一步加什么？去那里给评论点 👍，或者开一个新 discussion。

- `audio-fade <project> <id> --in <秒> --out <秒>` —— 音频淡入淡出（写真正的 `audio_fades` 对象，不再用音量关键帧凑）
- `bubble-text <project> <id> --bubble <slug>` / 花字 —— 文本气泡 / 花字特效 + `enums --bubbles` 枚举发现
- `add-filter <project> <slug> <start> <duration>` + `enums --filters` —— 调色滤镜链（跟 VFX / 场景特效分开）
- `add-cover <project> <image-path>` / 封面 —— 命令行设置剪映 / CapCut 草稿封面
- `import-ass <project> <ass-path>` —— ASS 字幕导入（跟现有 `import-srt` 并存）
- `mix-mode <project> <id> <模式>` —— 视频片段混合模式（正片叠底 / 滤色 / 叠加 …）

> 六个功能都已在 v0.5.0 发布。如果你想要的功能不在列表里，去 Discussion #1 留言。

> **想要完整的国产大模型 + 剪映短视频流水线？** `capcut-cli` 是引擎，配套的 **[病毒短视频蓝图（完整教程 + 蓝图下载）](https://renezander.com/zh-cn/guides/automate-xiaohongshu-capcut-cli/?utm_source=capcut-cli&utm_medium=readme&utm_campaign=hero-cn)** 给你完整方法 —— DeepSeek / GLM / Kimi / Qwen 都能跑，专为 **小红书 + 抖音** 优化（不是 YouTube），**支付宝 / 微信支付** 通过 Stripe 直接下单。

## 实战样片

下面这条短片，就是用本套管线产出的成品（60 秒，9:16，可以直接发小红书 / 抖音 / 视频号）：

<video src="https://renezander.com/videos/two-sisters-vietnam-short.mp4" controls width="360" preload="metadata">
您的浏览器不支持内嵌播放器。下载：<a href="https://github.com/renezander030/capcut-cli/raw/master/media/two-sisters-vietnam-short.mp4">GitHub</a> · <a href="https://renezander.com/videos/two-sisters-vietnam-short.mp4">renezander.com</a>
</video>

> 视频文件也在仓库里：[`media/two-sisters-vietnam-short.mp4`](./media/two-sisters-vietnam-short.mp4)。GitHub 内嵌播放需要正确的 MIME 类型，所以上面用 renezander.com 的 CDN（`Content-Type: video/mp4`）；仓库里这份是离线备份和源文件。

完整流程（选题 → 大模型写剧本 → 配音 → 拼草稿）走 **[病毒短视频蓝图教程页](https://renezander.com/zh-cn/guides/automate-xiaohongshu-capcut-cli/?utm_source=capcut-cli&utm_medium=readme&utm_campaign=sample-cn)** 看，里面有 4 步管线 + DeepSeek / GLM 提示词。

## 使用思路

`capcut-cli` 在整条短视频流水线里的位置。第 2、3 步是大模型驱动（任何能输出 JSON 的模型都行）；第 1、4、5 步是确定性的 CLI 调用。第 6 步必须人工 —— **小红书 / 抖音 / 视频号 / YouTube Shorts 都禁止机器人自动发布**，最后一次"点发布"由你来。

```mermaid
flowchart LR
    A[长视频<br/>或剪映工程] --> B[capcut cut<br/>切出 60 秒片段]
    B --> C[Claude / DeepSeek<br/>/ GLM / Kimi<br/>生成钩子 + 剧本 JSON]
    C --> D[capcut-cli<br/>add-text · add-audio<br/>apply-template]
    D --> E[剪映 / CapCut<br/>审核 + 渲染 MP4]
    E --> F[发布<br/>小红书 · 抖音 · 视频号]
```

## 对比

跟其他剪映 / CapCut 工具的差别：

| 能力 | [`pyJianYingDraft`](https://github.com/GuanYixuan/pyJianYingDraft)（Python，仅剪映） | [`pyCapCut`](https://github.com/GuanYixuan/pyCapCut)（Python，仅 CapCut） | [`VectCutAPI`](https://github.com/sun-guannan/VectCutAPI)（Python + HTTP 服务，原 CapCutAPI） | `cutcli`（Go，闭源） | **`capcut-cli`**（Node，本仓库） |
|---|:---:|:---:|:---:|:---:|:---:|
| 草稿审查（`info` / `tracks` / `materials` / `segments` / `texts`） | 部分 | 部分 | ❌ | ❌ | ✅ |
| 从零创建草稿 | ✅ | ✅ | ✅ | ✅ | ✅ |
| 声明式 spec → 草稿（一次 `compile`） | ❌ | ❌ | ❌ | ❌ | ✅（v0.10.0） |
| 不打开 CapCut 预览编辑（本地 FFmpeg 代理） | ❌ | ❌ | ❌ | ❌ | ✅（v0.10.0） |
| 装饰命令（`keyframe` / `transition` / `mask` / `text-anim` / `image-anim`） | ✅ | ✅ | ✅ | ✅ | ✅（v0.3.0） |
| SRT 字幕导入 → 逐条文本片段 | ❌ | ❌ | ✅ | ❌ | ✅（v0.3.0） |
| 多样式文本（字级高亮字幕） | 部分 | 部分 | ❌ | ❌ | ✅（v0.3.0） |
| 大模型友好的枚举发现 | ❌ | ❌ | 部分 | ❌ | ✅ — 13 类 × 2 命名空间 |
| CapCut + 剪映 双命名空间 | 仅剪映 | 仅 CapCut | 都支持 | 部分 | 都支持（`--jianying` 切换） |
| 模板（save / apply） | 部分 | 部分 | ❌ | ❌ | ✅ — 内置 6 个模板 |
| Schema 文档 | 部分 | 部分 | 简略 | 无 | 完整（[`docs/draft-schema/`](./docs/draft-schema/)） |
| Wikimedia Commons URL + 版权检查 | ❌ | ❌ | ❌ | ❌ | ✅（v0.3.0） |
| 运行时依赖 | 多个 Python 包 | 多个 Python 包 | Flask + Python | 无（Go 二进制） | **零**（仅 Node ≥ 18 内置 API） |
| AI 工具集成 | 无 | 无 | HTTP | 无 | Claude Code 插件 + 任意 JSON 输出大模型 |
| 安装 | `pip install -r requirements.txt` | `pip install pyCapCut` | 克隆 + 起服务 | 下载二进制 | `npm install -g capcut-cli` |
| 许可证 | 无 | 无 | 无 | 不明 | MIT |

## 功能清单

每个功能的实现状态。✅ = 已实现，⬜ = 路线图。锚点链接到下面的命令文档。

### 工程 I/O
- ✅ [`init`](#从零创建剪映--capcut-草稿) — 从零创建新草稿
- ✅ [`info`](#常用命令) · `tracks` · `materials` — 工程概览
- ✅ `segments` · `texts` — 列表查询，支持按轨道类型过滤
- ✅ `segment` / `material <id>` — 渐进式深入（适合 AI agent）
- ✅ `export-srt` — 把字幕导出为 SRT
- ✅ [`cut`](#长视频切短--短视频流水线核心) — 切出指定时间段成为独立短片

### 添加素材
- ✅ `add-video` · `add-audio` · `add-text` — 本地文件
- ✅ `add-video` / `add-audio` — Wikimedia Commons URL（带版权分类 + 拒绝门）
- ✅ `add-sticker` — 贴纸轨 + 变换
- ✅ `add-effect` — 独立特效轨上的场景特效（vhs / shake / cinematic / vignette …）

### 编辑
- ✅ `set-text` · `shift` · `shift-all` · `speed` · `volume` · `opacity` · `trim`
- ✅ [`batch`](#批量编辑) — 一次 JSON 解析 + 一次写入，多条修改
- ✅ `batch` 默认全有或全无；`--continue-on-error` 才会明确提交部分成功操作

### 装饰命令（v0.3.0）
- ✅ `keyframe` — 位置 / 缩放 / 旋转 / 透明度 / 调色 / 音量（单次 + 标准输入 JSONL `--batch`）
- ✅ `transition` — 8 个起步 slug + 完整 enum 目录
- ✅ `mask` — 线性 / 镜像 / 圆形 / 矩形 / 心形 / 星形 + 几何参数 + `--off`
- ✅ `bg-blur` — 1–4 档背景模糊 + `--off`
- ✅ `text-style` — 透明度 · 阴影 · 描边 · 背景框（26 个参数）
- ✅ `text-anim` · `image-anim` — 入场 / 出场 / 组合动画（剪映原生库）
- ✅ `text-ranges` — 多样式文本，字节级精确（解锁字级高亮字幕）
- ✅ `caption --karaoke` — OpenAI Whisper / whisper.cpp / faster-whisper 字级时间戳与动态高亮

### 模板
- ✅ [`save-template` · `apply-template`](#模板复用--开箱即用) — 把任意片段抽成 JSON，复用时重写时长 / 位置 / 文本
- ✅ 仓库自带 6 个模板（[`templates/`](./templates/)）：`gold-title` · `end-card` · `subscribe-cta` · `caption-pop` · `lower-third` · `hook-question`

### 导入 & 发现
- ✅ `import-srt` — SRT 一条 cue 一个文本片段；支持文件 / stdin / `--style-ref` 镜像样式
- ✅ `enums` — 13 个分类 × 2 个命名空间，从仓库内 `enums.json` 读，**无需联网**
- ✅ `describe` v2 — 参数类型、默认值、枚举、写入属性、前置条件、输出与退出码
- ✅ `compile` v2 — 稳定 ref、装饰器、模板、字幕、关键帧、淡入淡出与 `--check` / `--plan`

### 素材来源
- ✅ 本地文件：mp4 / mov / m4v / mp3 / wav / aac / png / jpg / gif（任何 CapCut 接受的扩展名）
- ✅ Wikimedia Commons URL —— 页面 URL、`/wiki/File:` 形式、CDN 直链、或 `api.php?prop=pageimages` 接口都行。**许可证分类拒绝门：限制性许可需要 `--force-license` 才下载**

### 跨平台
- ✅ CapCut 和剪映 —— 同一个二进制，`--jianying` 切换 enum 命名空间
- ✅ macOS · Windows · Linux —— 纯 Node ≥ 18，没有原生模块
- ✅ `diagnose` — 检测规范草稿文件、分歧、编辑器进程，并输出脱敏支持包

### 输出格式
- ✅ JSON（默认 —— 管道给 `jq` 就行）
- ✅ `-H` / `--human` 表格模式（人类可读）
- ✅ `-q` / `--quiet` 静默模式（仅返回码）

### 质量保障
- ✅ 205 个 `node:test` 测试（[`test/`](./test/)）；Linux 覆盖 Node 18/20/22，Ubuntu/macOS/Windows 均运行完整 Node 20 测试套件
- ✅ Husky [pre-commit 钩子](./.husky/pre-commit) —— Biome lint（仅暂存文件）+ 完整测试
- ✅ Schema 参考文档（[`docs/draft-schema/`](./docs/draft-schema/)，7 个文件 ~3700 行）
- ✅ Claude Code 插件（`/plugin marketplace add https://github.com/renezander030/capcut-cli`），详见英文 [README · Claude Code plugin](./README.md#claude-code-plugin)

### 路线图
- ⬜ 用报告者提供的 Windows 工程包验证 v0.11 CapCut 8.7 存储适配，并关闭 [#35](https://github.com/renezander030/capcut-cli/issues/35)
- ⬜ 剪映 6.0+ 解密（目前只能检测 —— 详见 `decrypt` 命令的提示文案）
- 🚫 HTTP 服务 / 云渲染 / MCP 服务 —— 明确不做，详见 [`PLAN.md`](./PLAN.md)。`serve` 命令走的是无状态 JSONL 队列：没有端口，没有守护进程。

## 解决什么问题

CapCut / 剪映把项目存为 `draft_content.json` —— 嵌套很深、没有官方文档、时间单位是微秒、文字内容嵌套在转义过的 JSON 字符串里。每次手动修改都要：找到正确的 segment ID，关联到 material，搞清楚内容格式，转换时间戳，编辑，然后祈祷自己没把结构改坏。**最少 15 秒一次。**

`capcut-cli` 已经懂这套 schema。一条命令，一处修改，**5 秒搞定。**

```
$ capcut texts ./project
[{"id":"a1b2c3d4-...","start_us":500000,"duration_us":2500000,"text":"欢迎来到本视频"}]

$ capcut set-text ./project a1b2c3 "字幕已修正"
{"ok":true,"id":"a1b2c3d4-...","old":"欢迎来到本视频","new":"字幕已修正"}
```

零依赖。默认 JSON 输出。可管道。同时支持 CapCut 和剪映 (JianYing)。

## 模型无关 — 国产大模型友好

`capcut-cli` 是纯命令行工具，**不绑定任何 AI 模型**。它接受任何能输出 JSON 的脚本作为输入。配套的提示词和 Skill 已在以下模型上验证：

- **DeepSeek-V3 / R1** —— 国内首选，编程和结构化输出最稳，性价比最高
- **智谱 GLM-4.5** —— 中文短视频文案首选，中文流畅度最好
- **Moonshot Kimi** —— 200k+ 长上下文，适合从长视频选段
- **通义千问 Qwen** —— 阿里云生态打通，企业部署友好
- Claude / OpenAI Codex —— 海外用户可用，性能强但需科学上网

> 海外创作者常用的 Claude Code Plugin (`/plugin marketplace add ...`) 也支持，但**不是前置条件**。详见英文 README。

## 为什么是 CLI，不是 MCP 服务

其他 CapCut / 剪映工具大多走 HTTP API 或 MCP 服务。`capcut-cli` 故意不走这条路：

- **没有状态可坏。** 每条命令都是 JSON 进、JSON 出。Agent 可以随意穿插命令、安全重试、随时退出。版本就是 `npm install -g capcut-cli@x.y.z`。
- **不用装第二个工具。** 用户有 Node ≥ 18 就有运行时；`npx capcut-cli` 连全局安装都不用。没有守护进程，没有端口，没有鉴权层。
- **任何 agent 环境都能跑。** Claude Code 走插件，`bash` / `make` / GitHub Actions / cron / 任何能 `exec` 的脚本也都能跑。MCP 把你锁死在一个宿主里；凡是能跑 `sh` 的地方，这个 CLI 都能跑。

代价是没有实时反馈：没有进度事件，没有长任务渲染。这是有意的 —— 反正每个短视频平台都要求最后一步由人工渲染并发布（详见 [`PLAN.md`](./PLAN.md)）。

## 安装

```bash
npm install -g capcut-cli
```

或直接运行：
```bash
npx capcut-cli info ./my-project/
```

## 常用命令

```bash
# 查看项目概览
capcut info ./project

# 列出所有字幕
capcut texts ./project

# 修改某条字幕文字
capcut set-text ./project <id> "新文字"

# 平移单条片段
capcut shift ./project <id> +0.5s

# 平移所有字幕轨
capcut shift-all ./project +1s --track text

# 改播放速度
capcut speed ./project <id> 1.5

# 调音量
capcut volume ./project <id> 0.8

# 长视频切短：从 1:00 到 2:00 切出 60 秒
capcut cut ./project 1:00 2:00 --out ./short.json

# 导出 SRT
capcut export-srt ./project > subtitles.srt
```

## 从零创建剪映 / CapCut 草稿

不用先打开 CapCut，命令行就能拼出一个完整草稿：

```bash
# 创建空草稿
capcut init "我的短片"

# 加视频
capcut add-video ./我的短片 ./clip.mp4 0s 10s

# 加配音
capcut add-audio ./我的短片 ./voiceover.wav 0s 10s --volume 0.9

# 加背景音乐
capcut add-audio ./我的短片 ./music.mp3 0s 30s --volume 0.3

# 加标题
capcut add-text ./我的短片 0s 5s "标题" --font-size 24 --color "#FFD700"
```

`add-video` / `add-audio` 会把文件复制到草稿的 assets 目录，CapCut / 剪映打开后可以正常关联。

## 批量编辑

一次写入多条修改，一个 IO：

```bash
echo '{"cmd":"set-text","id":"a1b2c3","text":"第一行已修正"}
{"cmd":"set-text","id":"d4e5f6","text":"第二行已修正"}
{"cmd":"shift-all","offset":"+0.3s","track":"text"}' | capcut batch ./project
```

## 模板复用 — 开箱即用

`templates/` 目录内置 6 个常用模板：`gold-title`、`end-card`、`subscribe-cta`、`caption-pop`、`lower-third`、`hook-question`。下面展示前三个：

```bash
# 大标题（黄色 + 黑边 + 阴影，适合开场)
capcut apply-template ./project ./node_modules/capcut-cli/templates/gold-title.json 0s 5s "你发现了吗？"

# 片尾卡片（白色居中）
capcut apply-template ./project ./node_modules/capcut-cli/templates/end-card.json 50s 5s "下一条更精彩"

# 关注引导（右下角，红色)
capcut apply-template ./project ./node_modules/capcut-cli/templates/subscribe-cta.json 55s 5s "点关注 →"
```

也可以把项目里现成的 segment（标题、贴纸、视频、音频）抽成自己的模板：

```bash
capcut save-template ./project <id> "我的标题样式" --out ./title.json
capcut apply-template ./other ./title.json 0s 5s
```

## 长视频切短 — 短视频流水线核心

```bash
# 从 10 分钟长视频切出 60 秒爆款片段
capcut cut ./project 1:00 2:00 --out ./teaser.json

# 加标题
capcut add-text ./teaser.json 0s 5s "你绝对没看过" --font-size 24 --color "#FFD700"
capcut add-text ./teaser.json 55s 5s "完整版在主页" --font-size 14
```

> **把长视频切成小红书 / 抖音爆款，是这个工具的主要场景。** 完整方法 —— 选题、爆款钩子、剧本结构、配音对齐、自动批量产出 —— 都打包在 **[病毒短视频蓝图](https://renezander.com/zh-cn/guides/automate-xiaohongshu-capcut-cli/?utm_source=capcut-cli&utm_medium=readme&utm_campaign=cut-section-cn)**。支付宝 / 微信支付直接下单（Stripe 收款，国内卡和海外卡都支持）。

## 输出格式

**默认 JSON**（适合脚本和 agent 调用）：
```bash
capcut texts ./project | jq '.[].text'
```

**人类可读表格**（加 `-H` 或 `--human`）：
```bash
capcut info ./project -H
```

**静默模式**（写入命令加 `-q`，仅看返回码）：
```bash
capcut set-text ./project a1b2c3 "新文字" -q
```

## 工作原理

CapCut / 剪映不同版本可能把有效时间线放在 `draft_content.json`、`draft_info.json`、`draft_meta_info.json` 或 `template-2.tmp`。版本感知存储层会选择规范来源、比较所有可读副本，并通过临时文件 → `fsync` → 原子重命名同步写入；每个目标都有 `.bak` 与历史快照。可先运行 `capcut diagnose <project>` 查看选择结果与分歧。

如果检测到编辑器仍在运行或文件在加载后被其他进程修改，CLI 会拒绝写入。关闭 CapCut / 剪映后重试；只有明确接受覆盖风险时才使用 `--force-write`。

时间单位内部用微秒（`start_us`、`duration_us`），命令行接受 `1.5s`、`500ms`、`1:00`、`1:30:45` 等格式自动转换。

## 项目位置

- **macOS**：`~/Movies/CapCut/User Data/Projects/com.lveditor.draft/`
- **Windows**：`%LOCALAPPDATA%\CapCut\User Data\Projects\com.lveditor.draft\`
- **剪映**：`~/Movies/JianyingPro/User Data/Projects/com.lveditor.draft/`

## 示例

更多端到端的例子见 [`examples/`](./examples/)。

## 下一步

- **想要完整的短视频流水线（不只是 CLI）？** 拿 [病毒短视频蓝图 + AI Skill](https://renezander.com/zh-cn/guides/automate-xiaohongshu-capcut-cli/?utm_source=capcut-cli&utm_medium=readme&utm_campaign=footer-cn) —— DeepSeek / GLM / Kimi / Qwen 都能跑，专为小红书 + 抖音优化，支付宝 / 微信支付一键下单。
- **问题反馈 / 功能建议**：[`capcut-cli` GitHub Issues](https://github.com/renezander030/capcut-cli/issues)（公开追踪，中英文都接受）
- **作者**：我是 René Zander，开源 + AI 内容自动化系统。本仓库的英文 README 在 [`README.md`](./README.md)。

## 商标声明

CapCut™ 与剪映™ 为字节跳动有限公司（ByteDance Ltd.）的商标。本项目为非官方项目，与字节跳动无隶属或背书关系；相关商标仅用于指称性描述以说明互操作性。

## License

MIT
