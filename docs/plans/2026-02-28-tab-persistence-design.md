# Tab Session Persistence Design

## Goal

Persist tabs across app restarts so that reopening a workspace directory restores the previous session's tabs, each resuming their Claude conversation via `--resume <sessionId>`.

## Approach

Extend the existing `SettingsStore` (plain JSON in userData) with a per-directory tab snapshot.

## Data Model

### Tab interface — add `sessionId`

```typescript
interface Tab {
  id: string;
  name: string;
  status: TabStatus;
  worktree: string | null;
  cwd: string;
  pid: number | null;
  sessionId: string | null;  // Claude Code session ID, captured from SessionStart hook
}
```

### SavedTab — minimal data for restoration

```typescript
interface SavedTab {
  name: string;
  cwd: string;
  worktree: string | null;
  sessionId: string;
}
```

### SettingsStore schema — add `sessions`

```typescript
interface StoreData {
  recentDirs: string[];
  permissionMode: PermissionMode;
  sessions: Record<string, SavedTab[]>;  // workspaceDir → saved tabs
}
```

## Session ID Capture

The `SessionStart` hook receives JSON on stdin containing a `session_id` field. Modify `on-session-start.sh` to:

1. Read stdin JSON
2. Parse `session_id`
3. Send it via pipe as: `tab:ready` event with `data = sessionId`

In `handleHookMessage`, the `tab:ready` case stores the session ID on the tab via `tabManager.setSessionId(tabId, data)`.

## Save (on app quit)

In `window-all-closed`, before killing PTYs:

1. Collect all tabs with non-null `sessionId`
2. Map to `SavedTab` objects
3. Call `settings.saveSessions(workspaceDir, savedTabs)`

## Restore (on session start)

When a workspace directory is selected:

1. `session:start` handler checks `settings.getSessions(dir)`
2. Returns saved tabs to renderer (new IPC: `session:getSavedTabs`)
3. Renderer creates each tab with `resumeSessionId` parameter
4. `tab:create` handler adds `--resume <sessionId>` to Claude CLI args when `resumeSessionId` is provided
5. Saved sessions are cleared after restoration to prevent stale reuse

## Error Handling

- If `--resume` fails (session expired/corrupt), Claude process exits → PTY `onExit` cleans up tab automatically
- User can always create fresh tabs manually
- Saved sessions cleared after restore attempt regardless of success

## Files to Modify

1. `src/shared/types.ts` — Add `sessionId` to `Tab`, add `SavedTab` type
2. `src/main/settings-store.ts` — Add `sessions` field, `saveSessions()`, `getSessions()`, `clearSessions()`
3. `src/main/tab-manager.ts` — Add `setSessionId()` method, include `sessionId` in tab creation
4. `src/main/index.ts` — Modify `tab:create` handler (accept `resumeSessionId`), modify `handleHookMessage` for `tab:ready`, add save-on-quit logic, add `session:getSavedTabs` IPC handler
5. `src/hooks/on-session-start.sh` — Parse `session_id` from stdin and send via pipe
6. `src/renderer/App.tsx` — After session start, check for saved tabs and restore them
7. `src/preload.ts` — Add `getSavedTabs` bridge method
