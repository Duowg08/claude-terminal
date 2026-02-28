// Hook: SessionStart — send tab:ready with session_id
const { execFileSync } = require('child_process');
const path = require('path');
const pipeSend = path.join(__dirname, 'pipe-send.js');

// Read hook input from stdin
let input = '';
process.stdin.on('data', (c) => (input += c));
process.stdin.on('end', () => {
  let sessionId = '';
  let source = '';
  try {
    const j = JSON.parse(input);
    sessionId = j.session_id || '';
    source = j.source || '';
  } catch {
    // stdin may be empty or malformed
  }
  execFileSync('node', [pipeSend, 'tab:ready', JSON.stringify({ sessionId, source })], { timeout: 5000 });
});
