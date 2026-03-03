# Session Persistence Improvements Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Persist sessions on every meaningful state change (not just quit) and add logging to session load/save.

**Architecture:** Add a `persistSessions()` helper in `src/main/index.ts` that snapshots current tab state to disk. Call it from every place that mutates tab state. Remove the delete-after-load pattern. Add try/catch + logging to `SettingsStore`.

**Tech Stack:** Electron (main process), Node.js `fs`, TypeScript

---

### Task 1: Update `SettingsStore` — logging, error handling, remove `clearSessions`

**Files:**
- Modify: `src/main/settings-store.ts`
- Test: `tests/main/settings-store.test.ts` (create if needed)

**Step 1: Check if test file exists**

Run: `ls tests/main/settings-store.test.ts 2>/dev/null; echo $?`

**Step 2: Write failing tests for the new behavior**

Create `tests/main/settings-store.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

// Mock electron app before importing SettingsStore
vi.mock('electron', () => ({
  app: { getPath: () => os.tmpdir() },
}));

import { SettingsStore } from '../../src/main/settings-store';

describe('SettingsStore sessions', () => {
  let store: SettingsStore;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-test-'));
    store = new SettingsStore(path.join(tmpDir, 'settings.json'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('getSessions returns empty array when no file exists', () => {
    const result = store.getSessions(tmpDir);
    expect(result).toEqual([]);
  });

  it('saveSessions writes and getSessions reads back', () => {
    const tabs = [{ name: 'Tab 1', cwd: '/tmp', worktree: null, sessionId: 'abc-123' }];
    store.saveSessions(tmpDir, tabs);
    const result = store.getSessions(tmpDir);
    expect(result).toEqual(tabs);
  });

  it('saveSessions overwrites previous sessions', () => {
    const tabs1 = [{ name: 'Tab 1', cwd: '/tmp', worktree: null, sessionId: 'abc' }];
    const tabs2 = [{ name: 'Tab 2', cwd: '/tmp', worktree: null, sessionId: 'def' }];
    store.saveSessions(tmpDir, tabs1);
    store.saveSessions(tmpDir, tabs2);
    const result = store.getSessions(tmpDir);
    expect(result).toEqual(tabs2);
  });

  it('getSessions returns empty array on corrupted JSON', () => {
    const sessDir = path.join(tmpDir, '.claude-terminal');
    fs.mkdirSync(sessDir, { recursive: true });
    fs.writeFileSync(path.join(sessDir, 'sessions.json'), '{corrupt', 'utf-8');
    const result = store.getSessions(tmpDir);
    expect(result).toEqual([]);
  });

  it('saveSessions does not throw on read-only directory', () => {
    // Pass a non-existent deeply nested path — saveSessions should catch the error
    const badDir = path.join(tmpDir, 'no', 'such', 'deep', 'path');
    // This should not throw
    expect(() => store.saveSessions(badDir, [{ name: 'x', cwd: '/', worktree: null, sessionId: 'z' }])).not.toThrow();
  });
});
```

**Step 3: Run tests to verify they fail (or some fail)**

Run: `npx vitest run tests/main/settings-store.test.ts`
Expected: The "does not throw" test should fail because `saveSessions` currently doesn't have try/catch. Others may pass.

**Step 4: Update `SettingsStore`**

In `src/main/settings-store.ts`:

1. Add `import { log } from './logger';` at the top
2. Replace `getSessions`:
```typescript
getSessions(dir: string): SavedTab[] {
  const filePath = this.sessionsPath(dir);
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const tabs = JSON.parse(raw) as SavedTab[];
    log.info('[sessions] loaded', tabs.length, 'saved tabs from', filePath);
    return tabs;
  } catch (err) {
    log.info('[sessions] no saved sessions at', filePath, String(err));
    return [];
  }
}
```

3. Replace `saveSessions`:
```typescript
saveSessions(dir: string, tabs: SavedTab[]): void {
  const filePath = this.sessionsPath(dir);
  try {
    const sessDir = path.join(dir, SESSIONS_DIR);
    fs.mkdirSync(sessDir, { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(tabs, null, 2), 'utf-8');
    log.debug('[sessions] persisted', tabs.length, 'tabs to', filePath);
  } catch (err) {
    log.error('[sessions] failed to save sessions to', filePath, String(err));
  }
}
```

4. Remove the `clearSessions` method entirely.

**Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/main/settings-store.test.ts`
Expected: All PASS

**Step 6: Commit**

```bash
git add src/main/settings-store.ts tests/main/settings-store.test.ts
git commit -m "feat: add logging and error handling to session persistence"
```

---

### Task 2: Add `persistSessions()` helper and wire it up in `index.ts`

**Files:**
- Modify: `src/main/index.ts`

**Step 1: Add the `persistSessions` helper function**

Add after the `cleanupNamingFlag` helper (around line 165):

```typescript
function persistSessions() {
  if (!workspaceDir) return;
  const allTabs = tabManager.getAllTabs();
  const savedTabs = allTabs
    .filter(t => t.sessionId)
    .map(t => ({
      name: t.name,
      cwd: t.cwd,
      worktree: t.worktree,
      sessionId: t.sessionId!,
    }));
  settings.saveSessions(workspaceDir, savedTabs);
}
```

**Step 2: Remove `clearSessions` from `session:getSavedTabs` handler**

Change the handler (line 328-332) from:
```typescript
ipcMain.handle('session:getSavedTabs', async (_event, dir: string) => {
  const saved = settings.getSessions(dir);
  settings.clearSessions(dir);
  return saved;
});
```
To:
```typescript
ipcMain.handle('session:getSavedTabs', async (_event, dir: string) => {
  return settings.getSessions(dir);
});
```

**Step 3: Add `persistSessions()` call to `tab:create` handler**

In the `tab:create` handler, add `persistSessions();` after `sendToRenderer('tab:updated', tab);` (line 391):

```typescript
sendToRenderer('tab:updated', tab);
persistSessions();
return tab;
```

**Step 4: Add `persistSessions()` call to `tab:close` handler**

In the `tab:close` handler, add `persistSessions();` after `sendToRenderer('tab:removed', tabId);` (line 407):

```typescript
sendToRenderer('tab:removed', tabId);
persistSessions();
```

**Step 5: Add `persistSessions()` call to PTY `onExit` handler**

In the `tab:create` handler's `proc.onExit` callback, add `persistSessions();` after `sendToRenderer('tab:removed', tab.id);` (line 383):

```typescript
proc.onExit(() => {
  if (tabManager.getTab(tab.id)) {
    cleanupNamingFlag(tab.id);
    tabManager.removeTab(tab.id);
    sendToRenderer('tab:removed', tab.id);
    persistSessions();
  }
});
```

**Step 6: Add `persistSessions()` call to `handleHookMessage` for `tab:ready`**

In the `tab:ready` case, add `persistSessions();` after setting the sessionId (after line 252):

```typescript
if (sessionId) {
  tabManager.setSessionId(tabId, sessionId);
}
persistSessions();
break;
```

**Step 7: Add `persistSessions()` call to `handleHookMessage` for `tab:name`**

In the `tab:name` case, add `persistSessions();` after the rename (after line 284):

```typescript
case 'tab:name':
  if (data) {
    tabManager.rename(tabId, data);
    persistSessions();
  }
  break;
```

**Step 8: Add `persistSessions()` call to `generateTabName` callback**

In the `generateTabName` function, after `sendToRenderer('tab:updated', updated);` (line 208):

```typescript
if (updated) {
  sendToRenderer('tab:updated', updated);
  persistSessions();
}
```

**Step 9: Simplify `window-all-closed` handler**

Replace the manual session-saving block with a call to `persistSessions()`:

```typescript
app.on('window-all-closed', async () => {
  log.info('[quit] workspaceDir:', workspaceDir, 'tabs:', tabManager.getAllTabs().length);
  persistSessions();

  // Clean up all naming flag files
  for (const tab of tabManager.getAllTabs()) {
    cleanupNamingFlag(tab.id);
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

**Step 10: Run full test suite**

Run: `npx vitest run`
Expected: All PASS

**Step 11: Commit**

```bash
git add src/main/index.ts
git commit -m "feat: persist sessions on every state change, not just quit"
```

---

### Task 3: Manual smoke test

**Step 1: Start the app**

Run: `npm start` (or however the dev server runs)

**Step 2: Verify session file is created**

1. Open a workspace directory
2. Create a tab, wait for it to get a sessionId (watch DevTools console for `[tab:ready]` log)
3. Check that `<workspace>/.claude-terminal/sessions.json` exists and has content

**Step 3: Verify persistence on tab close**

1. Open two tabs
2. Close one tab
3. Check `sessions.json` — should have only one entry

**Step 4: Verify restore after force-kill**

1. Open a tab, let it get a sessionId
2. Force-kill the app (Task Manager / `taskkill`)
3. Reopen the app in the same directory
4. Tab should be restored with `--resume`
5. Check DevTools console for `[sessions] loaded N saved tabs from ...`
