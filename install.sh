#!/usr/bin/env bash
# Claude AE Assistant - 一键安装脚本 (macOS)
set -e

EXT_ID="com.claude.ae-assistant"
SCRIPT_DIR="$( cd -- "$( dirname -- "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"
TARGET_DIR="$HOME/Library/Application Support/Adobe/CEP/extensions/$EXT_ID"

echo "📦 Claude AE Assistant 安装"
echo "源目录: $SCRIPT_DIR"
echo "目标目录: $TARGET_DIR"
echo ""

# 1. 启用 CEP 调试模式（不签名扩展所必需）
echo "🔧 启用 CEP 调试模式..."
defaults write com.adobe.CSXS.10 PlayerDebugMode 1
defaults write com.adobe.CSXS.11 PlayerDebugMode 1
defaults write com.adobe.CSXS.12 PlayerDebugMode 1

# 2. 创建目标目录的父目录
mkdir -p "$HOME/Library/Application Support/Adobe/CEP/extensions"

# 3. 删除旧版（如有）
if [ -d "$TARGET_DIR" ]; then
  echo "🗑  删除旧版本..."
  rm -rf "$TARGET_DIR"
fi

# 4. 复制扩展（排除 .git / install / uninstall / build 脚本）
echo "📋 复制文件..."
mkdir -p "$TARGET_DIR"
rsync -a --exclude='.git' --exclude='install.sh' --exclude='uninstall.sh' --exclude='build-zxp.sh' --exclude='*.zxp' --exclude='.DS_Store' "$SCRIPT_DIR/" "$TARGET_DIR/"

echo ""
echo "✅ 安装完成"
echo ""
echo "下一步："
echo "1. 完全退出 After Effects (Cmd+Q)"
echo "2. 重新打开 AE"
echo "3. 菜单 Window > Extensions > Claude AI 助手"
echo "4. 点击右上角齿轮图标，填入你的 Anthropic API 密钥"
echo "   （从 https://console.anthropic.com/ 获取）"
