#!/bin/bash
# Sends a JSON message to the ClaudeTerminal named pipe.
# Usage: pipe-send.sh <tab-id> <pipe-name> <event> [data]

TAB_ID="$1"
PIPE_NAME="$2"
EVENT="$3"
DATA="${4:-null}"

if [ "$DATA" != "null" ]; then
  DATA="\"$(echo "$DATA" | sed 's/"/\\\\"/g')\""
fi

MSG="{\"tabId\":\"${TAB_ID}\",\"event\":\"${EVENT}\",\"data\":${DATA}}"

# Write to named pipe using Node.js (portable across Windows/WSL)
# Pass pipe name and message via env vars to avoid backslash escaping issues
PIPE_MSG="$MSG" PIPE_PATH="$PIPE_NAME" node -e "
  const net = require('net');
  const pipePath = process.env.PIPE_PATH;
  const msg = process.env.PIPE_MSG;
  const client = net.createConnection(pipePath, () => {
    client.end(msg + '\n');
  });
  client.on('close', () => process.exit(0));
  client.on('error', () => process.exit(0));
  setTimeout(() => process.exit(0), 3000);
"
