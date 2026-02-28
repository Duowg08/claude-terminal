# PTY Management

ClaudeTerminal manages pseudo-terminal (PTY) processes for each tab. On Windows, this uses the ConPTY subsystem via `node-pty`, providing full terminal emulation for Claude CLI sessions, PowerShell shells, and WSL shells. The `PtyManager` class owns the lifecycle of every PTY process, while IPC handlers wire data flow between the PTY and the xterm.js frontend.

## How It Works

```
Renderer (xterm.js)                 Main Process                      OS
─────────────────                   ────────────                      ──
User types input
  -> ipcRenderer.send('pty:write')  -> PtyManager.write(tabId, data)  -> ConPTY stdin

                                    proc.onData(data)                 <- ConPTY stdout
                                      -> ipcRenderer 'pty:data'
  <- term.write(data)

ResizeObserver fires
  -> ipcRenderer.send('pty:resize') -> PtyManager.resize(tabId,c,r)  -> ConPTY resize
```

## Process Spawning

### Claude CLI Tabs

When a Claude tab is created via `tab:create`, the IPC handler calls `PtyManager.spawn()`. The spawn method uses `getClaudeCommand()` from `src/shared/claude-cli.ts` to resolve the command:

```typescript
// src/shared/claude-cli.ts
export function getClaudeCommand(flags: string[]): { command: string; args: string[] } {
  const isWindows = process.platform === 'win32';
  return isWindows
    ? { command: 'cmd.exe', args: ['/c', 'claude', ...flags] }
    : { command: 'claude', args: flags };
}
```

On Windows, `claude` is a `.cmd` wrapper installed by npm. `node-pty` cannot resolve `.cmd` files directly when calling `pty.spawn()`, so the workaround is to spawn `cmd.exe /c claude ...` which lets the Windows shell resolve the `.cmd` extension.

Permission flags are passed through from the selected permission mode:

```typescript
// src/shared/types.ts
export const PERMISSION_FLAGS: Record<PermissionMode, string[]> = {
  default: [],
  plan: ['--plan'],
  acceptEdits: ['--allowedTools', 'Edit,Write,NotebookEdit'],
  bypassPermissions: ['--dangerously-skip-permissions'],
};
```

A `--resume <sessionId>` flag is appended when resuming a saved session.

### Shell Tabs

Shell tabs (PowerShell or WSL) use `PtyManager.spawnShell()`, which spawns either `powershell.exe` or `wsl.exe` directly with no arguments.

### Environment Variable Injection

Claude CLI tabs receive three extra environment variables, merged into the PTY process environment:

| Variable | Value | Purpose |
|----------|-------|---------|
| `CLAUDE_TERMINAL_TAB_ID` | `tab-<timestamp>-<random>` | Identifies the tab in hook messages |
| `CLAUDE_TERMINAL_PIPE` | `\\.\pipe\claude-terminal` | Named pipe for hook IPC |
| `CLAUDE_TERMINAL_TMPDIR` | `os.tmpdir()` | Temp directory for flag files |

These variables are read by hook scripts (see [hooks.md](hooks.md)) rather than passed as CLI arguments, because Windows `cmd.exe` mangles backslash paths in arguments.

Shell tabs do not receive these extra variables since they do not run Claude Code hooks.

### Default Terminal Dimensions

All PTY processes are spawned with initial dimensions of 120 columns x 40 rows with terminal type `xterm-256color`. The renderer sends a resize immediately after the first `FitAddon.fit()` to sync the PTY to the actual container size.

## I/O Data Flow

### PTY Output (PTY -> Renderer)

```
PTY process emits data (proc.onData)
  -> Flow control check: is tab paused?
     -> YES: buffer the chunk in flowControl.buffer[]
     -> NO:  send immediately via deps.sendToRenderer('pty:data', tabId, data)
               -> ipcRenderer event 'pty:data'
                 -> global PTY listener in Terminal.tsx
                   -> xterm.write(data, callback)
```

