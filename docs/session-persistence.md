# Session Persistence

ClaudeTerminal uses a two-tier persistence model: **global settings** stored in the Electron userData directory, and **per-directory sessions** stored inside each workspace. This separation means your recent directories and permission preferences follow you everywhere, while your open tabs are remembered per project.

## Global Settings

`SettingsStore` manages application-wide preferences that persist across all workspaces.

### File Location

```
{userData}/claude-terminal-settings.json
```

On Windows this is typically `%APPDATA%/claude-terminal/claude-terminal-settings.json`. The path is resolved via Electron's `app.getPath('userData')`.

### Stored Data

```typescript
interface StoreData {
  recentDirs: string[];          // MRU list of workspace directories
  permissionMode: PermissionMode; // Last-used permission mode
}
```

### Defaults

If the settings file is missing or unreadable, `SettingsStore` falls back to:

```typescript
const DEFAULTS: StoreData = {
  recentDirs: [],
  permissionMode: 'bypassPermissions',
};
```

### Error Handling

- **Read failures**: The `load()` method catches all exceptions. If the file doesn't exist or contains invalid JSON, it silently returns `DEFAULTS`. No error is surfaced to the user.
- **Write failures**: The `save()` method creates the parent directory with `mkdirSync({ recursive: true })` before writing, so a missing directory won't cause a crash.
- **Schema evolution**: `load()` spreads parsed JSON over `DEFAULTS` (`{ ...DEFAULTS, ...JSON.parse(raw) }`), so newly added fields automatically get their default values without a migration step.

## Per-Directory Sessions

Each workspace stores its open tabs in a local file so they can be restored on the next launch.

### File Location

```
{workspace}/.claude-terminal/sessions.json
```

The `.claude-terminal/` directory is created on first save. This file lives inside the project and can be gitignored if desired.

### SavedTab Structure

```typescript
interface SavedTab {
  name: string;           // Display name (user-set or AI-generated)
  cwd: string;            // Working directory for this tab
  worktree: string | null; // Worktree name, or null for the main workspace
  sessionId: string;       // Claude Code session ID, used with --resume
}
```

Only Claude tabs are persisted. Shell tabs (PowerShell, WSL) and tabs that haven't received a session ID yet (status `new`) are excluded.

### When Sessions Are Saved

The `persistSessions()` function in `src/main/index.ts` snapshots all eligible tabs and writes them to disk. It is called on:

| Trigger | Location |
|---------|----------|
| Tab created | `tab:create` handler, after PTY spawn |
| Tab renamed | `tab:rename` handler |
| Tab closed | `tab:close` handler and PTY `onExit` callback |
| Tabs reordered | `tab:reorder` handler |
| Session ID received | `tab:ready` hook event in `hook-router.ts` |
| AI-generated name set | `tab-namer.ts`, after Haiku returns a name |
| Remote client renames tab | `web-remote-server.ts` |
| App window closed | `window-all-closed` event |

### Filtering Logic

`persistSessions()` filters the tab list before saving:

```typescript
const savedTabs = allTabs
  .filter(t => t.sessionId && t.type === 'claude' && t.status !== 'new')
  .map(t => ({
    name: t.name,
    cwd: t.cwd,
    worktree: t.worktree,
    sessionId: t.sessionId!,
  }));
```

- **Must have a `sessionId`** -- tabs that haven't started a Claude session yet are skipped.
- **Must be type `claude`** -- shell tabs are transient and not saved.
- **Must not be status `new`** -- the tab must have progressed past initial creation.

## Session Restoration Flow

Restoration happens in two places depending on how the app is launched:

### Via StartupDialog (manual directory selection)

```
User clicks Start
  -> handleStartSession() in App.tsx
    -> startSession(dir, mode)         // initializes workspace
    -> getSavedTabs(dir)               // reads sessions.json
    -> for each saved tab:
         createTab(worktree, sessionId, name)  // spawns with --resume
    -> if no tabs restored:
         createTab(null)               // create a fresh tab
```

