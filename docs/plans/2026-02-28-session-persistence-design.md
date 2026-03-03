# Session Persistence Improvements

## Problem

Sessions are only persisted on graceful app quit (`window-all-closed`). If the app crashes, is force-killed, or is reinstalled without a clean shutdown, all session IDs are lost and tabs cannot be resumed. Additionally, session load/save has no logging, making failures invisible.

## Design

### 1. `SettingsStore` changes

- **Remove `clearSessions()`** — no longer needed; file is overwritten naturally
- **Add logging** to `getSessions()` — log path, count found, or error reason
- **Wrap `saveSessions()` in try/catch** — log error instead of crashing

### 2. New `persistSessions()` helper in `index.ts`

A function that reads `tabManager.getAllTabs()` + `workspaceDir`, filters tabs with sessionIds, and calls `settings.saveSessions()`. Guards on `workspaceDir` being set.

Called from:
- `tab:create` handler — after tab is created
- `tab:close` handler — after tab is removed
- `handleHookMessage` `tab:ready` — when sessionId is captured
- `handleHookMessage` `tab:name` — when tab is renamed
- `generateTabName` callback — when async name generation completes
- PTY `onExit` handler — when a tab's process exits
- `window-all-closed` — keep existing save-on-quit as belt-and-suspenders

### 3. Remove `clearSessions` from `session:getSavedTabs`

Just return saved tabs. The next `persistSessions()` call overwrites the file.

### 4. No status persistence

Tab status (`working`/`idle`/etc.) is transient — hooks set the correct status within seconds of resume. Persisting stale status would be misleading.
