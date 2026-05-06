# Claude AE Assistant

Adobe After Effects 的 Claude AI 助手 — CEP 扩展面板。

在 AE 内用自然语言描述动画需求，Claude 自动生成 ExtendScript 代码并一键执行到 AE 中。

## 功能

- **自然语言生成动画**：聊天式交互，描述需求后自动生成 ExtendScript 代码
- **图层 @ 提及**：输入 `@` 弹出当前合成的图层下拉列表，支持模糊筛选
- **图片支持**：粘贴 / 拖拽 / 上传图片作为参考（基于 Claude Vision）
- **代码预览 + 执行**：生成的代码先预览再执行，安全可控
- **一键撤销**：所有 AI 操作包裹在 undo group 中，可一键回退
- **错误自动修复**：执行失败时点 "🔧 让 Claude 修复" 自动反馈错误并重新生成
- **消息队列**：生成中可继续发消息，自动排队作为补充
- **本地代理支持**：可配置自定义 API 地址，支持 Anthropic 兼容的本地服务

## 安装

### 1. 启用 CEP 调试模式

```bash
defaults write com.adobe.CSXS.10 PlayerDebugMode 1
defaults write com.adobe.CSXS.11 PlayerDebugMode 1
defaults write com.adobe.CSXS.12 PlayerDebugMode 1
```

### 2. 部署扩展

将整个项目目录复制到 AE 的 CEP 扩展目录：

```bash
cp -R . ~/Library/Application\ Support/Adobe/CEP/extensions/com.claude.ae-assistant
```

### 3. 启动 AE

完全退出 AE（Cmd+Q）再重新打开，菜单 **Window > Extensions > Claude AI 助手**。

### 4. 配置 API

点击右上角齿轮图标，填入 Anthropic API 密钥（或本地代理地址）。

## 项目结构

```
.
├── CSXS/manifest.xml         # CEP 扩展清单
├── client/                   # 面板前端
│   ├── index.html
│   ├── css/style.css
│   └── js/
│       ├── CSInterface.js    # Adobe CEP 通信桥
│       ├── main.js           # 主逻辑
│       ├── claude-api.js     # Claude API 集成
│       ├── ae-bridge.js      # AE 通信封装
│       └── settings.js       # 配置存储
└── host/                     # ExtendScript 主机
    └── ae-context.jsx        # 获取 AE 上下文 + 执行代码
```

## 使用技巧

- 在输入框输入 `@` 触发图层下拉
- 选中图层后描述操作，比如 "@图层名 加上弹性缩放动画"
- 执行失败时直接点修复按钮，不用手动复制错误信息
- 生成中可以继续输入新需求，会排队发送

## 兼容性

- After Effects 2025 (16.0+)
- macOS / Windows
