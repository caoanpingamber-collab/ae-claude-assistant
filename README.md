# AE AI Assistant

**English** · [中文](README.zh-CN.md)

**Generate motion graphics in Adobe After Effects using natural language. Zero-config — just paste an API key from any AI client you already use.**

Chat-style request → AI inspects AE state via tool calls → generates ExtendScript → executes inside AE. Supports both **Claude (Anthropic)** and **GPT / Codex (OpenAI)**, auto-detected.

![Platform: macOS](https://img.shields.io/badge/platform-macOS-blue)
![AE: 2024+](https://img.shields.io/badge/AE-2024%2B-orange)
![Provider: Claude / OpenAI](https://img.shields.io/badge/provider-Claude%20%7C%20OpenAI-green)
![License: MIT](https://img.shields.io/badge/license-MIT-lightgrey)

## 🚀 Quick start

### For human users

```bash
git clone https://github.com/caoanpingamber-collab/ae-claude-assistant.git
cd ae-claude-assistant
./install.sh
```

**Restart AE** (Cmd+Q then reopen), open `Window > Extensions > Claude AI 助手`, click the gear icon, **paste your API key**. Done.

### For AI-client users (let Claude Code / Codex install it for you)

Just tell your AI client:

> Install the AE plugin from https://github.com/caoanpingamber-collab/ae-claude-assistant and configure it with my API key

It will run:

```bash
git clone https://github.com/caoanpingamber-collab/ae-claude-assistant.git
cd ae-claude-assistant
./install.sh
./configure-key.sh           # auto-detects from env / client config / prompts
```

`configure-key.sh` resolution order:
1. `--key sk-...` argument
2. `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` env var
3. `~/.claude/settings.json` / `~/.codex/auth.json`
4. Interactive prompt as fallback

It writes to `~/.ae-claude-assistant/config.json`, which the plugin reads on first launch — **no need to open the settings panel and paste manually**.

> AI clients (Claude Code, Codex CLI) will not surrender their OAuth token to third-party scripts by default. If neither env vars nor client config holds a plain API key, the AI client will ask you to paste once (or you can use the auth2api path).

## 🔑 Where to get an API key

### 🌟 Recommended: use your existing Claude / ChatGPT subscription (zero API cost)

If you already pay for **Claude Max** or **ChatGPT Plus/Pro**, the bundled `setup-auth2api.sh` will spin up [`auth2api`](https://github.com/AmazingAng/auth2api) — a lightweight proxy that turns OAuth login into a local API endpoint:

```bash
# Claude Max users (default)
./setup-auth2api.sh

# ChatGPT Plus/Pro users
./setup-auth2api.sh codex

# Cursor users (experimental)
./setup-auth2api.sh cursor
```

The script will:
1. Clone + build auth2api into `~/.auth2api/`
2. Open a browser for OAuth login
3. Print the API key + endpoint to paste into the plugin

Then start the proxy in another terminal:
```bash
cd ~/.auth2api && node dist/index.js
```

In the plugin settings:
- **API key**: paste the key from the script (looks like `sk-...`)
- **API endpoint** (advanced): `http://127.0.0.1:8317`

This way the plugin **does not consume API credit** — it uses your subscription quota.

### Direct API key

Or just grab an existing key from your AI client:

| Client | Where the key lives | Protocol |
|---|---|---|
| **Claude Code** | `~/.claude/settings.json` or `ANTHROPIC_API_KEY` env var | Anthropic |
| **Anthropic Console** | https://console.anthropic.com/settings/keys | Anthropic |
| **Codex CLI** | `~/.codex/config.toml` or `OPENAI_API_KEY` env var | OpenAI |
| **OpenAI Console** | https://platform.openai.com/api-keys | OpenAI |
| **Continue / Cursor** | Copy from the client's settings | OpenAI or Anthropic |
| **Local proxy** (LM Studio / Ollama / self-hosted) | Set endpoint in advanced settings | OpenAI-compatible |

The plugin **auto-detects key format**:
- `sk-ant-...` → Anthropic protocol (defaults to Claude Opus 4.7 + extended thinking)
- `sk-...` or `sk-proj-...` → OpenAI protocol (defaults to GPT-5)

No need to pick a provider, configure an endpoint, or choose a model — just paste.

## ✨ Features

- 🤖 **AI investigates AE before writing code** — uses tool use (`query_layer`, `query_effect`, `list_all_layers`) to inspect actual layer structure / keyframes / effect properties before generating code, avoiding blind guesses
- 🔁 **Auto error retry** — if execution fails, the error is fed back to the AI; up to 2 retries before any manual intervention is needed
- 🧠 **Pre-execution validation** — generated code is validated for ES6 anti-patterns (`let`, `const`, arrow fns, template strings, …) before showing the run button; invalid code is auto-corrected via a silent fix pass
- 🧠 **Extended thinking** — Opus 4.x / Sonnet 4.x get a 4096-token thinking budget automatically
- 💬 **`@` layer mention** — type `@` to pop a fuzzy-filtered list of layers in the active comp
- 🖼️ **Vision** — paste / drag / upload images as references
- 🎬 **Video reference** — drop a video → 6-frame extraction + temporal summary attached
- 📎 **File attachments** — JSON / text / code / Zip files. JSON is auto-minified. Folders can be drag-dropped (recursive traversal)
- 👁️ **Code preview** — generated code is shown before execution
- ↩️ **One-click undo** — every AI operation is wrapped in a single undo group
- 📥 **Message queue** — keep typing while a request is in flight; messages are queued and merged
- 💾 **Persistent chat history** — survives panel reload; capped at 100 entries
- ⌨️ **CEP polyfills** — `Cmd+C` copy in chat bubbles, text selection, etc.

## 🎬 Usage

### Basic

```
@layerName add a fade-in-from-below entrance with elastic bounce, 0.6s
```

```
Add a staggered cascade entrance to all layers in this comp, 0.1s offset between each
```

### Complex tasks (AI investigates)

```
@flame add a turbulent burn effect with the bottom edge pinned, mimicking real flame physics
```
→ AI first calls `query_layer("flame")` to inspect the layer, then `query_effect` to discover the Wave Warp / Turbulent Displace properties, then writes code.

### Image / video reference

- **Paste**: take a screenshot, then `Cmd+V` in the input box
- **Drag**: drop an image/video file anywhere on the panel
- **Click 📎**: file picker for images / videos / JSON / text / code / Zip

Videos auto-extract 6 frames + Haiku-generated temporal summary; thumbnail shows a ▶ badge.

### Error handling

When code fails to execute, **auto-retry kicks in** — no need to click anything:
1. Error is fed back to the AI
2. AI uses tools to investigate the actual state and find the cause
3. Regenerates and re-executes
4. Up to 2 retries before falling back to a manual `🔧 Fix` button

## 🏗️ Project structure

```
.
├── CSXS/manifest.xml
├── client/
│   ├── index.html                  # Panel UI
│   ├── css/style.css
│   └── js/
│       ├── CSInterface.js          # Adobe CEP communication bridge
│       ├── main.js                 # Main logic, UI events, @ mention, files
│       ├── claude-api.js           # Anthropic + OpenAI dual-protocol + tool loop
│       ├── ae-bridge.js            # CSInterface wrapper + tool dispatch
│       └── settings.js             # Auto-detection + localStorage
├── host/
│   ├── ae-context.jsx              # ExtendScript: tool impls + code execution
│   └── json2.jsx                   # JSON polyfill (legacy AE fallback)
├── install.sh / uninstall.sh
├── configure-key.sh                # AI-client-driven key setup
├── setup-auth2api.sh               # Auth2api bootstrap (subscription users)
└── README.md
```

## 🛠️ Compatibility

- After Effects 2024+ (Host Version 16.0+)
- macOS (Windows requires path adjustments in `install.sh`)
- API: Anthropic Messages / OpenAI Chat Completions
- Models: Claude Sonnet 4.6 / Opus 4.7, GPT-5, o1 / o3, local-compatible services, …

## ⚠️ Security notes

- **API key**: stored in CEP localStorage (plain text under `~/Library/Application Support/Adobe/CEP/`)
- **Code execution**: AI-generated code is **previewed** in the panel and only runs after you click "Execute"; it's wrapped in a single undo group
- **Personal-tool scope**: no sandbox isolation — use only in trusted environments

## 🐛 Debugging

```bash
ls ~/Library/Logs/CSXS/ | grep claude    # CEP logs
# Browse to http://localhost:8088 → Chrome DevTools attaches to the panel
```

## 📄 License

MIT
