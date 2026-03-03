# Tab Auto-Naming with Claude Haiku

## Problem

Tabs are currently named by truncating the first 40 characters of the user's prompt. This produces low-quality, often meaningless names.

## Solution

Use Claude Haiku via the `claude` CLI to generate a concise 3-5 word tab title based on the first prompt in each session.

## Design

### Trigger

The `on-prompt-submit.sh` hook fires on every prompt. On the **first prompt only** (tracked via a flag file), it sends a `tab:generate-name` event to the main process with the full prompt text.

### Flow

```
User submits first prompt
  → on-prompt-submit.sh reads prompt from stdin
  → Checks flag file: /tmp/claude-terminal-named-{tabId}
  → If not exists: sends tab:generate-name event via pipe, creates flag file
  → Hook exits immediately (no blocking)

Main process receives tab:generate-name
  → Spawns: claude -p --model claude-haiku-4-5-20251001 "Generate a 3-5 word tab title..."
  → Async, fire-and-forget
  → On completion: tabManager.rename(tabId, result), broadcast tab:updated
  → On failure: no-op (tab keeps default "Tab N" name)
```

### Changes

1. **`src/hooks/on-prompt-submit.sh`** — Replace truncation logic with `tab:generate-name` event on first prompt only. Use flag file `/tmp/claude-terminal-named-{tabId}` to track.

2. **`src/main/index.ts`** — Add handler for `tab:generate-name` in `handleHookMessage()`. Spawn `claude -p` as async child process via `child_process.execFile`. On stdout, trim and rename the tab.

3. No renderer or preload changes needed.

### Prompt Template

```
Generate a short tab title (3-5 words) for a coding conversation that starts with this message. Reply with ONLY the title, no quotes, no punctuation:

{user_prompt}
```

### Edge Cases

- If `claude` CLI is not in PATH or fails: silently ignore, tab keeps its default name.
- If the response is empty or too long (>50 chars): discard it.
- Flag file cleanup: not strictly necessary (temp dir), but could be cleaned up on tab close.
