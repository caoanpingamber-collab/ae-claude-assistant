# Claude AE Assistant

**在 Adobe After Effects 内用自然语言生成动画。**

一个将 Claude AI 集成到 AE 的 CEP 扩展面板。聊天式描述需求，Claude 自动生成 ExtendScript 代码并一键执行到 AE 中。

![Platform: macOS](https://img.shields.io/badge/platform-macOS-blue)
![AE: 2025+](https://img.shields.io/badge/AE-2025%2B-orange)

## ✨ 功能

- 🗣️ **自然语言生成动画** — 聊天式描述需求，自动生成 ExtendScript 并执行
- @ **图层提及** — 输入 `@` 弹出当前合成的图层下拉，支持模糊筛选
- 🖼️ **图片支持** — 粘贴 / 拖拽 / 上传图片作为参考（基于 Claude Vision）
- 👁️ **代码预览** — 生成的代码先预览再执行，安全可控
- ↩️ **一键撤销** — 所有 AI 操作包裹在 undo group 中，可一键回退
- 🔧 **错误自动修复** — 执行失败时一键把错误反馈给 Claude 重新生成
- 📥 **消息队列** — 生成中可继续发消息，自动排队作为补充
- 🌐 **本地代理支持** — 可配置自定义 API 地址，支持兼容 Anthropic 格式的本地服务

## 📦 安装（macOS）

### 方式一：一键安装脚本（推荐）

```bash
git clone https://github.com/caoanpingamber-collab/ae-claude-assistant.git
cd ae-claude-assistant
./install.sh
```

脚本会自动：
- 启用 CEP 调试模式
- 复制到 `~/Library/Application Support/Adobe/CEP/extensions/com.claude.ae-assistant/`

### 方式二：手动安装

```bash
# 1. 启用 CEP 调试模式
defaults write com.adobe.CSXS.11 PlayerDebugMode 1
defaults write com.adobe.CSXS.12 PlayerDebugMode 1

# 2. 复制扩展
mkdir -p ~/Library/Application\ Support/Adobe/CEP/extensions
cp -R ae-claude-assistant ~/Library/Application\ Support/Adobe/CEP/extensions/com.claude.ae-assistant
```

## 🔑 配置 API 密钥

**自带 API 密钥（BYOK）** — 你需要自己的 Anthropic API key 才能使用。

1. 访问 https://console.anthropic.com/ 注册账号
2. 进入 **API Keys** 页面，创建一个新的密钥（`sk-ant-...`）
3. 完全退出 After Effects（Cmd+Q）后重新打开
4. 菜单 **Window > Extensions > Claude AI 助手**
5. 点击面板右上角的齿轮图标，填入密钥并保存

### 使用本地代理

如果你有本地的 Anthropic 兼容代理（如内部转发、Claude Code 中转等），在设置中把 **API 地址** 改为代理地址即可，例如 `http://127.0.0.1:8317`。

## 🎬 使用方法

### 基础对话

直接在输入框描述需求：

```
给选中图层添加从左侧滑入的弹性动画
```

```
创建一个文字飞入效果，逐字出现，带模糊
```

### @ 提及图层

输入 `@` 弹出图层列表，选中后再描述：

```
@Result/Sticker_Vector2 加上火焰持续燃烧的效果
```

### 上传图片参考

- **粘贴**：截图后直接 Ctrl+V / Cmd+V
- **拖拽**：把图片文件拖到面板任意位置
- **点击 📎 按钮**选择文件

然后描述："参考这张图片的动画效果"。

### 错误修复

如果代码执行失败，点击红色错误消息下方的 **🔧 让 Claude 修复**，会自动把错误信息和代码发回给 Claude 重新生成。

### 撤销

每次执行都包裹在一个 undo group 里。可以：
- **AE 里 Cmd+Z** 撤销
- 或点击面板顶部的 **↩** 按钮

## 🏗️ 项目结构

```
.
├── CSXS/manifest.xml         # CEP 扩展清单
├── icons/                    # 面板图标
├── client/                   # 前端面板
│   ├── index.html
│   ├── css/style.css
│   └── js/
│       ├── CSInterface.js    # Adobe CEP 通信桥
│       ├── main.js           # 主逻辑、UI 事件、@ mention
│       ├── claude-api.js     # Claude API 集成 + system prompt
│       ├── ae-bridge.js      # CSInterface 封装
│       └── settings.js       # localStorage 配置
├── host/                     # ExtendScript 主机
│   ├── ae-context.jsx        # 获取 AE 上下文 + 执行代码
│   └── json2.jsx             # JSON polyfill (兼容老版 AE)
├── install.sh                # 一键安装
├── uninstall.sh              # 卸载
└── README.md
```

## ⚠️ 安全说明

- **API 密钥**：保存在 CEP 的 localStorage 中（明文存储于 `~/Library/Application Support/Adobe/CEP/`）
- **代码执行**：Claude 生成的代码通过 `eval()` 在 ExtendScript 中执行；所有代码会在面板里**先预览再执行**，由你点击"执行"才会运行
- **个人工具定位**：本扩展未做沙箱隔离，请只在受信任环境使用

## 🐛 调试

如果面板加载有问题：

```bash
# 查看 CEP 日志
ls ~/Library/Logs/CSXS/ | grep claude

# Chrome DevTools 连接面板
# 1. 启动 AE 并打开扩展
# 2. 浏览器访问 http://localhost:8088
```

## 🛠️ 兼容性

- After Effects 2024+ (Host Version 16.0+)
- macOS（Windows 路径需调整 install.sh）
- Anthropic API（Claude Sonnet 4.6 / Opus 4.7 / Haiku 4.5）

## 📄 License

MIT
