# Remote createTab & createWorktree Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the + button in the remote mobile web client actually create new Claude tabs and worktree tabs on the host machine via the WebSocket tunnel.

**Architecture:** Export `wirePtyToTab` from `registerIpcHandlers` so the WS server can reuse it. Add `tab:create` and `tab:createWithWorktree` message handlers in the WS server. Update the ws-bridge client to send these messages instead of throwing. Wire up the web client UI with real handlers.

**Tech Stack:** TypeScript, Electron IPC, WebSocket (ws), React

---

### Task 1: Export wirePtyToTab from registerIpcHandlers

**Files:**
- Modify: `src/main/ipc-handlers.ts:41` (return type)
- Modify: `src/main/index.ts:320-324` (destructure return value)

**Step 1: Change return type of registerIpcHandlers**

Currently returns `() => void` (cleanup). Change to return an object with both cleanup and wirePtyToTab.

In `src/main/ipc-handlers.ts`, change the export type and the return type:

```typescript
// Line 5: add WirePtyToTabFn type export
export type WirePtyToTabFn = (
  proc: { pid: number; onData: (cb: (data: string) => void) => void; onExit: (cb: () => void) => void },
  tab: Tab,
  cwd: string,
  opts?: { alwaysActivate?: boolean },
) => void;
```

Change the function signature (line 41):
```typescript
export function registerIpcHandlers(deps: IpcHandlerDeps): { cleanup: () => void; wirePtyToTab: WirePtyToTabFn } {
```

Change the return statement (currently line ~507):
```typescript
  return {
    cleanup: () => {
      if (gitHeadDebounceTimer) {
        clearTimeout(gitHeadDebounceTimer);
        gitHeadDebounceTimer = null;
      }
      if (gitHeadWatcher) {
        gitHeadWatcher.close();
        gitHeadWatcher = null;
      }
    },
    wirePtyToTab,
  };
```

**Step 2: Update index.ts to destructure**

In `src/main/index.ts`, change lines 320-324:

```typescript
// Before:
cleanupIpcHandlers = registerIpcHandlers({ ... });

// After:
const ipcResult = registerIpcHandlers({
  tabManager, ptyManager, settings, state,
  sendToRenderer, persistSessions, cleanupNamingFlag,
  activateRemoteAccess, deactivateRemoteAccess, getRemoteAccessInfo,
});
cleanupIpcHandlers = ipcResult.cleanup;
```

Store `ipcResult.wirePtyToTab` for later use by WebRemoteServer (will be passed in Task 3).

**Step 3: Update ipc-handlers test**

In `tests/main/ipc-handlers.test.ts`, the test calls `registerIpcHandlers(deps)` which now returns `{ cleanup, wirePtyToTab }` instead of a function. Update any references:

Currently line 119: `registerIpcHandlers(deps)` — the return value isn't stored/used in tests, so no change needed.

**Step 4: Run tests**

Run: `npx vitest run tests/main/ipc-handlers.test.ts`
Expected: All 18 tests pass

**Step 5: Commit**

```bash
git add src/main/ipc-handlers.ts src/main/index.ts
git commit -m "refactor: export wirePtyToTab from registerIpcHandlers"
```

---

### Task 2: Add worktreeProgress forwarding to sendToRenderer

**Files:**
- Modify: `src/main/index.ts:69-88` (sendToRenderer function)

**Step 1: Add worktreeProgress forwarding**

In `src/main/index.ts`, add a new branch to the `sendToRenderer` function:

```typescript
    } else if (channel === 'tab:worktreeProgress') {
      webRemoteServer.broadcast({ type: 'tab:worktreeProgress', tabId: args[0], text: args[1] });
    }
```

Add this after the `tab:switched` branch (line 85-86).

**Step 2: Add tab:worktreeProgress handling in ws-bridge**

In `src/web-client/ws-bridge.ts`, add a listener set and handle the message:

Add field:
```typescript
private worktreeProgressListeners = new Set<(tabId: string, text: string) => void>();
```

Add case in `handleMessage`:
```typescript
      case 'tab:worktreeProgress':
        if (msg.tabId && typeof msg.text === 'string') {
          for (const cb of this.worktreeProgressListeners) {
            cb(msg.tabId, msg.text);
          }
        }
        break;
```

Update `onWorktreeProgress` in `api` getter from no-op to real:
```typescript
      onWorktreeProgress: (callback: (tabId: string, text: string) => void): (() => void) => {
        this.worktreeProgressListeners.add(callback);
        return () => { this.worktreeProgressListeners.delete(callback); };
      },
```

**Step 3: Commit**

