#!/usr/bin/env bash
# configure-key.sh
# Sets up the plugin's API key WITHOUT requiring the user to manually paste it.
# Designed to be runnable by an AI client (Claude Code / Codex CLI) on the user's
# behalf — the AI just needs to either pass --key, or have ANTHROPIC_API_KEY /
# OPENAI_API_KEY in env, or point to its own client config.
#
# Usage:
#   ./configure-key.sh                          # auto-detect from env / known clients
#   ./configure-key.sh --key sk-ant-xxx         # explicit key
#   ./configure-key.sh --endpoint http://...    # custom endpoint
#   ./configure-key.sh --auth2api               # set up auth2api flow

set -e

CONFIG_DIR="$HOME/.ae-claude-assistant"
CONFIG_FILE="$CONFIG_DIR/config.json"

KEY=""
ENDPOINT=""
MODEL=""

# Parse args
while [[ $# -gt 0 ]]; do
    case $1 in
        --key) KEY="$2"; shift 2;;
        --endpoint) ENDPOINT="$2"; shift 2;;
        --model) MODEL="$2"; shift 2;;
        --auth2api)
            DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
            exec "$DIR/setup-auth2api.sh"
            ;;
        *) echo "Unknown arg: $1"; exit 1;;
    esac
done

# Auto-detect from env if no --key given
if [ -z "$KEY" ]; then
    if [ -n "$ANTHROPIC_API_KEY" ]; then
        KEY="$ANTHROPIC_API_KEY"
        echo "==> Using ANTHROPIC_API_KEY from environment"
    elif [ -n "$OPENAI_API_KEY" ]; then
        KEY="$OPENAI_API_KEY"
        echo "==> Using OPENAI_API_KEY from environment"
    fi
fi

# Auto-detect from Claude Code config
if [ -z "$KEY" ] && [ -f "$HOME/.claude/settings.json" ]; then
    DETECTED=$(grep -oE '"api_key"\s*:\s*"sk-[^"]+"' "$HOME/.claude/settings.json" 2>/dev/null | head -1 | sed 's/.*"\(sk-[^"]*\)".*/\1/')
    if [ -n "$DETECTED" ]; then
        KEY="$DETECTED"
        echo "==> Found API key in ~/.claude/settings.json"
    fi
fi

# Auto-detect from Codex CLI config
if [ -z "$KEY" ] && [ -f "$HOME/.codex/auth.json" ]; then
    DETECTED=$(grep -oE '"OPENAI_API_KEY"\s*:\s*"[^"]+"' "$HOME/.codex/auth.json" 2>/dev/null | head -1 | sed 's/.*"\([^"]*\)"$/\1/' | sed 's/.*"//')
    if [ -n "$DETECTED" ]; then
        KEY="$DETECTED"
        echo "==> Found API key in ~/.codex/auth.json"
    fi
fi

# Prompt user if still nothing
if [ -z "$KEY" ]; then
    echo ""
    echo "No API key found in environment or known client configs."
    echo ""
    echo "Options:"
    echo "  1) Paste your API key (sk-ant-... for Claude, sk-... for OpenAI)"
    echo "  2) Run ./setup-auth2api.sh first (uses your Claude Max / ChatGPT Plus subscription, free)"
    echo "  3) Cancel"
    echo ""
    printf "Paste API key (or 'q' to quit): "
    read -r KEY
    if [ "$KEY" = "q" ] || [ -z "$KEY" ]; then
        echo "Cancelled."
        exit 1
    fi
fi

# Detect provider from key prefix
PROVIDER=""
if [[ "$KEY" == sk-ant-* ]]; then
    PROVIDER="anthropic"
    [ -z "$ENDPOINT" ] && ENDPOINT="https://api.anthropic.com"
    [ -z "$MODEL" ] && MODEL="claude-opus-4-7"
elif [[ "$KEY" == sk-* ]]; then
    PROVIDER="openai"
    [ -z "$ENDPOINT" ] && ENDPOINT="https://api.openai.com"
    [ -z "$MODEL" ] && MODEL="gpt-5"
else
    echo "WARN: Unrecognized key format. Defaulting to Anthropic. Override with --endpoint."
    PROVIDER="anthropic"
    [ -z "$ENDPOINT" ] && ENDPOINT="https://api.anthropic.com"
    [ -z "$MODEL" ] && MODEL="claude-opus-4-7"
fi

# Write config file
mkdir -p "$CONFIG_DIR"
cat > "$CONFIG_FILE" <<EOF
{
  "provider": "$PROVIDER",
  "api_key": "$KEY",
  "api_endpoint": "$ENDPOINT",
  "model": "$MODEL"
}
EOF
chmod 600 "$CONFIG_FILE"

echo ""
echo "================================================================"
echo "  ✓ Configured."
echo ""
echo "    Provider: $PROVIDER"
echo "    Endpoint: $ENDPOINT"
echo "    Model:    $MODEL"
echo "    Config:   $CONFIG_FILE"
echo ""
echo "  Next: restart After Effects (Cmd+Q then reopen). The plugin"
echo "  will pick up this config on first launch."
echo "================================================================"
