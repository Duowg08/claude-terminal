# Tab Auto-Naming with Claude Haiku — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Auto-name tabs using Claude Haiku via the `claude` CLI on the first user prompt.

**Architecture:** The `on-prompt-submit.sh` hook sends a `tab:generate-name` event (first prompt only, tracked via flag file). The main process handles this event by spawning `claude -p --model claude-haiku-4-5-20251001` asynchronously, then renames the tab when it returns.

**Tech Stack:** Bash (hook script), Node.js `child_process.execFile` (main process), `claude` CLI

---

### Task 1: Update the hook script to send `tab:generate-name` on first prompt

**Files:**
- Modify: `src/hooks/on-prompt-submit.sh`

**Step 1: Replace the hook script**

The current script truncates the prompt to 40 chars and sends `tab:name`. Replace it so that:
- On the first prompt (no flag file exists), it sends `tab:generate-name` with the full prompt (capped at 500 chars to avoid huge payloads) and creates the flag file.
- On subsequent prompts, it does nothing (no naming).

```bash
#!/bin/bash
TAB_ID="$1"
PIPE_NAME="$2"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Only name the tab on the first prompt
FLAG_FILE="/tmp/claude-terminal-named-${TAB_ID}"
if [ -f "$FLAG_FILE" ]; then
  exit 0
fi
touch "$FLAG_FILE"

# Read the prompt from stdin JSON
INPUT=$(cat)
PROMPT=$(echo "$INPUT" | node -e "
  let d='';
  process.stdin.on('data',c=>d+=c);
  process.stdin.on('end',()=>{
    try{
      const j=JSON.parse(d);
      const p=j.user_prompt||j.prompt||'';
      process.stdout.write(p.substring(0,500));
    }catch{process.stdout.write('')}
  });
" 2>/dev/null)

if [ -n "$PROMPT" ]; then
  bash "$SCRIPT_DIR/pipe-send.sh" "$TAB_ID" "$PIPE_NAME" "tab:generate-name" "$PROMPT"
fi
```

**Step 2: Verify the script is syntactically valid**

Run: `bash -n src/hooks/on-prompt-submit.sh`
Expected: no output (no syntax errors)

**Step 3: Commit**

```bash
git add src/hooks/on-prompt-submit.sh
git commit -m "feat: hook sends tab:generate-name on first prompt only"
```

---

### Task 2: Handle `tab:generate-name` in the main process

**Files:**
- Modify: `src/main/index.ts` (the `handleHookMessage` function, lines 119-173)

**Step 1: Add the import**

At the top of `src/main/index.ts`, add:

```typescript
import { execFile } from 'child_process';
```

**Step 2: Add the `tab:generate-name` case to `handleHookMessage`**

Inside the `switch (event)` block (before the `default:` case at line 164), add a new case:

```typescript
    case 'tab:generate-name':
      if (data) {
        generateTabName(tabId, data);
      }
      return; // don't broadcast tab:updated yet — the async call will do it
```

**Step 3: Add the `generateTabName` function**

Add this function above `handleHookMessage` (around line 117):

```typescript
function generateTabName(tabId: string, prompt: string) {
  const namePrompt = `Generate a short tab title (3-5 words) for a coding conversation that starts with this message. Reply with ONLY the title, no quotes, no punctuation:\n\n${prompt}`;

  const isWindows = process.platform === 'win32';
  const cmd = isWindows ? 'cmd.exe' : 'claude';
  const args = isWindows
    ? ['/c', 'claude', '-p', '--model', 'claude-haiku-4-5-20251001', namePrompt]
    : ['-p', '--model', 'claude-haiku-4-5-20251001', namePrompt];

  execFile(cmd, args, { timeout: 30000 }, (err, stdout) => {
    if (err) return; // silently ignore failures

    const name = stdout.trim().replace(/^["']|["']$/g, '').substring(0, 50);
    if (!name) return;

    const tab = tabManager.getTab(tabId);
    if (!tab) return;

    tabManager.rename(tabId, name);
    const updated = tabManager.getTab(tabId);
    if (updated) {
      sendToRenderer('tab:updated', updated);
    }
  });
}
```

Key details:
- Uses `cmd.exe /c claude` on Windows (same pattern as `pty-manager.ts` since `claude` is a `.cmd` wrapper)
- 30s timeout — generous but prevents zombie processes
- Strips quotes from response (Haiku sometimes wraps in quotes despite instructions)
- Caps at 50 chars as a safety net
- Silently no-ops on any failure

**Step 4: Commit**

```bash
git add src/main/index.ts
git commit -m "feat: generate tab names with Claude Haiku in background"
```

---

### Task 3: Clean up flag files on tab close

**Files:**
- Modify: `src/main/index.ts` (the `tab:close` handler, lines 239-251, and the `tab:closed` hook case, lines 152-156)

**Step 1: Add cleanup helper**

Add this near the top of the file (after imports):

```typescript
import fs from 'node:fs';
import os from 'node:os';

function cleanupNamingFlag(tabId: string) {
  const flagFile = path.join(os.tmpdir(), `claude-terminal-named-${tabId}`);
  fs.unlink(flagFile, () => {}); // best-effort, ignore errors
}
```

Note: `path` is already imported. `fs` and `os` are new imports.

**Step 2: Call cleanup in the `tab:close` IPC handler**

In the `tab:close` handler (around line 239), add `cleanupNamingFlag(tabId)` after `ptyManager.kill(tabId)`:

```typescript
  ipcMain.handle('tab:close', async (_event, tabId: string) => {
    ptyManager.kill(tabId);
    cleanupNamingFlag(tabId);
    const tab = tabManager.getTab(tabId);
    // ... rest unchanged
```

**Step 3: Call cleanup in the `tab:closed` hook case**

In `handleHookMessage`, in the `tab:closed` case (around line 152):

```typescript
    case 'tab:closed':
      cleanupNamingFlag(tabId);
      tabManager.removeTab(tabId);
      ptyManager.kill(tabId);
      sendToRenderer('tab:removed', tabId);
      return;
```

**Step 4: Commit**

```bash
git add src/main/index.ts
git commit -m "feat: clean up naming flag files on tab close"
```

---

### Task 4: Manual test

**Step 1: Start the app**

Run: `pnpm start`

**Step 2: Create a new tab and submit a prompt**

Type something like: "Help me set up a REST API with Express and TypeScript"

**Step 3: Verify**

- The tab should initially show "Tab 1" (or the worktree name)
- After a few seconds, the tab name should update to something like "Express TypeScript REST API"
- Submit a second prompt — the tab name should NOT change

**Step 4: Verify edge case**

- Close the tab, create a new one
- Submit a short prompt like "hi"
- Verify it still gets a reasonable name (e.g., "Greeting Chat")