```bash
git add src/main/index.ts src/web-client/ws-bridge.ts
git commit -m "feat: forward worktree progress events to remote WS clients"
```

---

### Task 3: Add tab:create and tab:createWithWorktree to WS server

**Files:**
- Modify: `src/main/web-remote-server.ts:12-20` (deps interface)
- Modify: `src/main/web-remote-server.ts:257-301` (handleMessage)
- Modify: `src/main/index.ts:149-159` (WebRemoteServer constructor call)

**Step 1: Expand WebRemoteServerDeps**

In `src/main/web-remote-server.ts`, add imports and new deps:

```typescript
import os from 'node:os';
import type { Tab } from '@shared/types';
import { PERMISSION_FLAGS } from '@shared/types';
import type { WirePtyToTabFn } from './ipc-handlers';
```

Add to `WebRemoteServerDeps`:
```typescript
export interface WebRemoteServerDeps {
  tabManager: TabManager;
  ptyManager: PtyManager;
  state: AppState;
  sendToRenderer: (channel: string, ...args: unknown[]) => void;
  persistSessions: () => void;
  serializeTerminal: (tabId: string) => Promise<string>;
  wirePtyToTab: WirePtyToTabFn;
  settings: { addRecentDir: (dir: string) => Promise<void> };
}
```

**Step 2: Add tab:create handler in handleMessage**

In the `switch (msg.type)` block, add before `default`:

```typescript
      case 'tab:create': {
        const { state } = this.deps;
        if (!state.workspaceDir) {
          log.warn('[web-remote] tab:create ignored: no workspace');
          break;
        }
        const cwd = state.workspaceDir;
        const tab = tabManager.createTab(cwd, null, 'claude');

        if (state.hookInstaller) {
          state.hookInstaller.install(cwd);
        }

        const args: string[] = [...(PERMISSION_FLAGS[state.permissionMode] ?? [])];
        const extraEnv: Record<string, string> = {
          CLAUDE_TERMINAL_TAB_ID: tab.id,
          CLAUDE_TERMINAL_PIPE: state.pipeName,
          CLAUDE_TERMINAL_TMPDIR: os.tmpdir(),
        };

        const proc = ptyManager.spawn(tab.id, cwd, args, extraEnv);
        await this.deps.settings.addRecentDir(state.workspaceDir);
        this.deps.wirePtyToTab(proc, tab, cwd);

        // Respond to requesting client so createTab() promise resolves
        client.ws.send(JSON.stringify({ type: 'tab:created', tab }));
        break;
      }
```

**Step 3: Add tab:createWithWorktree handler**

```typescript
      case 'tab:createWithWorktree': {
        const { state } = this.deps;
        if (!state.workspaceDir || !state.worktreeManager) {
          log.warn('[web-remote] tab:createWithWorktree ignored: no workspace/worktreeManager');
          break;
        }
        const worktreeName = msg.name;
        if (typeof worktreeName !== 'string' || !worktreeName) break;

        const CYAN = '\x1b[36m';
        const GREEN = '\x1b[32m';
        const RED = '\x1b[31m';
        const DIM = '\x1b[2m';
        const RESET = '\x1b[0m';

        const cwd = path.join(state.workspaceDir, '.claude', 'worktrees', worktreeName);
        const tab = tabManager.createTab(cwd, worktreeName, 'claude');
        this.deps.sendToRenderer('tab:updated', tab);
        this.deps.persistSessions();

        // Respond immediately so createTabWithWorktree() promise resolves
        client.ws.send(JSON.stringify({ type: 'tab:created', tab }));

        const sendProgress = (text: string) => {
          this.deps.sendToRenderer('tab:worktreeProgress', tab.id, text);
        };

        const baseBranch = await state.worktreeManager.getCurrentBranch();

        // Async setup (mirrors ipc-handlers tab:createWithWorktree)
        const doSetup = async () => {
          if (!tabManager.getTab(tab.id)) return;

          sendProgress(`${CYAN}❯${RESET} Creating worktree "${worktreeName}"...\r\n`);
          sendProgress(`  Branch: ${worktreeName} (from ${baseBranch})\r\n`);
          sendProgress(`  Path: .claude/worktrees/${worktreeName}\r\n`);

          try {
            await state.worktreeManager!.createAsync(worktreeName, (text) => {
              sendProgress(`${DIM}${text}${RESET}`);
            });

            if (!tabManager.getTab(tab.id)) return;

            sendProgress(`${GREEN}✓${RESET} Worktree created\r\n\r\n`);

            if (state.hookEngine) {
              state.hookEngine.emit('worktree:created', {
                contextRoot: cwd, name: worktreeName, path: cwd, branch: worktreeName,
              });
            }

            sendProgress(`${CYAN}❯${RESET} Starting Claude...\r\n`);

            if (state.hookInstaller) {
              state.hookInstaller.install(cwd);
            }

            const args: string[] = [
              ...(PERMISSION_FLAGS[state.permissionMode] ?? []),
              '-w', worktreeName,
            ];
            const extraEnv: Record<string, string> = {
              CLAUDE_TERMINAL_TAB_ID: tab.id,
              CLAUDE_TERMINAL_PIPE: state.pipeName,
              CLAUDE_TERMINAL_TMPDIR: os.tmpdir(),
            };

            const proc = ptyManager.spawn(tab.id, state.workspaceDir!, args, extraEnv);
            await this.deps.settings.addRecentDir(state.workspaceDir!);
            this.deps.wirePtyToTab(proc, tab, cwd);
          } catch (err) {
            sendProgress(`\r\n${RED}✗${RESET} Failed to create worktree\r\n`);
            if (err instanceof Error) {
              sendProgress(`${RED}${err.message}${RESET}\r\n`);
            }
            if (tabManager.getTab(tab.id)) {
              tabManager.removeTab(tab.id);
              this.deps.sendToRenderer('tab:removed', tab.id);
              this.deps.persistSessions();
            }
          }
        };

        setTimeout(doSetup, 50);
        break;
      }
```

