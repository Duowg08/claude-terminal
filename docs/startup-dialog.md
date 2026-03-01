# Startup Dialog

The startup dialog is the first screen shown when ClaudeTerminal launches. It lets the user pick a working directory and permission mode before starting a session.

## UI Layout

```
┌──────────────────────────────┐
│       Claude Terminal         │
│                               │
│  Directory                    │
│  ┌───────────────────────┐   │
│  │ D:\dev\project-a    × │   │
│  │ D:\dev\project-b    × │   │
│  │ C:\Users\me\code    × │   │
│  └───────────────────────┘   │
│  [ Browse… ]                  │
│                               │
│  Permissions                  │
│  ○ Bypass  ○ Accept Edits    │
│  ○ Plan    ○ Default         │
│                               │
│         [ Start ]             │
└──────────────────────────────┘
```

## User Flow

```
App.tsx (appState === 'startup')
    │
    ▼
StartupDialog renders
    │
    ▼
User selects directory via:
  a) Single-click recent dir  → selects it
  b) Double-click recent dir  → selects it AND submits
  c) Click Browse…             → native OS folder picker
    │
    ▼
User selects permission mode (radio buttons, default: bypassPermissions)
    │
    ▼
User submits via:
  a) Click "Start" button
  b) Press Enter key
  c) Double-click a directory (skips explicit submit)
    │
    ▼
handleStart() → onStart(dir, mode)
    │
    ▼
App.tsx: handleStartSession() → appState = 'running'
```

## Interaction Details

### Directory Selection

| Action | Behavior |
|--------|----------|
| Single-click recent dir | Selects the directory (highlights it), requires separate submit |
| Double-click recent dir | Selects the directory AND immediately starts the session |
| Enter / Space on focused dir | Selects the directory |
| Enter (anywhere in dialog) | Submits if a directory is selected |
| Click "×" on dir | Removes from recent history |
| Click "Browse…" | Opens native OS folder picker via `dialog.showOpenDialog` |

### Permission Modes

| Mode | CLI Flag | Description |
|------|----------|-------------|
| `bypassPermissions` | `--dangerously-skip-permissions` | No permission prompts |
| `acceptEdits` | `--allowedTools Edit,Write,NotebookEdit` | Auto-accept file edits |
| `plan` | `--plan` | Plan mode |
| `default` | *(none)* | Default interactive mode |

## State

- **recentDirs**: Loaded on mount via `window.claudeTerminal.getRecentDirs()`. Persisted in the settings store.
- **selectedDir**: Currently highlighted directory. `null` until user picks one.
- **permissionMode**: Loaded on mount via `window.claudeTerminal.getPermissionMode()`. Defaults to `bypassPermissions`.

## IPC Channels Used

| Channel | Direction | Purpose |
|---------|-----------|---------|
| `settings:getRecentDirs` | renderer → main | Load recent directory list |
| `settings:removeRecentDir` | renderer → main | Remove a dir from history |
| `dialog:selectDirectory` | renderer → main | Open native folder picker |
| `settings:getPermissionMode` | renderer → main | Load saved permission mode |

## Key Files

| File | Role |
|------|------|
| `src/renderer/components/StartupDialog.tsx` | Dialog component |
| `src/renderer/App.tsx` | Parent: renders dialog when `appState === 'startup'`, handles `onStart` |
| `src/main/ipc-handlers.ts` | `dialog:selectDirectory` handler (native folder picker) |
| `src/main/settings-store.ts` | Persists recent dirs and permission mode |
| `src/renderer/index.css` | Styles: `.startup-dialog`, `.recent-dirs`, `.start-btn-primary` |
