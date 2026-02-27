# Tab Session Persistence Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Persist tabs across app restarts so reopening a workspace directory resumes previous conversations via `claude --resume <sessionId>`.

**Architecture:** Capture Claude's `session_id` from the SessionStart hook, store per-directory tab snapshots in the existing SettingsStore JSON file, and restore tabs with `--resume` on next startup.

**Tech Stack:** Electron IPC, node-pty, bash hooks, plain JSON persistence

---

### Task 1: Add `sessionId` to Tab type and SavedTab type

**Files:**
- Modify: `src/shared/types.ts:1-40`

**Step 1: Add sessionId to Tab interface and create SavedTab type**

In `src/shared/types.ts`, add `sessionId` field to the `Tab` interface and add a new `SavedTab` interface:

```typescript
export interface Tab {
  id: string;
  name: string;
  status: TabStatus;
  worktree: string | null;
  cwd: string;
  pid: number | null;
  sessionId: string | null;
}

export interface SavedTab {
  name: string;
  cwd: string;
  worktree: string | null;
  sessionId: string;
}
```

**Step 2: Commit**

```bash
git add src/shared/types.ts
git commit -m "feat: add sessionId to Tab type and SavedTab type"
```

---

### Task 2: Update TabManager to handle sessionId

**Files:**
- Modify: `src/main/tab-manager.ts:1-59`

**Step 1: Initialize sessionId as null in createTab and add setSessionId method**

In `src/main/tab-manager.ts`:

- In `createTab()`, add `sessionId: null` to the tab object (line 15):

```typescript
const tab: Tab = { id, name, status: 'new', worktree, cwd, pid: null, sessionId: null };
```

- Add a new method after `rename()`:

```typescript
setSessionId(id: string, sessionId: string): void {
  const tab = this.tabs.get(id);
  if (tab) tab.sessionId = sessionId;
}
```

**Step 2: Commit**

```bash
git add src/main/tab-manager.ts
git commit -m "feat: add sessionId tracking to TabManager"
```

---

### Task 3: Extend SettingsStore with session persistence

**Files:**
- Modify: `src/main/settings-store.ts:1-62`

**Step 1: Add sessions field to StoreData and DEFAULTS**

In `src/main/settings-store.ts`, update the `StoreData` interface and `DEFAULTS`:

```typescript
interface StoreData {
  recentDirs: string[];
  permissionMode: PermissionMode;
  sessions: Record<string, SavedTab[]>;
}

const DEFAULTS: StoreData = {
  recentDirs: [],
  permissionMode: 'bypassPermissions',
  sessions: {},
};
```

Import `SavedTab` from `@shared/types` (add to existing import).

**Step 2: Add saveSessions, getSessions, and clearSessions methods**

Add these methods to the `SettingsStore` class:

```typescript
getSessions(dir: string): SavedTab[] {
  return this.data.sessions[dir] ?? [];
}

saveSessions(dir: string, tabs: SavedTab[]): void {
  this.data.sessions[dir] = tabs;
  this.save();
}

clearSessions(dir: string): void {
  delete this.data.sessions[dir];
  this.save();
}
```

**Step 3: Commit**

```bash
git add src/main/settings-store.ts
git commit -m "feat: add per-directory session persistence to SettingsStore"
```

---

### Task 4: Modify on-session-start.sh to capture and send session_id

**Files:**
- Modify: `src/hooks/on-session-start.sh:1-11`

**Step 1: Parse session_id from stdin JSON and send it via pipe**

Replace the contents of `on-session-start.sh` with:

```bash
#!/bin/bash
TAB_ID="$1"
PIPE_NAME="$2"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Read the hook input from stdin (contains session_id, source, model, etc.)
INPUT=$(cat)
SESSION_ID=$(echo "$INPUT" | node -e "
  let d='';
  process.stdin.on('data',c=>d+=c);
  process.stdin.on('end',()=>{
    try{
      const j=JSON.parse(d);
      process.stdout.write(j.session_id||'');
    }catch{process.stdout.write('')}
  });
" 2>/dev/null)

# Send tab:ready with session_id as data
bash "$SCRIPT_DIR/pipe-send.sh" "$TAB_ID" "$PIPE_NAME" "tab:ready" "$SESSION_ID"

# Set CLAUDE_TERMINAL_TAB_ID for this session
if [ -n "$CLAUDE_ENV_FILE" ]; then
  echo "export CLAUDE_TERMINAL_TAB_ID=\"$TAB_ID\"" >> "$CLAUDE_ENV_FILE"
fi
```

