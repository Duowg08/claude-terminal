# Architecture

## Overview

ClaudeTerminal is an Electron desktop app that manages multiple Claude Code CLI instances, each running in its own tab with a real PTY-backed terminal. The app follows Electron's standard multi-process architecture with secure IPC bridging.

```
┌─────────────────────────────────────────────────┐
│                  Renderer Process                │
│  ┌──────────┐ ┌──────────┐ ┌──────────────────┐ │
│  │  TabBar   │ │ Terminal │ │  StartupDialog   │ │
│  │  Tab x N  │ │ xterm.js │ │  NewTabDialog    │ │
│  └──────────┘ │ WebGL    │ │  StatusBar       │ │
│               └──────────┘ └──────────────────┘ │
│                      │                           │
│              contextBridge (preload.ts)           │
├──────────────────────┼───────────────────────────┤
│                Main Process                      │
│  ┌───────────┐ ┌───────────┐ ┌───────────────┐  │
│  │PtyManager │ │TabManager │ │SettingsStore  │  │
│  │ node-pty  │ │ pure state│ │ JSON file     │  │
│  └───────────┘ └───────────┘ └───────────────┘  │
│  ┌───────────┐ ┌───────────┐ ┌───────────────┐  │
│  │IpcServer  │ │Worktree   │ │HookInstaller  │  │
│  │named pipe │ │Manager    │ │               │  │
│  └─────┬─────┘ └───────────┘ └───────────────┘  │
└────────┼─────────────────────────────────────────┘
         │ Windows Named Pipe
         │ (\\.\pipe\claude-terminal)
┌────────┴─────────────────────────────────────────┐
│           Claude Code Processes (N)               │
│  Each spawned via node-pty as cmd.exe /c claude   │
│  Hooks configured via .claude/settings.local.json │
│  Hook scripts send JSON over named pipe           │
└──────────────────────────────────────────────────┘
```

## Process Model

### Main Process (`src/main/index.ts`)

The main process is the orchestrator. It:

1. Creates the BrowserWindow
2. Starts the named pipe IPC server for hook communication
3. Registers Electron IPC handlers for renderer requests
4. Manages PTY process lifecycle
5. Broadcasts state changes to the renderer

### Renderer Process (`src/renderer/`)

A React SPA that renders:

- **StartupDialog**: Directory selection + permission mode on launch
- **TabBar + Tabs**: Tab strip with status indicators, rename support
- **Terminal**: xterm.js instances cached per tab, WebGL accelerated
- **StatusBar**: Active tab status, worktree info, keyboard shortcuts
- **NewTabDialog**: Worktree creation prompt

### Preload (`src/preload.ts`)

Exposes 18 methods via `contextBridge.exposeInMainWorld('claudeTerminal', api)`:

| Category | Methods |
|----------|---------|
| Tabs | `createTab`, `closeTab`, `switchTab`, `renameTab`, `getTabs`, `getActiveTabId` |
| PTY | `writeToPty`, `resizePty` |
| Worktree | `createWorktree`, `getCurrentBranch` |
| Settings | `getRecentDirs`, `getPermissionMode` |
| Startup | `selectDirectory`, `startSession`, `getCliStartDir` |
| Events | `onPtyData`, `onTabUpdate`, `onTabRemoved` |

## Data Flow

### Tab Creation

```
User clicks [+] -> NewTabDialog -> renderer calls createTab(worktree)
  -> ipcMain.handle('tab:create')
    -> TabManager.createTab()
    -> HookInstaller.install() writes .claude/settings.local.json
    -> PtyManager.spawn() creates cmd.exe /c claude [flags]
    -> proc.onData() forwards output -> sendToRenderer('pty:data')
    -> proc.onExit() cleans up tab
  <- returns Tab object to renderer
```

### Hook Status Updates

```
Claude Code runs a hook (e.g., PreToolUse)
  -> on-tool-use.sh runs
    -> pipe-send.sh sends JSON to named pipe
      -> HookIpcServer receives message
        -> handleHookMessage() updates TabManager state
          -> sendToRenderer('tab:updated') notifies renderer
            -> React state updates, UI re-renders
```

### Terminal I/O

```
User types in xterm.js
  -> term.onData() fires
    -> window.claudeTerminal.writeToPty(tabId, data)
      -> ipcRenderer.send('pty:write')
        -> PtyManager.write() -> pty.write()

Claude produces output
  -> pty.onData() fires in main process
    -> sendToRenderer('pty:data', tabId, data)
      -> ipcRenderer.on('pty:data') callback
        -> term.write(data) in xterm.js
```

## Hook System

Claude Code supports hooks that fire on specific events. ClaudeTerminal installs a `settings.local.json` into each working directory's `.claude/` folder with hooks pointing to bundled shell scripts.

### Hook Events Used

| Event | Script | Purpose |
|-------|--------|---------|
| `SessionStart` | `on-session-start.sh` | Marks tab as ready |
| `UserPromptSubmit` | `on-prompt-submit.sh` | Sets tab name from first prompt (40 chars) |
| `PreToolUse` | `on-tool-use.sh` | Sets status to `working` |
| `Stop` | `on-stop.sh` | Sets status to `idle` |
| `Notification` | `on-notification.sh` | Sets status to `requires_response` |
| `SessionEnd` | `on-session-end.sh` | Removes tab |

### Communication Path

All hooks use `pipe-send.sh` which sends JSON via Node.js `net.createConnection` to the Windows named pipe. Environment variables (`PIPE_PATH`, `PIPE_MSG`) are used instead of string interpolation to avoid Windows backslash escaping issues.

## State Management

### Tab State (Main Process)

`TabManager` is a pure in-memory state store. No persistence — tabs are ephemeral.

```typescript
interface Tab {
  id: string;           // Generated: tab-{timestamp}-{random}
  name: string;         // From worktree name or first prompt
  status: TabStatus;    // 'new' | 'working' | 'idle' | 'requires_response'
  worktree: string | null;
  cwd: string;
  pid: number | null;
}
```

### Settings (Persistent)

`SettingsStore` persists to `{userData}/claude-terminal-settings.json`:
- `recentDirs`: Last 10 working directories (MRU order)
- `permissionMode`: Last used permission mode

### Renderer State

React `useState` in `App.tsx` tracks:
- `appState`: `'startup'` | `'running'`
- `tabs`: Array of Tab objects (synced from main via IPC events)
- `activeTabId`: Currently visible tab
- `showNewTabDialog`: Dialog visibility

## Security

- `nodeIntegration: false` — renderer cannot access Node.js APIs
- `contextIsolation: true` — renderer runs in isolated context
- `sandbox: true` — renderer process is sandboxed
- All IPC goes through typed `contextBridge` API
- Electron Fuses hardened at package time (see `forge.config.ts`)
