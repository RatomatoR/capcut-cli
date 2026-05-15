# capcut-cli

[English](./README.md) | 中文

命令行编辑 CapCut / 剪映 (JianYing) 项目文件。从零创建草稿、添加素材、修改字幕、把长视频切成短片。

> **想要完整的国产大模型 + 剪映短视频流水线？** `capcut-cli` 是引擎，配套的 **[病毒短视频蓝图（完整教程 + 蓝图下载）](https://renezander.com/zh-cn/guides/automate-xiaohongshu-capcut-cli/?utm_source=capcut-cli&utm_medium=readme&utm_campaign=hero-cn)** 给你完整方法 —— DeepSeek / GLM / Kimi / Qwen 都能跑，专为 **小红书 + 抖音** 优化（不是 YouTube），**支付宝 / 微信支付** 通过 Stripe 直接下单。

## 实战样片

下面这条短片，就是用本套管线产出的成品（60 秒，9:16，可以直接发小红书 / 抖音 / 视频号）：

<video src="https://renezander.com/videos/two-sisters-vietnam-short.mp4" controls width="360" preload="metadata">
您的浏览器不支持内嵌播放器。下载：<a href="https://github.com/renezander030/capcut-cli/raw/master/media/two-sisters-vietnam-short.mp4">GitHub</a> · <a href="https://renezander.com/videos/two-sisters-vietnam-short.mp4">renezander.com</a>
</video>

> 视频文件也在仓库里：[`media/two-sisters-vietnam-short.mp4`](./media/two-sisters-vietnam-short.mp4)。GitHub 内嵌播放需要正确的 MIME 类型，所以上面用 renezander.com 的 CDN（`Content-Type: video/mp4`）；仓库里这份是离线备份和源文件。

完整流程（选题 → 大模型写剧本 → 配音 → 拼草稿）走 **[病毒短视频蓝图教程页](https://renezander.com/zh-cn/guides/automate-xiaohongshu-capcut-cli/?utm_source=capcut-cli&utm_medium=readme&utm_campaign=sample-cn)** 看，里面有 4 步管线 + DeepSeek / GLM 提示词。

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

`templates/` 目录内置 3 个常用模板，安装后即可直接使用：

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

直接读写 `draft_content.json`。所有写入操作前自动创建 `.bak` 备份。

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

## License

MIT