**Step 2: Commit**

```bash
git add src/hooks/on-session-start.sh
git commit -m "feat: capture session_id from SessionStart hook input"
```

---

### Task 5: Update handleHookMessage to store sessionId on tab:ready

**Files:**
- Modify: `src/main/index.ts:126-130`

**Step 1: Store sessionId when tab:ready event arrives with data**

In `handleHookMessage` in `src/main/index.ts`, update the `tab:ready` case:

```typescript
case 'tab:ready':
  tabManager.updateStatus(tabId, 'new');
  if (data) {
    tabManager.setSessionId(tabId, data);
  }
  break;
```

**Step 2: Commit**

```bash
git add src/main/index.ts
git commit -m "feat: store sessionId from hook message on tab:ready"
```

---

### Task 6: Add --resume support to tab:create IPC handler

**Files:**
- Modify: `src/main/index.ts:191-231`

**Step 1: Accept optional resumeSessionId parameter**

Update the `tab:create` IPC handler signature and args construction:

```typescript
ipcMain.handle('tab:create', async (_event, worktree: string | null, resumeSessionId?: string) => {
  const cwd = worktree ?? workspaceDir!;
  const tab = tabManager.createTab(cwd, worktree);

  // Install hooks so Claude Code can communicate back to us.
  if (hookInstaller) {
    hookInstaller.install(cwd, tab.id);
  }

  // Build claude CLI arguments.
  const args: string[] = [...(PERMISSION_FLAGS[permissionMode] ?? [])];
  if (resumeSessionId) {
    args.push('--resume', resumeSessionId);
  }

  // Extra env vars so hooks know which pipe to talk to.
  const extraEnv: Record<string, string> = {
    CLAUDE_TERMINAL_TAB_ID: tab.id,
    CLAUDE_TERMINAL_PIPE: PIPE_NAME,
  };

  // Spawn the Claude PTY.
  const proc = ptyManager.spawn(tab.id, cwd, args, extraEnv);
  tab.pid = proc.pid;

  // Forward PTY output to the renderer.
  proc.onData((data: string) => {
    sendToRenderer('pty:data', tab.id, data);
  });

  // When the PTY exits, clean up.
  proc.onExit(() => {
    tabManager.removeTab(tab.id);
    sendToRenderer('tab:removed', tab.id);
  });

  // Set as active if it's the first tab.
  if (tabManager.getAllTabs().length === 1) {
    tabManager.setActiveTab(tab.id);
  }

  sendToRenderer('tab:updated', tab);
  return tab;
});
```

**Step 2: Commit**

```bash
git add src/main/index.ts
git commit -m "feat: support --resume sessionId in tab:create"
```

---

### Task 7: Save tabs on app quit

**Files:**
- Modify: `src/main/index.ts:335-343`

**Step 1: Snapshot tabs before killing PTYs in window-all-closed handler**

Update the `window-all-closed` handler:

```typescript
app.on('window-all-closed', async () => {
  // Save tab sessions before cleanup
  if (workspaceDir) {
    const savedTabs = tabManager.getAllTabs()
      .filter(t => t.sessionId)
      .map(t => ({
        name: t.name,
        cwd: t.cwd,
        worktree: t.worktree,
        sessionId: t.sessionId!,
      }));
    if (savedTabs.length > 0) {
      settings.saveSessions(workspaceDir, savedTabs);
    }
  }

  ptyManager.killAll();
  try {
    await ipcServer.stop();
  } catch {
    // best-effort cleanup
  }
  app.quit();
});
```

**Step 2: Commit**

```bash
git add src/main/index.ts
git commit -m "feat: save tab sessions on app quit"
```

---

### Task 8: Add session:getSavedTabs IPC handler

**Files:**
- Modify: `src/main/index.ts` (in `registerIpcHandlers`, after `session:start`)
- Modify: `src/preload.ts:40-43`

