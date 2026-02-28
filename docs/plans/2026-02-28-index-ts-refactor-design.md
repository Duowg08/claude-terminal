# index.ts Refactoring Design

**Date:** 2026-02-28
**Issues:** #7, #42, #43

## Problem

`src/main/index.ts` (649 lines) is a god file handling: app lifecycle, window creation, 15+ IPC handlers, hook message routing, tab naming via AI, session persistence, and settings coordination. It has zero test coverage.

## Approach: Extract by Responsibility with Dependency Injection

Extract 4 modules, each receiving dependencies as arguments (not singletons) so they're independently testable.

## New Modules

### `src/shared/claude-cli.ts`

Pure function, no dependencies. Resolves issue #7 (duplicated Windows CLI logic).

```ts
export function getClaudeCommand(flags: string[]): { command: string; args: string[] }
```

Used by `tab-namer.ts` (for `execFile`) and `pty-manager.ts` (for `pty.spawn`).

### `src/main/tab-namer.ts`

Extracts `generateTabName` and `cleanupNamingFlag`.

```ts
interface TabNamerDeps {
  tabManager: TabManager;
  sendToRenderer: (channel: string, ...args: unknown[]) => void;
  persistSessions: () => void;
}

export function createTabNamer(deps: TabNamerDeps): {
  generateTabName: (tabId: string, prompt: string) => void;
  cleanupNamingFlag: (tabId: string) => void;
}
```

### `src/main/hook-router.ts`

Extracts `handleHookMessage` switch and `notifyTabActivity` helper.

```ts
interface HookRouterDeps {
  tabManager: TabManager;
  mainWindow: BrowserWindow | null;
  sendToRenderer: (channel: string, ...args: unknown[]) => void;
  persistSessions: () => void;
  generateTabName: (tabId: string, prompt: string) => void;
  cleanupNamingFlag: (tabId: string) => void;
}

export function createHookRouter(deps: HookRouterDeps): {
  handleHookMessage: (msg: IpcMessage) => void;
}
```

### `src/main/ipc-handlers.ts`

Extracts `registerIpcHandlers` — all `ipcMain.handle()` and `ipcMain.on()` calls.

```ts
interface IpcHandlerDeps {
  tabManager: TabManager;
  ptyManager: PtyManager;
  settings: SettingsStore;
  hookInstaller: HookInstaller | null;
  worktreeManager: WorktreeManager | null;
  mainWindow: BrowserWindow | null;
  permissionMode: PermissionMode;
  workspaceDir: string | null;
  cliStartDir: string | null;
  sendToRenderer: (channel: string, ...args: unknown[]) => void;
  persistSessions: () => void;
  cleanupNamingFlag: (tabId: string) => void;
  // Setters for mutable state
  setWorkspaceDir: (dir: string) => void;
  setPermissionMode: (mode: PermissionMode) => void;
  setWorktreeManager: (wm: WorktreeManager) => void;
  setHookInstaller: (hi: HookInstaller) => void;
}

export function registerIpcHandlers(deps: IpcHandlerDeps): void;
```

## Modified Files

### `src/main/pty-manager.ts`

Replace inline platform detection with `getClaudeCommand()` import.

### `src/main/index.ts` (~100 lines)

Becomes pure lifecycle glue:
1. Instantiate singletons (tabManager, ptyManager, settings)
2. Create tab-namer, hook-router via factory functions
3. Wire dependencies into `registerIpcHandlers`
4. `app.on('ready')` — start IPC server, register handlers, create window
5. `app.on('window-all-closed')` — persist, cleanup, quit

## New Tests

- `tests/main/claude-cli.test.ts` — platform-aware command generation
- `tests/main/tab-namer.test.ts` — name generation, cleanup, error handling
- `tests/main/hook-router.test.ts` — all 6+ event types, edge cases
- `tests/main/ipc-handlers.test.ts` — handler registration and behavior

All testable via injected mock dependencies without mocking Electron internals.

## Dependency Order

1. `claude-cli.ts` (no dependencies)
2. `tab-namer.ts` (depends on claude-cli)
3. `hook-router.ts` (depends on tab-namer interface)
4. `ipc-handlers.ts` (depends on all managers)
5. Update `pty-manager.ts` to use claude-cli
6. Rewrite `index.ts` as lifecycle glue
7. Add tests for all new modules
