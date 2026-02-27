// Hook: SessionStart — send tab:ready with session_id
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const pipeSend = path.join(__dirname, 'pipe-send.js');
const debugLog = path.join(os.tmpdir(), 'claude-terminal-hook-debug.log');

function debugAppend(msg) {
  try { fs.appendFileSync(debugLog, `[${new Date().toISOString()}] ${msg}\n`); } catch {}
}

// Read hook input from stdin
let input = '';
process.stdin.on('data', (c) => (input += c));
process.stdin.on('end', () => {
  debugAppend(`on-session-start input: ${input.substring(0, 500)}`);
  let sessionId = '';
  let source = '';
  try {
    const j = JSON.parse(input);
    sessionId = j.session_id || '';
    source = j.source || '';
    debugAppend(`parsed session_id: "${sessionId}" source: "${source}"`);
  } catch (e) {
    debugAppend(`parse error: ${e.message}`);
  }
  debugAppend(`sending tab:ready with sessionId="${sessionId}" source="${source}" tabId="${process.env.CLAUDE_TERMINAL_TAB_ID}"`);
  execFileSync('node', [pipeSend, 'tab:ready', JSON.stringify({ sessionId, source })], { timeout: 5000 });
});
