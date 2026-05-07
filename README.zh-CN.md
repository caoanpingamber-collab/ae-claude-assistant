# AE AI Assistant

[**English**](README.md) · 中文

**在 Adobe After Effects 里用自然语言生成动画。无脑使用——粘贴你已有的 AI 客户端 API key 就能跑。**

聊天式描述需求 → AI 主动调用工具调查 AE 状态 → 生成 ExtendScript → 执行到 AE。支持 **Claude（Anthropic）和 GPT/Codex（OpenAI）**，自动识别。

![Platform: macOS](https://img.shields.io/badge/platform-macOS-blue)
![AE: 2024+](https://img.shields.io/badge/AE-2024%2B-orange)
![Provider: Claude / OpenAI](https://img.shields.io/badge/provider-Claude%20%7C%20OpenAI-green)

## 🚀 三步上手

### 给人类用户

```bash
git clone https://github.com/caoanpingamber-collab/ae-claude-assistant.git
cd ae-claude-assistant
./install.sh
```

**重启 AE**（Cmd+Q 后重开），打开 Window > Extensions > Claude AI 助手，点齿轮图标，**粘贴你的 API key**，结束。

### 给 AI 客户端用户（让 Claude Code / Codex 帮你装）

直接对你的 AI 客户端说：

> 帮我装 https://github.com/caoanpingamber-collab/ae-claude-assistant 这个 AE 插件，并用我的 API key 配置好

它会执行：

```bash
git clone https://github.com/caoanpingamber-collab/ae-claude-assistant.git
cd ae-claude-assistant
./install.sh
./configure-key.sh           # 自动读取 env / 客户端配置 / 提示粘贴
```

`configure-key.sh` 的查找顺序：
1. `--key sk-...` 命令行参数
2. `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` 环境变量
3. `~/.claude/settings.json` / `~/.codex/auth.json`
4. 都没有就交互式提示粘贴

写入到 `~/.ae-claude-assistant/config.json`，插件首次启动时自动读取，**用户不用打开设置面板手动粘贴**。

> AI 客户端（Claude Code / Codex CLI）出于安全默认不会把自己的 OAuth token 给第三方脚本。如果环境变量没设、客户端配置里也没明文 key，AI 客户端会要求你手动粘一次（或选择走 auth2api 路径）。

## 🔑 API key 哪里来？

### 🌟 推荐：用你已有的 Claude / ChatGPT 订阅（零 API 费用）

如果你已经有 **Claude Max 订阅**或 **ChatGPT Plus/Pro 订阅**，本仓库自带的 `setup-auth2api.sh` 会自动帮你跑起 [`auth2api`](https://github.com/AmazingAng/auth2api)（一个把 OAuth 登录转成本地 API endpoint 的轻量代理）：

```bash
# Claude Max 用户（默认）
./setup-auth2api.sh

# ChatGPT Plus/Pro 用户
./setup-auth2api.sh codex

# Cursor 用户（实验性）
./setup-auth2api.sh cursor
```

脚本会：
1. clone + build auth2api 到 `~/.auth2api/`
2. 弹浏览器让你 OAuth 登录
3. 打印插件需要填的 API key 和 endpoint

之后在另一个 terminal 启动代理：
```bash
cd ~/.auth2api && node dist/index.js
```

在插件设置里：
- **API 密钥**：粘贴脚本输出的 key（形如 `sk-...`）
- **API 地址**（高级设置）：`http://127.0.0.1:8317`

完成。这样使用插件**不会消耗 API 余额**，走的是你的订阅配额。

### 直接用 API key

或者直接从你的 AI 客户端拿现有 API key：

| 你装了什么客户端 | API key 在哪 | 协议 |
|---|---|---|
| **Claude Code** | `~/.claude/settings.json` 或 `ANTHROPIC_API_KEY` 环境变量 | Anthropic |
| **Anthropic Console** | https://console.anthropic.com/settings/keys | Anthropic |
| **Codex CLI** | `~/.codex/config.toml` 或 `OPENAI_API_KEY` 环境变量 | OpenAI |
| **OpenAI Console** | https://platform.openai.com/api-keys | OpenAI |
| **Continue / Cursor** | 客户端设置里复制 | OpenAI 或 Anthropic |
| **本地代理** (LM Studio / Ollama / 自建) | 高级设置里填 endpoint | OpenAI 兼容 |

插件**自动识别 key 格式**：
- `sk-ant-...` → 走 Anthropic 协议（默认 Claude Opus 4.7 + extended thinking）
- `sk-...` 或 `sk-proj-...` → 走 OpenAI 协议（默认 GPT-5）

不用选 provider，不用配 endpoint，不用挑 model——粘贴就行。

## ✨ 功能

- 🤖 **AI 主动调查 AE** — 用 tool use，写代码前先 query_layer / query_effect 调查图层结构、关键帧、效果属性，避免盲写
- 🔁 **自动错误重试** — 执行失败后自动反馈错误回 AI，最多重试 2 次，几乎无需手动干预
- 🧠 **Extended thinking** — Opus 4.x / Sonnet 4.x 自动启用 4096 tokens 思考预算
- @ **图层提及** — 输入 `@` 弹出当前合成图层列表，支持模糊筛选
- 🖼️ **图片识别** — 粘贴 / 拖拽 / 上传图片作为参考（vision 多模态）
- 🎬 **视频识别** — 拖入视频自动抽帧 + 时序分析，附在请求里
- 👁️ **代码预览** — 生成的代码先预览再执行
- ↩️ **一键撤销** — 所有 AI 操作包裹在 undo group 中
- 📥 **消息队列** — 生成中可继续发消息排队作为补充
- 💾 **聊天记录持久化** — 关闭面板再打开历史还在
- ⌨️ **CEP 标准缺失补全** — Cmd+C 复制、文本选中等

## 🎬 使用方法

### 基础

```
@图层名 加一个从下方淡入弹起的入场，0.6 秒，回弹强烈
```

```
给当前合成所有图层做一个错落出现的级联效果，每个差 0.1 秒
```

### 复杂任务（AI 会自己调查）

```
@火焰 加一个底部固定的湍流燃烧效果，参考火苗的物理感
```
→ AI 会先 `query_layer("火焰")` 看图层结构，再 `query_effect` 拿到湍流置换的可设置属性，再写代码。

### 上传图片/视频参考

- **粘贴**：截图后直接 Ctrl+V / Cmd+V
- **拖拽**：图片或视频文件拖到面板任意位置
- **点📎**：选文件

视频会自动抽 6 帧 + Haiku 分析时序，缩略图带 ▶ 标记。

### 错误处理

代码执行失败时**会自动重试**——不需要你点修复按钮：
1. 错误回喂给 AI
2. AI 用工具调查实际状态，定位错误
3. 重新生成代码再执行
4. 最多 2 次自动重试，再失败才弹手动修复按钮

## 🏗️ 项目结构

```
.
├── CSXS/manifest.xml
├── client/
│   ├── index.html                  # 面板 UI
│   ├── css/style.css
│   └── js/
│       ├── CSInterface.js          # Adobe CEP 通信桥
│       ├── main.js                 # 主逻辑、UI 事件、@ mention
│       ├── claude-api.js           # Anthropic + OpenAI 双协议 + tool 循环
│       ├── ae-bridge.js            # CSInterface 封装 + tool 调用
│       └── settings.js             # 自动识别 + localStorage
├── host/
│   ├── ae-context.jsx              # ExtendScript: 工具实现 + 代码执行
│   └── json2.jsx                   # JSON polyfill
├── install.sh / uninstall.sh
└── README.md
```

## 🛠️ 兼容性

- After Effects 2024+ (Host Version 16.0+)
- macOS（Windows 路径需调整 install.sh）
- API: Anthropic Messages / OpenAI Chat Completions
- 模型: Claude Sonnet 4.6 / Opus 4.7、GPT-5、o1/o3、本地兼容服务等

## ⚠️ 安全说明

- **API 密钥**：保存在 CEP localStorage（明文于 `~/Library/Application Support/Adobe/CEP/`）
- **代码执行**：AI 生成的代码会在面板**预览**后由你点"执行"才运行，包裹在 undo group 中
- **个人工具**：未做沙箱隔离，请只在受信任环境使用

## 🐛 调试

```bash
ls ~/Library/Logs/CSXS/ | grep claude    # CEP 日志
# 浏览器访问 http://localhost:8088 → Chrome DevTools 连接面板
```

## 📄 License

MIT
