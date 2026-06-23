#!/usr/bin/env bash
# First-run setup for lazyclaude. Idempotent, non-blocking.
set -uo pipefail

PLUGIN="lazyclaude"
REPO="oocheol/lazyclaude"

CONFIG_DIR="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
HERE="$(cd "$(dirname "$0")" && pwd)"
MARKER_DIR="$HOME/.gptaku-setup"
SETUP_MARKER="$MARKER_DIR/$PLUGIN.json"
mkdir -p "$MARKER_DIR"

if [ ! -f "$SETUP_MARKER" ]; then
  # Register session-start update notifier
  SCRIPTS_DIR="$CONFIG_DIR/scripts"
  mkdir -p "$SCRIPTS_DIR"
  [ -f "$HERE/lazyclaude-update-check.cjs" ] && cp -f "$HERE/lazyclaude-update-check.cjs" "$SCRIPTS_DIR/lazyclaude-update-check.cjs" 2>/dev/null

  ts=$(date +%s 2>/dev/null || echo 0)
  printf '{"setup":true,"plugin":"%s","ts":%s}\n' "$PLUGIN" "$ts" > "$SETUP_MARKER"
fi
exit 0