The `proc.onData` callback is registered in the `tab:create` IPC handler, not in `PtyManager` itself. This keeps the manager focused on process lifecycle while the handler owns the data routing.

A single global PTY data listener is registered once in the renderer (not per-component) to avoid duplicate writes during React re-renders or Vite HMR reloads:

```typescript
// Terminal.tsx — registered once, dispatches to all tabs
window.claudeTerminal.onPtyData((dataTabId, data) => {
  const cached = terminalCache.get(dataTabId);
  if (!cached) return;
  cached.term.write(data, ...);
});
```

### User Input (Renderer -> PTY)

```
xterm.js fires term.onData(data)
  -> window.claudeTerminal.writeToPty(tabId, data)
    -> ipcRenderer.send('pty:write', tabId, data)
      -> ipcMain.on('pty:write')
        -> PtyManager.write(tabId, data)
          -> proc.write(data)  // node-pty ConPTY stdin
```

User input uses `ipcMain.on` (fire-and-forget) rather than `ipcMain.handle` (request-response) since there is no return value and latency matters for typing responsiveness.

### Preload Bridge

The preload script (`src/preload.ts`) exposes the PTY API through `contextBridge`:

```typescript
writeToPty: (tabId, data) => ipcRenderer.send('pty:write', tabId, data),
resizePty: (tabId, cols, rows) => ipcRenderer.send('pty:resize', tabId, cols, rows),
pausePty: (tabId) => ipcRenderer.send('pty:pause', tabId),
resumePty: (tabId) => ipcRenderer.send('pty:resume', tabId),
onPtyData: (callback) => { /* registers ipcRenderer.on('pty:data', ...) */ },
```

## Flow Control

When Claude produces large outputs (e.g., dumping a file or verbose tool results), data can arrive faster than xterm.js can render it. Without backpressure, the renderer accumulates an unbounded queue of pending writes, causing UI freezes.

### Backpressure Mechanism

```
                    Renderer                                    Main Process
                    ────────                                    ────────────
                    pendingBytes[tabId] tracks bytes
                    queued in xterm's write buffer

PTY data arrives -> pendingBytes += data.length

                    if pendingBytes > HIGH_WATERMARK (50KB)
                      -> pausePty(tabId)  ──────────────────>  flowControl[tabId].paused = true
                                                                subsequent onData -> buffer[]

xterm.write callback fires (chunk rendered)
                    pendingBytes -= data.length

                    if pendingBytes < LOW_WATERMARK (10KB)
                      -> resumePty(tabId)  ─────────────────>  flowControl[tabId].paused = false
                                                                flush buffer[] to renderer
```

### Constants

```typescript
const HIGH_WATERMARK = 50 * 1024;  // 50KB — pause PTY data forwarding
const LOW_WATERMARK  = 10 * 1024;  // 10KB — resume PTY data forwarding
```

### State Tracking

**Renderer side** (`src/renderer/components/terminalCache.ts`):
- `pendingBytes: Map<string, number>` — bytes written to xterm but not yet rendered
- `pausedTabs: Set<string>` — tabs for which pause has been sent

**Main process side** (`src/main/ipc-handlers.ts`):
- `flowControl: Map<string, { paused: boolean; buffer: string[] }>` — per-tab pause flag and buffered chunks

### Flush on Resume

When the renderer sends `pty:resume`, the main process flushes all buffered chunks in order and resets the buffer:

```typescript
ipcMain.on('pty:resume', (_event, tabId: string) => {
  const fc = flowControl.get(tabId);
  if (!fc) return;
  fc.paused = false;
  for (const chunk of fc.buffer) {
    deps.sendToRenderer('pty:data', tabId, chunk);
  }
  fc.buffer.length = 0;
});
```

## Process Termination

### Single Tab Kill