**Step 4: Add getCurrentBranch handler**

```typescript
      case 'worktree:currentBranch': {
        const { state } = this.deps;
        const branch = state.worktreeManager
          ? await state.worktreeManager.getCurrentBranch()
          : '';
        client.ws.send(JSON.stringify({ type: 'worktree:currentBranch', branch }));
        break;
      }
```

**Step 5: Make handleMessage async**

The `handleMessage` method needs to be async because `addRecentDir`, `getCurrentBranch`, and `createAsync` are all async. Change the signature:

```typescript
  private async handleMessage(client: AuthenticatedSocket, msg: any): Promise<void> {
```

**Step 6: Pass new deps in index.ts**

In `src/main/index.ts`, update the `WebRemoteServer` constructor call:

```typescript
  webRemoteServer = new WebRemoteServer({
    tabManager, ptyManager, state,
    sendToRenderer, persistSessions,
    serializeTerminal: async (tabId: string): Promise<string> => {
      const win = state.mainWindow as BrowserWindow | null;
      if (!win || win.isDestroyed()) return '';
      return win.webContents.executeJavaScript(
        `window.__serializeTerminal(${JSON.stringify(tabId)})`,
      );
    },
    wirePtyToTab: ipcResult.wirePtyToTab,
    settings: { addRecentDir: (dir: string) => settings.addRecentDir(dir) },
  });
```

Note: `ipcResult` must be available at this scope. Since `activateRemoteAccess` is called after `registerIpcHandlers`, this works. Store `ipcResult` at module scope alongside `cleanupIpcHandlers`.

**Step 7: Run type check**

Run: `npx tsc --noEmit`
Expected: No type errors

**Step 8: Commit**

```bash
git add src/main/web-remote-server.ts src/main/index.ts
git commit -m "feat: add tab:create and tab:createWithWorktree WS handlers"
```

---

### Task 4: Update ws-bridge client to send messages

**Files:**
- Modify: `src/web-client/ws-bridge.ts:14` (add pending promise field)
- Modify: `src/web-client/ws-bridge.ts:122-183` (handleMessage)
- Modify: `src/web-client/ws-bridge.ts:195-315` (api getter)

**Step 1: Add pending promise support**

Add field to `WebSocketBridge` class:

```typescript
  private pendingTabCreate: { resolve: (tab: Tab) => void; reject: (err: Error) => void } | null = null;
  private pendingBranchRequest: { resolve: (branch: string) => void } | null = null;
```

**Step 2: Add tab:created case in handleMessage**

```typescript
      case 'tab:created':
        if (msg.tab && this.pendingTabCreate) {
          const pending = this.pendingTabCreate;
          this.pendingTabCreate = null;
          pending.resolve(msg.tab);
        }
        break;

      case 'worktree:currentBranch':
        if (this.pendingBranchRequest) {
          const pending = this.pendingBranchRequest;
          this.pendingBranchRequest = null;
          pending.resolve(msg.branch ?? '');
        }
        break;
```

**Step 3: Update createTab in api getter**

```typescript
      createTab: async (_worktree?: string | null): Promise<Tab> => {
        return new Promise((resolve, reject) => {
          this.pendingTabCreate = { resolve, reject };
          this.send({ type: 'tab:create' });
        });
      },
```

**Step 4: Add createTabWithWorktree**