### Via CLI (auto-start with directory argument)

```
App launches with --dir flag
  -> useEffect in App.tsx detects cliDir
    -> getPermissionMode()             // restore last permission mode
    -> startSession(cliDir, savedMode)
    -> getSavedTabs(cliDir)
    -> for each saved tab:
         createTab(worktree, sessionId, name)
    -> if no tabs restored:
         handleNewTabWithoutWorktree()
```

### Worktree Filtering

Before returning saved tabs, `session:getSavedTabs` filters out any worktree tabs whose directories no longer exist on disk:

```typescript
return saved.filter(tab => {
  if (!tab.worktree) return true;
  const worktreeCwd = path.join(dir, '.claude', 'worktrees', tab.worktree);
  return fs.existsSync(worktreeCwd);
});
```

This prevents errors when a worktree was removed between sessions.

### Resume Flag

When a saved tab has a `sessionId`, the `tab:create` handler passes `--resume <sessionId>` to the Claude CLI:

```typescript
if (resumeSessionId) {
  args.push('--resume', resumeSessionId);
}
```

This tells Claude Code to resume the previous conversation rather than starting fresh.

## Recent Directories

The StartupDialog shows a most-recently-used list of workspace directories so users can quickly reopen previous projects.

### Storage

Recent directories are stored in the global settings file as a simple string array.

### Behavior

- **Maximum 10 entries** (`MAX_RECENT_DIRS = 10`).
- **Add**: `addRecentDir(dir)` removes any existing occurrence of `dir`, prepends it to the list, and truncates to 10. Called every time a tab is created.
- **Remove**: `removeRecentDir(dir)` filters it out of the list. Exposed in the StartupDialog via a close button on each entry.
- **Deduplication**: Adding a directory that's already in the list moves it to the top rather than creating a duplicate.

### StartupDialog Integration

On mount, `StartupDialog` calls `getRecentDirs()` and renders the list. Users can:

1. Click a directory to select it.
2. Click the remove button to delete it from history.
3. Click "Browse..." to pick a new directory via the system file dialog.

## Permission Mode Persistence

The permission mode (`default`, `plan`, `acceptEdits`, `bypassPermissions`) controls which CLI flags are passed to Claude Code on tab creation.

### Flow

1. User selects a mode in the StartupDialog (or the saved mode is loaded via CLI auto-start).
2. `session:start` handler calls `settings.setPermissionMode(mode)`, writing it to the global settings file.
3. On next launch, `StartupDialog` calls `getPermissionMode()` to pre-select the saved mode.
4. The CLI auto-start path also reads the saved mode via `getPermissionMode()`.

### Permission Flags

Each mode maps to CLI arguments via `PERMISSION_FLAGS`:

```typescript
const PERMISSION_FLAGS: Record<PermissionMode, string[]> = {
  default: [],
  plan: ['--plan'],
  acceptEdits: ['--allowedTools', 'Edit,Write,NotebookEdit'],
  bypassPermissions: ['--dangerously-skip-permissions'],
};
```

## Key Files

| File | Role |
|------|------|
| `src/main/settings-store.ts` | `SettingsStore` class -- reads/writes global settings and per-directory sessions |
| `src/main/index.ts` | `persistSessions()` function -- snapshots current tabs to disk |
| `src/main/ipc-handlers.ts` | IPC handlers that trigger `persistSessions()` on tab lifecycle events |
| `src/main/hook-router.ts` | Calls `persistSessions()` when session ID or tab name arrives via hooks |
| `src/main/tab-namer.ts` | Calls `persistSessions()` after AI-generated tab names are set |
| `src/renderer/App.tsx` | Session restoration flow on startup (both manual and CLI paths) |
| `src/renderer/components/StartupDialog.tsx` | Recent directories UI and permission mode selection |
| `src/shared/types.ts` | `SavedTab`, `AppSettings`, `PermissionMode`, `PERMISSION_FLAGS` type definitions |