`PtyManager.kill(tabId)` handles cleanup when a tab is closed:

```typescript
kill(tabId: string): void {
  const managed = this.ptys.get(tabId);
  if (!managed) return;
  this.ptys.delete(tabId);

  const pid = managed.process.pid;
  if (process.platform === 'win32') {
    exec(`taskkill /PID ${pid} /T /F`, { stdio: 'ignore' } as any);
  } else {
    try { managed.process.kill(); } catch { /* already dead */ }
  }
}
```

**Why not `managed.process.kill()` on Windows?** node-pty's ConPTY implementation of `kill()` internally uses `child_process.fork()` with `process.execPath` to run a `conpty_console_list_agent` helper. In a packaged Electron app, `process.execPath` points to `ClaudeTerminal.exe`, so calling `kill()` would launch a second instance of the entire application. Instead, `taskkill /PID <pid> /T /F` is used:

- `/PID <pid>` — target the PTY's process ID
- `/T` — kill the entire process tree (the shell and all children)
- `/F` — force kill (no graceful shutdown prompt)

The `exec()` call is fire-and-forget to avoid blocking the main process while `taskkill` runs.

### Application Exit

When all windows are closed, the `window-all-closed` handler calls `ptyManager.killAll()`, which iterates every tracked PTY and calls `kill()` on each:

```typescript
app.on('window-all-closed', async () => {
  persistSessions();
  for (const tab of tabManager.getAllTabs()) {
    cleanupNamingFlag(tab.id);
  }
  ptyManager.killAll();
  // ... stop tunnel, IPC server, then app.quit()
});
```

### Process Exit Callback

Each PTY has a `proc.onExit()` callback registered in the IPC handler. When a PTY process exits on its own (e.g., the user types `/exit` in Claude, or `exit` in a shell), this callback:

1. Removes the flow control state for the tab
2. Cleans up the naming flag file
3. Removes the tab from `TabManager`
4. Notifies the renderer via `tab:removed`
5. Persists the updated session state

## Terminal Resize

When the renderer's terminal container changes size (window resize, tab switch, panel layout change), a `ResizeObserver` fires:

```
ResizeObserver on terminal container
  -> debounced (50ms) fitAddon.fit()
    -> term.cols / term.rows updated
      -> window.claudeTerminal.resizePty(tabId, cols, rows)
        -> ipcRenderer.send('pty:resize', tabId, cols, rows)
          -> ipcMain.on('pty:resize')
            -> PtyManager.resize(tabId, cols, rows)
              -> managed.process.resize(cols, rows)  // ConPTY SIGWINCH
              -> managed.cols = cols; managed.rows = rows;
```

The resize is debounced at 50ms in the renderer to avoid flooding the main process during continuous window drags.

`PtyManager.resize()` also stores the current dimensions so they can be queried later via `getSize()`.

In remote mode (fixed-size terminal driven by the host), `FitAddon` is not used. Instead, the terminal is resized directly to the host's `fixedCols` x `fixedRows`, and `pty:resize` is not sent since the host controls the PTY dimensions.

## Key Files

| File | Role |
|------|------|
| `src/main/pty-manager.ts` | PTY lifecycle: spawn, write, resize, kill |
| `src/main/ipc-handlers.ts` | Wires PTY events to renderer, owns flow control state |
| `src/main/index.ts` | Calls `killAll()` on app exit |
| `src/shared/claude-cli.ts` | Resolves `claude` command (cmd.exe /c workaround) |
| `src/shared/types.ts` | `Tab`, `TabType`, `PermissionMode`, `PERMISSION_FLAGS` |
| `src/preload.ts` | Exposes PTY IPC methods to renderer via contextBridge |
| `src/renderer/components/Terminal.tsx` | xterm.js setup, input forwarding, flow control triggers |
| `src/renderer/components/terminalCache.ts` | Shared terminal instances, `pendingBytes`, `pausedTabs` |
