#!/usr/bin/env bash
# Claude AE Assistant - 卸载脚本
set -e

EXT_ID="com.claude.ae-assistant"
TARGET_DIR="$HOME/Library/Application Support/Adobe/CEP/extensions/$EXT_ID"

if [ -d "$TARGET_DIR" ]; then
  rm -rf "$TARGET_DIR"
  echo "✅ 已卸载: $TARGET_DIR"
else
  echo "⚠  扩展未安装于: $TARGET_DIR"
fi

echo ""
echo "提示：扩展面板的 API 密钥/对话历史保存在 AE 的 localStorage 中，"
echo "卸载扩展不会清除。完全清理可手动删除："
echo "  ~/Library/Application Support/Adobe/CEP/cookies/"