**Step 1: Add IPC handler in main process**

In `registerIpcHandlers()`, add after the `session:start` handler:

```typescript
ipcMain.handle('session:getSavedTabs', async (_event, dir: string) => {
  const saved = settings.getSessions(dir);
  settings.clearSessions(dir);
  return saved;
});
```

**Step 2: Add preload bridge method**

In `src/preload.ts`, add to the `api` object (after `startSession`):

```typescript
getSavedTabs: (dir: string): Promise<SavedTab[]> =>
  ipcRenderer.invoke('session:getSavedTabs', dir),
```

Add `SavedTab` to the import from `'./shared/types'`.

**Step 3: Commit**

```bash
git add src/main/index.ts src/preload.ts
git commit -m "feat: add session:getSavedTabs IPC handler and preload bridge"
```

---

### Task 9: Update preload createTab to accept resumeSessionId

**Files:**
- Modify: `src/preload.ts:6-7`

**Step 1: Update createTab signature**

```typescript
createTab: (worktree: string | null, resumeSessionId?: string): Promise<Tab> =>
  ipcRenderer.invoke('tab:create', worktree, resumeSessionId),
```

**Step 2: Commit**

```bash
git add src/preload.ts
git commit -m "feat: pass resumeSessionId through preload bridge"
```

---

### Task 10: Restore saved tabs in App.tsx on session start

**Files:**
- Modify: `src/renderer/App.tsx:115-126`

**Step 1: Check for saved tabs after session start and restore them**

Update `handleStartSession`:

```typescript
const handleStartSession = async (dir: string, mode: PermissionMode) => {
  await window.claudeTerminal.startSession(dir, mode);

  // Check for saved tabs from a previous session in this directory
  const savedTabs = await window.claudeTerminal.getSavedTabs(dir);

  if (savedTabs.length > 0) {
    // Restore saved tabs with --resume
    for (const saved of savedTabs) {
      const tab = await window.claudeTerminal.createTab(saved.worktree, saved.sessionId);
      setActiveTabId(tab.id);
    }
  }

  // Load all tabs (includes any just-created ones)
  const allTabs = await window.claudeTerminal.getTabs();
  const activeId = await window.claudeTerminal.getActiveTabId();
  setTabs(allTabs);
  setActiveTabId(activeId);
  setAppState('running');

  // Only show new tab dialog if no tabs were restored
  if (allTabs.length === 0) {
    setShowNewTabDialog(true);
  }
};
```

**Step 2: Update handleNewTabWithWorktree and handleNewTabWithoutWorktree**

These call `createTab` — update to pass `undefined` for the new parameter (no change needed since the parameter is optional and omitting it works).

**Step 3: Commit**

```bash
git add src/renderer/App.tsx
git commit -m "feat: restore saved tabs on session start"
```

---

### Task 11: Update TypeScript types for window.claudeTerminal

**Files:**
- Check if there's a `global.d.ts` or type augmentation for `window.claudeTerminal`

This might already be handled by the `ClaudeTerminalApi` export in `preload.ts`. If there's a separate type declaration file, update it to include `getSavedTabs`. If not, TypeScript should pick up the type from the preload export.

**Step 1: Verify types compile**

Run: `npx tsc --noEmit`

Fix any type errors that arise from the new `getSavedTabs` method or `sessionId` field.

**Step 2: Commit if changes needed**

```bash
git add -A
git commit -m "fix: update TypeScript types for tab persistence"
```

---

### Task 12: Manual smoke test

**Step 1: Start the app in dev mode**

```bash
pnpm start
```

**Step 2: Test the flow**

1. Select a directory and create a tab
2. Send a message to Claude (so the session gets a session_id)
3. Close the app
4. Check `%APPDATA%/claude-terminal/claude-terminal-settings.json` — verify a `sessions` entry exists with the tab's session ID
5. Reopen the app, select the same directory
6. Verify the tab is restored and the conversation is resumed

**Step 3: Test error case**

1. Manually edit the settings JSON to put in a bogus session ID
2. Open the app — verify the tab fails gracefully (PTY exits, tab is removed)
3. Verify user can create a fresh tab normally