```typescript
      createTabWithWorktree: async (name: string): Promise<Tab> => {
        return new Promise((resolve, reject) => {
          this.pendingTabCreate = { resolve, reject };
          this.send({ type: 'tab:createWithWorktree', name });
        });
      },
```

**Step 5: Update getCurrentBranch**

```typescript
      getCurrentBranch: async (): Promise<string> => {
        return new Promise((resolve) => {
          this.pendingBranchRequest = { resolve };
          this.send({ type: 'worktree:currentBranch' });
        });
      },
```

**Step 6: Commit**

```bash
git add src/web-client/ws-bridge.ts
git commit -m "feat: ws-bridge createTab and createTabWithWorktree send WS messages"
```

---

### Task 5: Wire up main.tsx with real handlers

**Files:**
- Modify: `src/web-client/main.tsx:1-10` (imports)
- Modify: `src/web-client/main.tsx:108-259` (RemoteApp component)

**Step 1: Add imports**

```typescript
import WorktreeNameDialog from '../renderer/components/WorktreeNameDialog';
```

**Step 2: Add state and handlers to RemoteApp**

Inside `RemoteApp`, add:

```typescript
  const [showWorktreeDialog, setShowWorktreeDialog] = useState(false);

  const handleNewClaudeTab = useCallback(async () => {
    try {
      const tab = await window.claudeTerminal.createTab(null);
      setActiveTabId(tab.id);
    } catch (err) {
      console.error('Failed to create tab:', err);
    }
  }, []);

  const handleNewWorktreeTab = useCallback(async (name: string) => {
    try {
      const tab = await window.claudeTerminal.createTabWithWorktree(name);
      setActiveTabId(tab.id);
      setShowWorktreeDialog(false);
    } catch (err) {
      console.error('Failed to create worktree tab:', err);
    }
  }, []);
```

**Step 3: Wire up TabBar props**

Replace the noop lines:
```typescript
        onNewClaudeTab={handleNewClaudeTab}
        onNewWorktreeTab={() => setShowWorktreeDialog(true)}
```

Keep `onNewShellTab={noop}` — shell tabs from remote don't make sense.

**Step 4: Add WorktreeNameDialog render**

After `<StatusBar>`, add:

```tsx
      {showWorktreeDialog && (
        <WorktreeNameDialog
          onCreateWithWorktree={handleNewWorktreeTab}
          onCancel={() => setShowWorktreeDialog(false)}
        />
      )}
```

**Step 5: Run type check**

Run: `npx tsc --noEmit`
Expected: No type errors

**Step 6: Commit**

```bash
git add src/web-client/main.tsx
git commit -m "feat: wire remote + button to create tabs and worktree tabs"
```

---

### Task 6: Write tests for WS server tab creation

**Files:**
- Create: `tests/main/web-remote-server.test.ts`

