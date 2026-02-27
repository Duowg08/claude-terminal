#!/bin/bash
TAB_ID="$1"
PIPE_NAME="$2"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Read the prompt from stdin JSON
INPUT=$(cat)
PROMPT=$(echo "$INPUT" | node -e "
  let d='';
  process.stdin.on('data',c=>d+=c);
  process.stdin.on('end',()=>{
    try{
      const j=JSON.parse(d);
      const p=j.user_prompt||j.prompt||'';
      process.stdout.write(p.substring(0,40).replace(/\s+\S*$/,''));
    }catch{process.stdout.write('')}
  });
" 2>/dev/null)

if [ -n "$PROMPT" ]; then
  bash "$SCRIPT_DIR/pipe-send.sh" "$TAB_ID" "$PIPE_NAME" "tab:name" "$PROMPT"
fi
