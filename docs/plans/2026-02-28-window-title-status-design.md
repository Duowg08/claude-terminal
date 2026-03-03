# Window Title Tab Status Indicator

## Problem

The window title is static (`ClaudeTerminal - path`) and gives no indication of what's happening across tabs. Users have to look at the tab bar to see which sessions are working, idle, or need input.

## Solution

Dynamically update the Electron window title to include tab status counts, showing all 4 states with non-zero counts hidden.

**Format:** `ClaudeTerminal - D:\dev\project [2 Working, 1 Input]`

## Design

### State Labels

| TabStatus          | Label     |
| ------------------ | --------- |
| `new`              | New       |
| `working`          | Working   |
| `idle`             | Idle      |
| `requires_response`| Input     |

### Title Construction

- Base: `ClaudeTerminal - {workspaceDir}`
- Suffix: `[{count} {Label}, ...]` — only states with count > 0, in order: New, Working, Idle, Input
- If no tabs exist, no suffix
- Single tab example: `ClaudeTerminal - D:\dev [1 Working]`
- Multi tab example: `ClaudeTerminal - D:\dev [2 Working, 1 Idle, 1 Input]`

### Architecture

**Renderer-driven approach:**

1. `App.tsx` already has the `tabs[]` array and receives `tab:updated` / `tab:removed` events
2. Add a `useEffect` that reacts to `tabs` changes, computes status counts, builds the title string, and sends it to main via IPC
3. Add `setWindowTitle(title: string)` to the preload API
4. Main process adds `ipcMain.handle('window:setTitle', ...)` that calls `mainWindow.setTitle()`
5. Remove (or keep as fallback) the existing static title set in `session:start`

### Changes

1. **`src/preload.ts`** — add `setWindowTitle` method
2. **`src/main/index.ts`** — add `window:setTitle` IPC handler
3. **`src/renderer/App.tsx`** — add `useEffect` to compute and send title on tab changes
4. **`src/shared/types.ts`** — add `setWindowTitle` to `ClaudeTerminalApi` type (if typed there)
