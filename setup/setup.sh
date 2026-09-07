#!/usr/bin/env bash
# First-run setup for lazyclaude. Idempotent, non-blocking.
# Records an optional one-time marker so re-runs are cheap. The plugin has no
# build or activation step: Claude Code loads it when explicitly supplied via
# `claude --plugin-dir <path>` (or through the installer run command).
set -euo pipefail

PLUGIN="lazyclaude"

MARKER_DIR="$HOME/.lazyclaude-setup"
SETUP_MARKER="$MARKER_DIR/$PLUGIN.json"
mkdir -p "$MARKER_DIR"

if [ ! -f "$SETUP_MARKER" ]; then
  ts=$(date +%s 2>/dev/null || echo 0)
  printf '{"setup":true,"plugin":"%s","ts":%s}\n' "$PLUGIN" "$ts" > "$SETUP_MARKER"
  echo "lazyclaude: first-run setup complete."
fi
exit 0