**Step 1: Write the test file**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('electron', () => ({
  app: { isPackaged: false },
}));
vi.mock('@main/logger', () => ({
  log: { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

import { WebRemoteServer, type WebRemoteServerDeps } from '@main/web-remote-server';
import type { TabManager } from '@main/tab-manager';
import type { PtyManager } from '@main/pty-manager';
import type { AppState } from '@main/ipc-handlers';

function makeMockDeps(): WebRemoteServerDeps {
  const mockProc = { pid: 9999, onData: vi.fn(), onExit: vi.fn() };

  return {
    tabManager: {
      createTab: vi.fn(() => ({ id: 'tab-new', name: 'Tab', cwd: '/test', worktree: null, pid: null, type: 'claude' })),
      getTab: vi.fn((id: string) => ({ id, name: 'Tab', cwd: '/test', worktree: null, pid: null, type: 'claude' })),
      getAllTabs: vi.fn(() => []),
      getActiveTabId: vi.fn(() => null),
      setActiveTab: vi.fn(),
      rename: vi.fn(),
      removeTab: vi.fn(),
    } as unknown as TabManager,
    ptyManager: {
      spawn: vi.fn(() => mockProc),
      write: vi.fn(),
      getSize: vi.fn(),
    } as unknown as PtyManager,
    state: {
      workspaceDir: '/test',
      permissionMode: 'bypassPermissions',
      worktreeManager: null,
      hookInstaller: null,
      hookConfigStore: null,
      hookEngine: null,
      mainWindow: null,
      cliStartDir: null,
      pipeName: '\\\\.\\pipe\\test-pipe',
    } as AppState,
    sendToRenderer: vi.fn(),
    persistSessions: vi.fn(),
    serializeTerminal: vi.fn(async () => ''),
    wirePtyToTab: vi.fn(),
    settings: { addRecentDir: vi.fn(async () => {}) },
  };
}

// Helper: access handleMessage via a mock WebSocket
function createTestClient(server: WebRemoteServer, deps: WebRemoteServerDeps) {
  const sentMessages: any[] = [];
  const mockWs = {
    readyState: 1, // WebSocket.OPEN
    send: vi.fn((data: string) => sentMessages.push(JSON.parse(data))),
    close: vi.fn(),
    on: vi.fn(),
  };

  // Trigger connection + auth
  const wssHandler = (server as any).wss?.on?.mock?.calls?.[0]?.[1];

  // Alternatively, directly call handleMessage via the private method
  return {
    sendMessage: async (msg: any) => {
      await (server as any).handleMessage({ ws: mockWs, authenticated: true }, msg);
    },
    sentMessages,
    mockWs,
  };
}

describe('WebRemoteServer handleMessage', () => {
  let deps: WebRemoteServerDeps;
  let server: WebRemoteServer;

  beforeEach(() => {
    deps = makeMockDeps();
    server = new WebRemoteServer(deps);
  });

  describe('tab:create', () => {
    it('creates a tab and spawns a PTY', async () => {
      const { sendMessage, sentMessages } = createTestClient(server, deps);
      await sendMessage({ type: 'tab:create' });

      expect(deps.tabManager.createTab).toHaveBeenCalledWith('/test', null, 'claude');
      expect(deps.ptyManager.spawn).toHaveBeenCalledWith(
        'tab-new', '/test', expect.any(Array), expect.any(Object),
      );
      expect(deps.wirePtyToTab).toHaveBeenCalledWith(
        expect.anything(), expect.objectContaining({ id: 'tab-new' }), '/test',
      );
      expect(sentMessages).toContainEqual(
        expect.objectContaining({ type: 'tab:created', tab: expect.objectContaining({ id: 'tab-new' }) }),
      );
    });

    it('ignores when workspaceDir is null', async () => {
      deps.state.workspaceDir = null;
      const { sendMessage } = createTestClient(server, deps);
      await sendMessage({ type: 'tab:create' });

      expect(deps.tabManager.createTab).not.toHaveBeenCalled();
    });
  });

  describe('tab:createWithWorktree', () => {
    it('ignores when worktreeManager is null', async () => {
      const { sendMessage } = createTestClient(server, deps);
      await sendMessage({ type: 'tab:createWithWorktree', name: 'my-feature' });

      // Tab is NOT created because worktreeManager is null
      expect(deps.tabManager.createTab).not.toHaveBeenCalled();
    });

    it('creates tab immediately and responds with tab:created', async () => {
      deps.state.worktreeManager = {
        getCurrentBranch: vi.fn(async () => 'main'),
        createAsync: vi.fn(async () => '/test/.claude/worktrees/feat'),
      } as any;

      const { sendMessage, sentMessages } = createTestClient(server, deps);
      await sendMessage({ type: 'tab:createWithWorktree', name: 'feat' });

      expect(deps.tabManager.createTab).toHaveBeenCalled();
      expect(sentMessages).toContainEqual(
        expect.objectContaining({ type: 'tab:created' }),
      );
    });
  });

  describe('worktree:currentBranch', () => {
    it('returns empty string when worktreeManager is null', async () => {
      const { sendMessage, sentMessages } = createTestClient(server, deps);
      await sendMessage({ type: 'worktree:currentBranch' });

      expect(sentMessages).toContainEqual({ type: 'worktree:currentBranch', branch: '' });
    });

    it('returns branch name when worktreeManager exists', async () => {
      deps.state.worktreeManager = {
        getCurrentBranch: vi.fn(async () => 'main'),
      } as any;

      const { sendMessage, sentMessages } = createTestClient(server, deps);
      await sendMessage({ type: 'worktree:currentBranch' });

      expect(sentMessages).toContainEqual({ type: 'worktree:currentBranch', branch: 'main' });
    });
  });
});
```

**Step 2: Run the tests**

Run: `npx vitest run tests/main/web-remote-server.test.ts`
Expected: All tests pass

**Step 3: Commit**

```bash
git add tests/main/web-remote-server.test.ts
git commit -m "test: add web-remote-server tab creation tests"
```

---

### Task 7: Run full test suite and verify

**Step 1: Run all tests**

Run: `npx vitest run`
Expected: All tests pass

**Step 2: Run type check**

Run: `npx tsc --noEmit`
Expected: No type errors

**Step 3: Final commit (if any fixups needed)**

```bash
git add -A
git commit -m "feat: remote + button creates tabs and worktree tabs via WS tunnel"
```
