#!/bin/bash
TAB_ID="$1"
PIPE_NAME="$2"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
bash "$SCRIPT_DIR/pipe-send.sh" "$TAB_ID" "$PIPE_NAME" "tab:status:idle"
