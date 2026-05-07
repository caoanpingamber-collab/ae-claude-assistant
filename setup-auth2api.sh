#!/usr/bin/env bash
# setup-auth2api.sh
# Bootstraps auth2api for users who want zero-cost API access via their
# existing Claude Max / ChatGPT Plus/Pro / Cursor subscription.
#
# auth2api: https://github.com/AmazingAng/auth2api
# It exposes Claude OAuth or ChatGPT OAuth as a local API endpoint
# (Anthropic-native + OpenAI-compatible) on http://127.0.0.1:8317.
#
# Usage:
#   ./setup-auth2api.sh              # default: Claude (Anthropic)
#   ./setup-auth2api.sh codex        # ChatGPT Plus/Pro
#   ./setup-auth2api.sh cursor       # experimental Cursor

set -e

PROVIDER="${1:-anthropic}"
INSTALL_DIR="${AUTH2API_DIR:-$HOME/.auth2api}"

echo "==> Setting up auth2api for provider: $PROVIDER"

# Check Node.js
if ! command -v node >/dev/null 2>&1; then
    echo "ERROR: Node.js 20+ required but not found."
    echo "Install via: brew install node"
    exit 1
fi
NODE_MAJOR=$(node -p "process.versions.node.split('.')[0]")
if [ "$NODE_MAJOR" -lt 20 ]; then
    echo "ERROR: Node.js 20+ required, found $(node -v)"
    exit 1
fi

# Clone or update
if [ -d "$INSTALL_DIR" ]; then
    echo "==> Updating existing install at $INSTALL_DIR"
    cd "$INSTALL_DIR"
    git pull --ff-only
else
    echo "==> Cloning into $INSTALL_DIR"
    git clone https://github.com/AmazingAng/auth2api "$INSTALL_DIR"
    cd "$INSTALL_DIR"
fi

# Build
echo "==> Installing deps and building"
npm install --silent
npm run build --silent

# Login
echo ""
echo "==> Starting OAuth login flow ($PROVIDER)"
echo "    A browser window will open. Authorize, then come back here."
echo ""
case "$PROVIDER" in
    anthropic|claude)
        node dist/index.js --login
        ;;
    codex|chatgpt|openai)
        node dist/index.js --login --provider=codex
        ;;
    cursor)
        node dist/index.js --login --provider=cursor
        ;;
    *)
        echo "Unknown provider: $PROVIDER (use anthropic | codex | cursor)"
        exit 1
        ;;
esac

# Find API key from config
CONFIG_FILE="$INSTALL_DIR/config.yaml"
if [ -f "$CONFIG_FILE" ]; then
    API_KEY=$(grep -E '^(api_key|apikey|api-key):' "$CONFIG_FILE" | head -1 | sed 's/^[^:]*:[[:space:]]*//' | tr -d '"' | tr -d "'")
    echo ""
    echo "================================================================"
    echo "  ✓ auth2api configured."
    echo ""
    echo "  In the AE Claude Assistant panel, click ⚙ and enter:"
    echo ""
    echo "    API 密钥:  $API_KEY"
    echo "    API 地址:  http://127.0.0.1:8317  (高级设置里填)"
    echo ""
    echo "  Then start the proxy in another terminal:"
    echo ""
    echo "    cd $INSTALL_DIR"
    echo "    node dist/index.js"
    echo ""
    echo "  Keep that terminal running while you use the AE plugin."
    echo "================================================================"
else
    echo ""
    echo "WARN: $CONFIG_FILE not found yet. Run:"
    echo "    cd $INSTALL_DIR && node dist/index.js"
    echo "to generate it, then check the auto-generated api_key."
fi
