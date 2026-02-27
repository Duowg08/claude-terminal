#!/bin/bash
TAB_ID="$1"
PIPE_NAME="$2"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
bash "$SCRIPT_DIR/pipe-send.sh" "$TAB_ID" "$PIPE_NAME" "tab:ready"

# Set CLAUDE_TERMINAL_TAB_ID for this session
if [ -n "$CLAUDE_ENV_FILE" ]; then
  echo "export CLAUDE_TERMINAL_TAB_ID=\"$TAB_ID\"" >> "$CLAUDE_ENV_FILE"
fi
