# ClaudeTerminal Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build an Electron desktop app that manages multiple Claude Code instances in tabs, with hook-based status tracking, worktree management, and native OS notifications.

**Architecture:** Electron app with React renderer. Main process manages Claude PTY processes via node-pty (ConPTY on Windows). Claude Code hooks communicate status back to the app via a Windows named pipe IPC server. Each tab wraps an xterm.js terminal connected to a Claude PTY.

**Tech Stack:** Electron Forge (Vite + TypeScript), React, xterm.js v5 (@xterm scoped packages), node-pty, electron-store, Vitest

---

### Task 1: Project Scaffolding

**Files:**
- Create: `package.json` (via Electron Forge)
- Create: `forge.config.ts`
- Create: `vite.main.config.mjs`
- Create: `vite.preload.config.mjs`
- Create: `vite.renderer.config.mjs`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `.gitignore`

**Step 1: Scaffold Electron Forge project**

Run from parent directory (`D:\dev`):
```bash
npx create-electron-app@latest ClaudeTerminal --template=vite-typescript
```

If the directory already exists (it does — has the docs folder), scaffold into a temp dir and move files:
```bash
npx create-electron-app@latest ClaudeTerminal-temp --template=vite-typescript
# Copy all generated files (except .git) into ClaudeTerminal
# Remove ClaudeTerminal-temp
```

**Step 2: Install dependencies**

```bash
cd D:\dev\ClaudeTerminal

# React
npm install react react-dom
npm install --save-dev @types/react @types/react-dom

# xterm.js (scoped v5 packages)
npm install @xterm/xterm @xterm/addon-fit @xterm/addon-webgl @xterm/addon-web-links

# node-pty + native module support
npm install node-pty
npm install --save-dev @electron-forge/plugin-auto-unpack-natives

# Settings persistence
npm install electron-store

# Testing
npm install --save-dev vitest @testing-library/react @testing-library/jest-dom jsdom
```

**Step 3: Configure Vite to externalize node-pty**

In `vite.main.config.mjs`:
```js
import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    rollupOptions: {
      external: ['node-pty'],
    },
  },
});
```

**Step 4: Configure forge.config.ts for native modules**

Add `auto-unpack-natives` plugin and set `asar: true`:
```ts
import type { ForgeConfig } from '@electron-forge/shared-types';
import { VitePlugin } from '@electron-forge/plugin-vite';
import { AutoUnpackNativesPlugin } from '@electron-forge/plugin-auto-unpack-natives';

const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
  },
  plugins: [
    new AutoUnpackNativesPlugin({}),
    new VitePlugin({
      build: [
        { entry: 'src/main/index.ts', config: 'vite.main.config.mjs' },
        { entry: 'src/preload.ts', config: 'vite.preload.config.mjs' },
      ],
      renderer: [
        { name: 'main_window', config: 'vite.renderer.config.mjs' },
      ],
    }),
  ],
};

export default config;
```

**Step 5: Add JSX support to tsconfig.json**

Add to `compilerOptions`:
```json
{
  "compilerOptions": {
    "jsx": "react-jsx",
    "strict": true,
    "esModuleInterop": true,
    "moduleResolution": "bundler",
    "paths": {
      "@shared/*": ["./src/shared/*"],
      "@main/*": ["./src/main/*"]
    }
  }
}
```

**Step 6: Create vitest.config.ts**

```ts
import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
  },
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, 'src/shared'),
      '@main': path.resolve(__dirname, 'src/main'),
    },
  },
});
```

**Step 7: Create test setup**

Create `tests/setup.ts`:
```ts
import '@testing-library/jest-dom';

vi.mock('electron', () => ({
  ipcRenderer: { invoke: vi.fn(), on: vi.fn(), send: vi.fn() },
  ipcMain: { handle: vi.fn(), on: vi.fn() },
  app: { getPath: vi.fn(() => '/tmp'), quit: vi.fn() },
  BrowserWindow: vi.fn(),
  Notification: vi.fn(),
}));
```

**Step 8: Restructure src/ to match design**

Move the scaffolded `src/main.ts` to `src/main/index.ts`. Keep `src/preload.ts`. Create directories:
```
src/
├── main/
│   └── index.ts
├── renderer/
│   ├── index.html
│   ├── renderer.ts
│   ├── App.tsx
│   └── components/
├── hooks/
├── shared/
│   └── types.ts
└── preload.ts
```

**Step 9: Verify it builds and runs**

```bash
npm start
```
Expected: Empty Electron window opens with no errors.

**Step 10: Commit**

```bash
git add -A
git commit -m "feat: scaffold Electron Forge project with React, xterm.js, node-pty"
```

---

### Task 2: Shared Types

**Files:**
- Create: `src/shared/types.ts`
- Test: `tests/shared/types.test.ts`

**Step 1: Write the types test**

Create `tests/shared/types.test.ts`:
```ts
import { TabStatus, Tab, IpcMessage, PermissionMode } from '@shared/types';

describe('shared types', () => {
  it('TabStatus has all expected values', () => {
    const statuses: TabStatus[] = ['new', 'working', 'idle', 'requires_response'];
    expect(statuses).toHaveLength(4);
  });

  it('Tab has required fields', () => {
    const tab: Tab = {
      id: 'tab-1',
      name: 'Tab 1',
      status: 'new',
      worktree: null,
      cwd: '/some/path',
      pid: null,
    };
    expect(tab.id).toBe('tab-1');
    expect(tab.worktree).toBeNull();
  });

  it('IpcMessage has required structure', () => {
    const msg: IpcMessage = {
      tabId: 'tab-1',
      event: 'tab:status:working',
      data: null,
    };
    expect(msg.event).toBe('tab:status:working');
  });

  it('PermissionMode has expected values', () => {
    const modes: PermissionMode[] = ['default', 'plan', 'acceptEdits', 'bypassPermissions'];
    expect(modes).toHaveLength(4);
  });
});
```

**Step 2: Run test to verify it fails**

```bash
npx vitest run tests/shared/types.test.ts
```
Expected: FAIL — module not found.

**Step 3: Write the types**

Create `src/shared/types.ts`:
```ts
export type TabStatus = 'new' | 'working' | 'idle' | 'requires_response';

export type PermissionMode = 'default' | 'plan' | 'acceptEdits' | 'bypassPermissions';

export interface Tab {
  id: string;
  name: string;
  status: TabStatus;
  worktree: string | null;
  cwd: string;
  pid: number | null;
}

export interface IpcMessage {
  tabId: string;
  event: string;
  data: string | null;
}

export interface AppSettings {
  recentDirs: string[];
  lastPermissionMode: PermissionMode;
}

export const PIPE_NAME = '\\\\.\\pipe\\claude-terminal';

export const STATUS_INDICATORS: Record<TabStatus, string> = {
  new: '●',
  working: '◉',
  requires_response: '◈',
  idle: '○',
};

export const PERMISSION_FLAGS: Record<PermissionMode, string[]> = {
  default: [],
  plan: ['--plan'],
  acceptEdits: ['--allowedTools', 'Edit,Write,NotebookEdit'],
  bypassPermissions: ['--dangerously-skip-permissions'],
};
```

**Step 4: Run test to verify it passes**

```bash
npx vitest run tests/shared/types.test.ts
```
Expected: PASS

**Step 5: Commit**

```bash
git add src/shared/types.ts tests/shared/types.test.ts
git commit -m "feat: add shared types for tabs, IPC messages, and permissions"
```

---

### Task 3: Settings Store

**Files:**
- Create: `src/main/settings-store.ts`
- Test: `tests/main/settings-store.test.ts`

**Step 1: Write the failing test**

Create `tests/main/settings-store.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('electron-store', () => {
  return {
    default: vi.fn().mockImplementation(() => {
      const data: Record<string, unknown> = {};
      return {
        get: vi.fn((key: string, defaultVal?: unknown) => data[key] ?? defaultVal),
        set: vi.fn((key: string, val: unknown) => { data[key] = val; }),
      };
    }),
  };
});

import { SettingsStore } from '@main/settings-store';

describe('SettingsStore', () => {
  let store: SettingsStore;

  beforeEach(() => {
    store = new SettingsStore();
  });

  it('returns empty recent dirs by default', () => {
    expect(store.getRecentDirs()).toEqual([]);
  });

  it('adds a recent directory', () => {
    store.addRecentDir('D:\\dev\\MyApp');
    expect(store.getRecentDirs()).toContain('D:\\dev\\MyApp');
  });

  it('moves duplicate to front', () => {
    store.addRecentDir('D:\\dev\\A');
    store.addRecentDir('D:\\dev\\B');
    store.addRecentDir('D:\\dev\\A');
    const dirs = store.getRecentDirs();
    expect(dirs[0]).toBe('D:\\dev\\A');
    expect(dirs).toHaveLength(2);
  });

  it('limits to 10 recent dirs', () => {
    for (let i = 0; i < 15; i++) {
      store.addRecentDir(`D:\\dev\\project${i}`);
    }
    expect(store.getRecentDirs()).toHaveLength(10);
  });

  it('returns bypassPermissions as default permission mode', () => {
    expect(store.getPermissionMode()).toBe('bypassPermissions');
  });

  it('saves and retrieves permission mode', () => {
    store.setPermissionMode('plan');
    expect(store.getPermissionMode()).toBe('plan');
  });
});
```

**Step 2: Run test to verify it fails**

```bash
npx vitest run tests/main/settings-store.test.ts
```
Expected: FAIL — module not found.

**Step 3: Write the implementation**

Create `src/main/settings-store.ts`:
```ts
import Store from 'electron-store';
import { AppSettings, PermissionMode } from '@shared/types';

const MAX_RECENT_DIRS = 10;

export class SettingsStore {
  private store: Store;

  constructor() {
    this.store = new Store({ name: 'claude-terminal-settings' });
  }

  getRecentDirs(): string[] {
    return this.store.get('recentDirs', []) as string[];
  }

  addRecentDir(dir: string): void {
    const dirs = this.getRecentDirs().filter(d => d !== dir);
    dirs.unshift(dir);
    this.store.set('recentDirs', dirs.slice(0, MAX_RECENT_DIRS));
  }

  getPermissionMode(): PermissionMode {
    return this.store.get('permissionMode', 'bypassPermissions') as PermissionMode;
  }

  setPermissionMode(mode: PermissionMode): void {
    this.store.set('permissionMode', mode);
  }
}
```

**Step 4: Run test to verify it passes**

```bash
npx vitest run tests/main/settings-store.test.ts
```
Expected: PASS

**Step 5: Commit**

```bash
git add src/main/settings-store.ts tests/main/settings-store.test.ts
git commit -m "feat: add settings store for recent dirs and permission mode"
```

---

### Task 4: Named Pipe IPC Server

**Files:**
- Create: `src/main/ipc-server.ts`
- Test: `tests/main/ipc-server.test.ts`

**Step 1: Write the failing test**

Create `tests/main/ipc-server.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import net from 'net';
import { HookIpcServer } from '@main/ipc-server';
import { IpcMessage } from '@shared/types';

describe('HookIpcServer', () => {
  let server: HookIpcServer;
  const TEST_PIPE = '\\\\.\\pipe\\claude-terminal-test-' + process.pid;

  beforeEach(() => {
    server = new HookIpcServer(TEST_PIPE);
  });

  afterEach(async () => {
    await server.stop();
  });

  it('starts and accepts connections', async () => {
    await server.start();
    const client = net.createConnection(TEST_PIPE);
    await new Promise<void>((resolve) => client.on('connect', resolve));
    client.destroy();
  });

  it('parses incoming IPC messages', async () => {
    await server.start();
    const received: IpcMessage[] = [];
    server.onMessage((msg) => received.push(msg));

    const client = net.createConnection(TEST_PIPE);
    await new Promise<void>((resolve) => client.on('connect', resolve));

    const msg: IpcMessage = { tabId: 'tab-1', event: 'tab:status:working', data: null };
    client.write(JSON.stringify(msg) + '\n');

    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(received).toHaveLength(1);
    expect(received[0].tabId).toBe('tab-1');
    expect(received[0].event).toBe('tab:status:working');
    client.destroy();
  });

  it('handles multiple messages on same connection', async () => {
    await server.start();
    const received: IpcMessage[] = [];
    server.onMessage((msg) => received.push(msg));

    const client = net.createConnection(TEST_PIPE);
    await new Promise<void>((resolve) => client.on('connect', resolve));

    client.write(JSON.stringify({ tabId: 't1', event: 'e1', data: null }) + '\n');
    client.write(JSON.stringify({ tabId: 't2', event: 'e2', data: 'hello' }) + '\n');

    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(received).toHaveLength(2);
    client.destroy();
  });
});
```

**Step 2: Run test to verify it fails**

```bash
npx vitest run tests/main/ipc-server.test.ts
```
Expected: FAIL — module not found.

**Step 3: Write the implementation**

Create `src/main/ipc-server.ts`:
```ts
import net from 'net';
import { IpcMessage } from '@shared/types';

type MessageHandler = (msg: IpcMessage) => void;

export class HookIpcServer {
  private server: net.Server | null = null;
  private handlers: MessageHandler[] = [];
  private pipePath: string;

  constructor(pipePath: string) {
    this.pipePath = pipePath;
  }

  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = net.createServer((socket) => {
        let buffer = '';
        socket.on('data', (chunk) => {
          buffer += chunk.toString();
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';
          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const msg = JSON.parse(line) as IpcMessage;
              this.handlers.forEach((h) => h(msg));
            } catch {
              // ignore malformed messages
            }
          }
        });
      });
      this.server.on('error', reject);
      this.server.listen(this.pipePath, () => resolve());
    });
  }

  onMessage(handler: MessageHandler): void {
    this.handlers.push(handler);
  }

  async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => resolve());
      } else {
        resolve();
      }
    });
  }
}
```

**Step 4: Run test to verify it passes**

```bash
npx vitest run tests/main/ipc-server.test.ts
```
Expected: PASS

**Step 5: Commit**

```bash
git add src/main/ipc-server.ts tests/main/ipc-server.test.ts
git commit -m "feat: add named pipe IPC server for hook communication"
```

---

### Task 5: PTY Manager

**Files:**
- Create: `src/main/pty-manager.ts`
- Test: `tests/main/pty-manager.test.ts`

**Step 1: Write the failing test**

Create `tests/main/pty-manager.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockPty = {
  onData: vi.fn(),
  onExit: vi.fn(),
  write: vi.fn(),
  resize: vi.fn(),
  kill: vi.fn(),
  pid: 1234,
};

vi.mock('node-pty', () => ({
  spawn: vi.fn(() => mockPty),
}));

import { PtyManager } from '@main/pty-manager';

describe('PtyManager', () => {
  let manager: PtyManager;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new PtyManager();
  });

  it('spawns a Claude process with correct args', () => {
    const pty = require('node-pty');
    manager.spawn('tab-1', 'D:\\dev\\MyApp', ['--dangerously-skip-permissions'], {
      CLAUDE_TERMINAL_TAB_ID: 'tab-1',
    });

    expect(pty.spawn).toHaveBeenCalledWith(
      'claude',
      ['--dangerously-skip-permissions'],
      expect.objectContaining({
        cwd: 'D:\\dev\\MyApp',
        env: expect.objectContaining({
          CLAUDE_TERMINAL_TAB_ID: 'tab-1',
        }),
      }),
    );
  });

  it('tracks spawned processes by tab ID', () => {
    manager.spawn('tab-1', 'D:\\dev\\MyApp', [], {});
    expect(manager.getPty('tab-1')).toBeDefined();
    expect(manager.getPty('tab-999')).toBeUndefined();
  });

  it('writes data to PTY', () => {
    manager.spawn('tab-1', 'D:\\dev\\MyApp', [], {});
    manager.write('tab-1', 'hello');
    expect(mockPty.write).toHaveBeenCalledWith('hello');
  });

  it('resizes PTY', () => {
    manager.spawn('tab-1', 'D:\\dev\\MyApp', [], {});
    manager.resize('tab-1', 120, 40);
    expect(mockPty.resize).toHaveBeenCalledWith(120, 40);
  });

  it('kills and removes PTY', () => {
    manager.spawn('tab-1', 'D:\\dev\\MyApp', [], {});
    manager.kill('tab-1');
    expect(mockPty.write).toHaveBeenCalledWith('exit\r');
    // After timeout, kill is called — tested via behavior not timer
    expect(manager.getPty('tab-1')).toBeUndefined();
  });
});
```

**Step 2: Run test to verify it fails**

```bash
npx vitest run tests/main/pty-manager.test.ts
```
Expected: FAIL — module not found.

**Step 3: Write the implementation**

Create `src/main/pty-manager.ts`:
```ts
import * as pty from 'node-pty';

interface ManagedPty {
  process: pty.IPty;
  tabId: string;
}

export class PtyManager {
  private ptys = new Map<string, ManagedPty>();

  spawn(
    tabId: string,
    cwd: string,
    args: string[],
    extraEnv: Record<string, string>,
  ): pty.IPty {
    const shell = 'claude';
    const env = { ...process.env, ...extraEnv } as Record<string, string>;

    const proc = pty.spawn(shell, args, {
      name: 'xterm-256color',
      cols: 120,
      rows: 40,
      cwd,
      env,
    });

    this.ptys.set(tabId, { process: proc, tabId });
    return proc;
  }

  getPty(tabId: string): pty.IPty | undefined {
    return this.ptys.get(tabId)?.process;
  }

  write(tabId: string, data: string): void {
    this.ptys.get(tabId)?.process.write(data);
  }

  resize(tabId: string, cols: number, rows: number): void {
    this.ptys.get(tabId)?.process.resize(cols, rows);
  }

  kill(tabId: string): void {
    const managed = this.ptys.get(tabId);
    if (!managed) return;
    managed.process.write('exit\r');
    this.ptys.delete(tabId);
    setTimeout(() => {
      try { managed.process.kill(); } catch { /* already dead */ }
    }, 500);
  }

  killAll(): void {
    for (const tabId of this.ptys.keys()) {
      this.kill(tabId);
    }
  }
}
```

**Step 4: Run test to verify it passes**

```bash
npx vitest run tests/main/pty-manager.test.ts
```
Expected: PASS

**Step 5: Commit**

```bash
git add src/main/pty-manager.ts tests/main/pty-manager.test.ts
git commit -m "feat: add PTY manager for spawning Claude processes"
```

---

### Task 6: Worktree Manager

**Files:**
- Create: `src/main/worktree-manager.ts`
- Test: `tests/main/worktree-manager.test.ts`

**Step 1: Write the failing test**

Create `tests/main/worktree-manager.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { execSync } from 'child_process';

vi.mock('child_process', () => ({
  execSync: vi.fn(),
}));

import { WorktreeManager } from '@main/worktree-manager';

describe('WorktreeManager', () => {
  let manager: WorktreeManager;
  const mockExecSync = vi.mocked(execSync);

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new WorktreeManager('D:\\dev\\MyApp');
  });

  it('gets current branch name', () => {
    mockExecSync.mockReturnValue(Buffer.from('main\n'));
    expect(manager.getCurrentBranch()).toBe('main');
    expect(mockExecSync).toHaveBeenCalledWith(
      'git rev-parse --abbrev-ref HEAD',
      expect.objectContaining({ cwd: 'D:\\dev\\MyApp' }),
    );
  });

  it('creates a worktree from current branch', () => {
    mockExecSync
      .mockReturnValueOnce(Buffer.from('main\n'))  // getCurrentBranch
      .mockReturnValueOnce(Buffer.from(''));         // git worktree add
    const result = manager.create('feature/auth');
    expect(mockExecSync).toHaveBeenCalledWith(
      expect.stringContaining('git worktree add'),
      expect.anything(),
    );
    expect(result).toContain('feature/auth');
  });

  it('removes a worktree', () => {
    mockExecSync.mockReturnValue(Buffer.from(''));
    manager.remove('feature/auth');
    expect(mockExecSync).toHaveBeenCalledWith(
      expect.stringContaining('git worktree remove'),
      expect.anything(),
    );
  });

  it('lists existing worktrees', () => {
    mockExecSync.mockReturnValue(Buffer.from(
      'D:/dev/MyApp  abc1234 [main]\nD:/dev/MyApp/.claude/worktrees/feat  def5678 [feat]\n'
    ));
    const list = manager.list();
    expect(list).toHaveLength(2);
  });
});
```

**Step 2: Run test to verify it fails**

```bash
npx vitest run tests/main/worktree-manager.test.ts
```
Expected: FAIL — module not found.

**Step 3: Write the implementation**

Create `src/main/worktree-manager.ts`:
```ts
import { execSync } from 'child_process';
import path from 'path';

export interface WorktreeInfo {
  path: string;
  branch: string;
}

export class WorktreeManager {
  private rootDir: string;

  constructor(rootDir: string) {
    this.rootDir = rootDir;
  }

  getCurrentBranch(): string {
    const result = execSync('git rev-parse --abbrev-ref HEAD', {
      cwd: this.rootDir,
      encoding: 'utf-8',
    });
    return (typeof result === 'string' ? result : result.toString()).trim();
  }

  create(name: string): string {
    const worktreePath = path.join(this.rootDir, '.claude', 'worktrees', name);
    const branch = this.getCurrentBranch();
    execSync(
      `git worktree add "${worktreePath}" -b "${name}" "${branch}"`,
      { cwd: this.rootDir, encoding: 'utf-8' },
    );
    return worktreePath;
  }

  remove(name: string): void {
    const worktreePath = path.join(this.rootDir, '.claude', 'worktrees', name);
    execSync(
      `git worktree remove "${worktreePath}" --force`,
      { cwd: this.rootDir, encoding: 'utf-8' },
    );
    // Clean up the branch too
    try {
      execSync(`git branch -D "${name}"`, { cwd: this.rootDir, encoding: 'utf-8' });
    } catch {
      // branch may not exist or may have been merged
    }
  }

  list(): WorktreeInfo[] {
    const result = execSync('git worktree list', {
      cwd: this.rootDir,
      encoding: 'utf-8',
    });
    const output = typeof result === 'string' ? result : result.toString();
    return output
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const match = line.match(/^(.+?)\s+\w+\s+\[(.+?)\]/);
        return match
          ? { path: match[1].trim(), branch: match[2] }
          : { path: line.trim(), branch: 'unknown' };
      });
  }
}
```

**Step 4: Run test to verify it passes**

```bash
npx vitest run tests/main/worktree-manager.test.ts
```
Expected: PASS

**Step 5: Commit**

```bash
git add src/main/worktree-manager.ts tests/main/worktree-manager.test.ts
git commit -m "feat: add worktree manager for creating/removing git worktrees"
```

---

### Task 7: Hook Installer

**Files:**
- Create: `src/main/hook-installer.ts`
- Test: `tests/main/hook-installer.test.ts`

**Step 1: Write the failing test**

Create `tests/main/hook-installer.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';

vi.mock('fs', () => ({
  default: {
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn(),
    existsSync: vi.fn(() => false),
  },
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
  existsSync: vi.fn(() => false),
}));

import { HookInstaller } from '@main/hook-installer';

describe('HookInstaller', () => {
  let installer: HookInstaller;

  beforeEach(() => {
    vi.clearAllMocks();
    installer = new HookInstaller('D:\\dev\\ClaudeTerminal\\src\\hooks');
  });

  it('writes settings.local.json to target directory', () => {
    installer.install('D:\\dev\\MyApp', 'tab-1');

    expect(fs.mkdirSync).toHaveBeenCalledWith(
      expect.stringContaining('.claude'),
      expect.anything(),
    );
    expect(fs.writeFileSync).toHaveBeenCalledWith(
      expect.stringContaining('settings.local.json'),
      expect.any(String),
      'utf-8',
    );
  });

  it('generates valid JSON with all required hooks', () => {
    installer.install('D:\\dev\\MyApp', 'tab-1');

    const writeCall = vi.mocked(fs.writeFileSync).mock.calls[0];
    const content = JSON.parse(writeCall[1] as string);

    expect(content.hooks).toBeDefined();
    expect(content.hooks.SessionStart).toBeDefined();
    expect(content.hooks.UserPromptSubmit).toBeDefined();
    expect(content.hooks.PreToolUse).toBeDefined();
    expect(content.hooks.Stop).toBeDefined();
    expect(content.hooks.Notification).toBeDefined();
    expect(content.hooks.SessionEnd).toBeDefined();
  });

  it('includes tab ID in hook commands', () => {
    installer.install('D:\\dev\\MyApp', 'tab-42');

    const writeCall = vi.mocked(fs.writeFileSync).mock.calls[0];
    const content = writeCall[1] as string;
    expect(content).toContain('tab-42');
  });
});
```

**Step 2: Run test to verify it fails**

```bash
npx vitest run tests/main/hook-installer.test.ts
```
Expected: FAIL — module not found.

**Step 3: Write the implementation**

Create `src/main/hook-installer.ts`:
```ts
import fs from 'fs';
import path from 'path';
import { PIPE_NAME } from '@shared/types';

export class HookInstaller {
  private hooksDir: string;

  constructor(hooksDir: string) {
    this.hooksDir = hooksDir;
  }

  install(targetDir: string, tabId: string): void {
    const claudeDir = path.join(targetDir, '.claude');
    fs.mkdirSync(claudeDir, { recursive: true });

    const hookCommand = (scriptName: string) =>
      `bash "${path.join(this.hooksDir, scriptName)}" "${tabId}" "${PIPE_NAME}"`;

    const settings = {
      hooks: {
        SessionStart: [
          {
            matcher: 'startup',
            hooks: [{ type: 'command', command: hookCommand('on-session-start.sh'), timeout: 10 }],
          },
        ],
        UserPromptSubmit: [
          {
            hooks: [{ type: 'command', command: hookCommand('on-prompt-submit.sh'), timeout: 10 }],
          },
        ],
        PreToolUse: [
          {
            hooks: [{ type: 'command', command: hookCommand('on-tool-use.sh'), timeout: 10 }],
          },
        ],
        Stop: [
          {
            hooks: [{ type: 'command', command: hookCommand('on-stop.sh'), timeout: 10 }],
          },
        ],
        Notification: [
          {
            matcher: 'idle_prompt',
            hooks: [{ type: 'command', command: hookCommand('on-notification.sh'), timeout: 10 }],
          },
        ],
        SessionEnd: [
          {
            hooks: [{ type: 'command', command: hookCommand('on-session-end.sh'), timeout: 10 }],
          },
        ],
      },
    };

    fs.writeFileSync(
      path.join(claudeDir, 'settings.local.json'),
      JSON.stringify(settings, null, 2),
      'utf-8',
    );
  }
}
```

**Step 4: Run test to verify it passes**

```bash
npx vitest run tests/main/hook-installer.test.ts
```
Expected: PASS

**Step 5: Commit**

```bash
git add src/main/hook-installer.ts tests/main/hook-installer.test.ts
git commit -m "feat: add hook installer that writes .claude/settings.local.json"
```

---

### Task 8: Hook Scripts

**Files:**
- Create: `src/hooks/on-session-start.sh`
- Create: `src/hooks/on-prompt-submit.sh`
- Create: `src/hooks/on-tool-use.sh`
- Create: `src/hooks/on-stop.sh`
- Create: `src/hooks/on-notification.sh`
- Create: `src/hooks/on-session-end.sh`
- Create: `src/hooks/pipe-send.sh` (shared helper)
- Test: `tests/hooks/hook-scripts.test.ts`

**Step 1: Write the shared pipe-send helper**

Create `src/hooks/pipe-send.sh`:
```bash
#!/bin/bash
# Sends a JSON message to the ClaudeTerminal named pipe.
# Usage: pipe-send.sh <tab-id> <pipe-name> <event> [data]

TAB_ID="$1"
PIPE_NAME="$2"
EVENT="$3"
DATA="${4:-null}"

if [ "$DATA" != "null" ]; then
  DATA="\"$(echo "$DATA" | sed 's/"/\\"/g')\""
fi

MSG="{\"tabId\":\"${TAB_ID}\",\"event\":\"${EVENT}\",\"data\":${DATA}}"

# Write to named pipe using Node.js (portable across Windows/WSL)
node -e "
  const net = require('net');
  const client = net.createConnection('${PIPE_NAME}', () => {
    client.write('${MSG}\n');
    client.end();
  });
  client.on('error', () => process.exit(0));
"
```

**Step 2: Write each hook script**

Create `src/hooks/on-session-start.sh`:
```bash
#!/bin/bash
TAB_ID="$1"
PIPE_NAME="$2"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
bash "$SCRIPT_DIR/pipe-send.sh" "$TAB_ID" "$PIPE_NAME" "tab:ready"

# Set CLAUDE_TERMINAL_TAB_ID for this session
if [ -n "$CLAUDE_ENV_FILE" ]; then
  echo "export CLAUDE_TERMINAL_TAB_ID=\"$TAB_ID\"" >> "$CLAUDE_ENV_FILE"
fi
```

Create `src/hooks/on-prompt-submit.sh`:
```bash
#!/bin/bash
TAB_ID="$1"
PIPE_NAME="$2"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Read the prompt from stdin JSON
INPUT=$(cat)
PROMPT=$(echo "$INPUT" | node -e "
  let d='';
  process.stdin.on('data',c=>d+=c);
  process.stdin.on('end',()=>{
    try{
      const j=JSON.parse(d);
      const p=j.user_prompt||j.prompt||'';
      process.stdout.write(p.substring(0,40).replace(/\s+\S*$/,''));
    }catch{process.stdout.write('')}
  });
" 2>/dev/null <<< "$INPUT")

if [ -n "$PROMPT" ]; then
  bash "$SCRIPT_DIR/pipe-send.sh" "$TAB_ID" "$PIPE_NAME" "tab:name" "$PROMPT"
fi
```

Create `src/hooks/on-tool-use.sh`:
```bash
#!/bin/bash
TAB_ID="$1"
PIPE_NAME="$2"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
bash "$SCRIPT_DIR/pipe-send.sh" "$TAB_ID" "$PIPE_NAME" "tab:status:working"
```

Create `src/hooks/on-stop.sh`:
```bash
#!/bin/bash
TAB_ID="$1"
PIPE_NAME="$2"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
bash "$SCRIPT_DIR/pipe-send.sh" "$TAB_ID" "$PIPE_NAME" "tab:status:idle"
```

Create `src/hooks/on-notification.sh`:
```bash
#!/bin/bash
TAB_ID="$1"
PIPE_NAME="$2"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
bash "$SCRIPT_DIR/pipe-send.sh" "$TAB_ID" "$PIPE_NAME" "tab:status:input"
```

Create `src/hooks/on-session-end.sh`:
```bash
#!/bin/bash
TAB_ID="$1"
PIPE_NAME="$2"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
bash "$SCRIPT_DIR/pipe-send.sh" "$TAB_ID" "$PIPE_NAME" "tab:closed"
```

**Step 3: Write integration test for pipe-send**

Create `tests/hooks/hook-scripts.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import net from 'net';
import { execSync } from 'child_process';
import path from 'path';
import { IpcMessage } from '@shared/types';

describe('hook scripts integration', () => {
  const TEST_PIPE = '\\\\.\\pipe\\claude-terminal-hook-test-' + process.pid;
  let server: net.Server;
  let received: IpcMessage[];

  beforeEach(async () => {
    received = [];
    server = net.createServer((socket) => {
      let buffer = '';
      socket.on('data', (chunk) => {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.trim()) continue;
          try { received.push(JSON.parse(line)); } catch {}
        }
      });
    });
    await new Promise<void>((resolve) => server.listen(TEST_PIPE, resolve));
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('pipe-send.sh sends valid IPC message', () => {
    const scriptPath = path.resolve('src/hooks/pipe-send.sh');
    execSync(`bash "${scriptPath}" "tab-1" "${TEST_PIPE}" "tab:status:working"`, {
      timeout: 5000,
    });

    // Give the message time to arrive
    execSync('sleep 0.5');
    expect(received.length).toBeGreaterThanOrEqual(1);
    expect(received[0].tabId).toBe('tab-1');
    expect(received[0].event).toBe('tab:status:working');
  });
});
```

**Step 4: Run test**

```bash
npx vitest run tests/hooks/hook-scripts.test.ts
```
Expected: PASS

**Step 5: Commit**

```bash
git add src/hooks/ tests/hooks/
git commit -m "feat: add hook scripts for Claude Code status communication"
```

---

### Task 9: Tab Manager (State)

**Files:**
- Create: `src/main/tab-manager.ts`
- Test: `tests/main/tab-manager.test.ts`

**Step 1: Write the failing test**

Create `tests/main/tab-manager.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { TabManager } from '@main/tab-manager';
import { Tab } from '@shared/types';

describe('TabManager', () => {
  let manager: TabManager;

  beforeEach(() => {
    manager = new TabManager();
  });

  it('creates a tab with correct defaults', () => {
    const tab = manager.createTab('D:\\dev\\MyApp', null);
    expect(tab.status).toBe('new');
    expect(tab.cwd).toBe('D:\\dev\\MyApp');
    expect(tab.worktree).toBeNull();
    expect(tab.name).toBe('Tab 1');
  });

  it('increments tab names', () => {
    manager.createTab('D:\\dev\\MyApp', null);
    const tab2 = manager.createTab('D:\\dev\\MyApp', null);
    expect(tab2.name).toBe('Tab 2');
  });

  it('uses worktree name as tab name when provided', () => {
    const tab = manager.createTab('D:\\dev\\MyApp', 'feature/auth');
    expect(tab.name).toBe('feature/auth');
  });

  it('returns all tabs', () => {
    manager.createTab('D:\\dev\\A', null);
    manager.createTab('D:\\dev\\B', null);
    expect(manager.getAllTabs()).toHaveLength(2);
  });

  it('gets tab by id', () => {
    const tab = manager.createTab('D:\\dev\\MyApp', null);
    expect(manager.getTab(tab.id)).toBe(tab);
  });

  it('updates tab status', () => {
    const tab = manager.createTab('D:\\dev\\MyApp', null);
    manager.updateStatus(tab.id, 'working');
    expect(manager.getTab(tab.id)!.status).toBe('working');
  });

  it('renames a tab', () => {
    const tab = manager.createTab('D:\\dev\\MyApp', null);
    manager.rename(tab.id, 'auth refactor');
    expect(manager.getTab(tab.id)!.name).toBe('auth refactor');
  });

  it('removes a tab', () => {
    const tab = manager.createTab('D:\\dev\\MyApp', null);
    manager.removeTab(tab.id);
    expect(manager.getTab(tab.id)).toBeUndefined();
  });

  it('tracks active tab', () => {
    const tab1 = manager.createTab('D:\\dev\\A', null);
    const tab2 = manager.createTab('D:\\dev\\B', null);
    expect(manager.getActiveTabId()).toBe(tab1.id);
    manager.setActiveTab(tab2.id);
    expect(manager.getActiveTabId()).toBe(tab2.id);
  });
});
```

**Step 2: Run test to verify it fails**

```bash
npx vitest run tests/main/tab-manager.test.ts
```
Expected: FAIL — module not found.

**Step 3: Write the implementation**

Create `src/main/tab-manager.ts`:
```ts
import { Tab, TabStatus } from '@shared/types';

let nextTabNum = 1;

function generateId(): string {
  return `tab-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export class TabManager {
  private tabs = new Map<string, Tab>();
  private activeTabId: string | null = null;

  createTab(cwd: string, worktree: string | null): Tab {
    const id = generateId();
    const name = worktree ?? `Tab ${nextTabNum++}`;
    const tab: Tab = { id, name, status: 'new', worktree, cwd, pid: null };
    this.tabs.set(id, tab);
    if (!this.activeTabId) {
      this.activeTabId = id;
    }
    return tab;
  }

  getTab(id: string): Tab | undefined {
    return this.tabs.get(id);
  }

  getAllTabs(): Tab[] {
    return Array.from(this.tabs.values());
  }

  updateStatus(id: string, status: TabStatus): void {
    const tab = this.tabs.get(id);
    if (tab) tab.status = status;
  }

  rename(id: string, name: string): void {
    const tab = this.tabs.get(id);
    if (tab) tab.name = name;
  }

  removeTab(id: string): void {
    this.tabs.delete(id);
    if (this.activeTabId === id) {
      const remaining = this.getAllTabs();
      this.activeTabId = remaining.length > 0 ? remaining[0].id : null;
    }
  }

  getActiveTabId(): string | null {
    return this.activeTabId;
  }

  setActiveTab(id: string): void {
    if (this.tabs.has(id)) {
      this.activeTabId = id;
    }
  }
}
```

**Step 4: Run test to verify it passes**

```bash
npx vitest run tests/main/tab-manager.test.ts
```
Expected: PASS

**Step 5: Commit**

```bash
git add src/main/tab-manager.ts tests/main/tab-manager.test.ts
git commit -m "feat: add tab manager for tab lifecycle and state"
```

---

### Task 10: Preload Script (Context Bridge)

**Files:**
- Modify: `src/preload.ts`

**Step 1: Write the preload API**

This exposes main-process functionality to the renderer via `contextBridge`:

```ts
// src/preload.ts
import { contextBridge, ipcRenderer } from 'electron';
import { Tab, TabStatus, PermissionMode } from '@shared/types';

const api = {
  // Tab operations
  createTab: (worktree: string | null) => ipcRenderer.invoke('tab:create', worktree),
  closeTab: (tabId: string) => ipcRenderer.invoke('tab:close', tabId),
  switchTab: (tabId: string) => ipcRenderer.invoke('tab:switch', tabId),
  renameTab: (tabId: string, name: string) => ipcRenderer.invoke('tab:rename', tabId, name),
  getTabs: () => ipcRenderer.invoke('tab:getAll'),
  getActiveTabId: () => ipcRenderer.invoke('tab:getActiveId'),

  // PTY data
  writeToPty: (tabId: string, data: string) => ipcRenderer.send('pty:write', tabId, data),
  resizePty: (tabId: string, cols: number, rows: number) => ipcRenderer.send('pty:resize', tabId, cols, rows),

  // Worktree
  createWorktree: (name: string) => ipcRenderer.invoke('worktree:create', name),
  getCurrentBranch: () => ipcRenderer.invoke('worktree:currentBranch'),

  // Settings
  getRecentDirs: () => ipcRenderer.invoke('settings:recentDirs'),
  getPermissionMode: () => ipcRenderer.invoke('settings:permissionMode'),

  // Startup
  selectDirectory: () => ipcRenderer.invoke('dialog:selectDirectory'),
  startSession: (dir: string, mode: PermissionMode) => ipcRenderer.invoke('session:start', dir, mode),

  // Events from main
  onPtyData: (callback: (tabId: string, data: string) => void) => {
    const handler = (_: unknown, tabId: string, data: string) => callback(tabId, data);
    ipcRenderer.on('pty:data', handler);
    return () => ipcRenderer.removeListener('pty:data', handler);
  },
  onTabUpdate: (callback: (tab: Tab) => void) => {
    const handler = (_: unknown, tab: Tab) => callback(tab);
    ipcRenderer.on('tab:updated', handler);
    return () => ipcRenderer.removeListener('tab:updated', handler);
  },
  onTabRemoved: (callback: (tabId: string) => void) => {
    const handler = (_: unknown, tabId: string) => callback(tabId);
    ipcRenderer.on('tab:removed', handler);
    return () => ipcRenderer.removeListener('tab:removed', handler);
  },
};

export type ClaudeTerminalApi = typeof api;

contextBridge.exposeInMainWorld('claudeTerminal', api);
```

**Step 2: Verify it compiles**

```bash
npx tsc --noEmit src/preload.ts
```
Expected: No errors.

**Step 3: Commit**

```bash
git add src/preload.ts
git commit -m "feat: add preload script exposing main process API to renderer"
```

---

### Task 11: Renderer — Startup Dialog

**Files:**
- Create: `src/renderer/components/StartupDialog.tsx`
- Create: `src/renderer/styles/startup.css`

**Step 1: Write the component**

Create `src/renderer/components/StartupDialog.tsx`:
```tsx
import React, { useState, useEffect } from 'react';
import { PermissionMode } from '@shared/types';

interface Props {
  onStart: (dir: string, mode: PermissionMode) => void;
}

export function StartupDialog({ onStart }: Props) {
  const [recentDirs, setRecentDirs] = useState<string[]>([]);
  const [selectedDir, setSelectedDir] = useState<string>('');
  const [permissionMode, setPermissionMode] = useState<PermissionMode>('bypassPermissions');

  useEffect(() => {
    window.claudeTerminal.getRecentDirs().then(setRecentDirs);
    window.claudeTerminal.getPermissionMode().then(setPermissionMode);
  }, []);

  const handleBrowse = async () => {
    const dir = await window.claudeTerminal.selectDirectory();
    if (dir) setSelectedDir(dir);
  };

  const handleStart = () => {
    if (selectedDir) onStart(selectedDir, permissionMode);
  };

  const modes: { value: PermissionMode; label: string }[] = [
    { value: 'default', label: 'Default' },
    { value: 'plan', label: 'Plan mode' },
    { value: 'acceptEdits', label: 'Accept edits' },
    { value: 'bypassPermissions', label: 'Bypass permissions' },
  ];

  return (
    <div className="startup-dialog">
      <h1>ClaudeTerminal</h1>

      <section className="dir-section">
        <h2>Select workspace directory</h2>
        {recentDirs.length > 0 && (
          <ul className="recent-dirs">
            {recentDirs.map((dir) => (
              <li
                key={dir}
                className={dir === selectedDir ? 'selected' : ''}
                onClick={() => setSelectedDir(dir)}
              >
                {dir}
              </li>
            ))}
          </ul>
        )}
        <button onClick={handleBrowse}>Browse...</button>
        {selectedDir && <p className="selected-dir">{selectedDir}</p>}
      </section>

      <section className="permission-section">
        <h2>Permission mode</h2>
        {modes.map(({ value, label }) => (
          <label key={value} className="radio-option">
            <input
              type="radio"
              name="permissionMode"
              value={value}
              checked={permissionMode === value}
              onChange={() => setPermissionMode(value)}
            />
            {label}
          </label>
        ))}
      </section>

      <button
        className="start-btn"
        disabled={!selectedDir}
        onClick={handleStart}
      >
        Start
      </button>
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add src/renderer/components/StartupDialog.tsx
git commit -m "feat: add startup dialog for directory and permission mode selection"
```

---

### Task 12: Renderer — Tab Bar

**Files:**
- Create: `src/renderer/components/TabBar.tsx`
- Create: `src/renderer/components/Tab.tsx`

**Step 1: Write the Tab component**

Create `src/renderer/components/Tab.tsx`:
```tsx
import React, { useState, useRef, useEffect } from 'react';
import { Tab as TabType, STATUS_INDICATORS } from '@shared/types';

interface Props {
  tab: TabType;
  isActive: boolean;
  onClick: () => void;
  onClose: () => void;
  onRename: (name: string) => void;
}

export function Tab({ tab, isActive, onClick, onClose, onRename }: Props) {
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(tab.name);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  const handleDoubleClick = () => {
    setEditValue(tab.name);
    setEditing(true);
  };

  const handleSubmit = () => {
    setEditing(false);
    if (editValue.trim() && editValue !== tab.name) {
      onRename(editValue.trim());
    }
  };

  const indicator = STATUS_INDICATORS[tab.status];

  return (
    <div
      className={`tab ${isActive ? 'tab-active' : ''} tab-status-${tab.status}`}
      onClick={onClick}
      onDoubleClick={handleDoubleClick}
    >
      <span className="tab-indicator">{indicator}</span>
      {editing ? (
        <input
          ref={inputRef}
          className="tab-rename-input"
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onBlur={handleSubmit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleSubmit();
            if (e.key === 'Escape') setEditing(false);
          }}
        />
      ) : (
        <span className="tab-name">{tab.name}</span>
      )}
      {tab.worktree && <span className="tab-worktree">{tab.worktree}</span>}
      <button className="tab-close" onClick={(e) => { e.stopPropagation(); onClose(); }}>
        ×
      </button>
    </div>
  );
}
```

**Step 2: Write the TabBar component**

Create `src/renderer/components/TabBar.tsx`:
```tsx
import React from 'react';
import { Tab as TabType } from '@shared/types';
import { Tab } from './Tab';

interface Props {
  tabs: TabType[];
  activeTabId: string | null;
  onSelectTab: (tabId: string) => void;
  onCloseTab: (tabId: string) => void;
  onRenameTab: (tabId: string, name: string) => void;
  onNewTab: () => void;
}

export function TabBar({ tabs, activeTabId, onSelectTab, onCloseTab, onRenameTab, onNewTab }: Props) {
  return (
    <div className="tab-bar">
      {tabs.map((tab) => (
        <Tab
          key={tab.id}
          tab={tab}
          isActive={tab.id === activeTabId}
          onClick={() => onSelectTab(tab.id)}
          onClose={() => onCloseTab(tab.id)}
          onRename={(name) => onRenameTab(tab.id, name)}
        />
      ))}
      <button className="new-tab-btn" onClick={onNewTab} title="New tab (Ctrl+T)">
        +
      </button>
    </div>
  );
}
```

**Step 3: Commit**

```bash
git add src/renderer/components/Tab.tsx src/renderer/components/TabBar.tsx
git commit -m "feat: add TabBar and Tab components with status indicators and rename"
```

---

### Task 13: Renderer — Terminal Component

**Files:**
- Create: `src/renderer/components/Terminal.tsx`

**Step 1: Write the xterm.js wrapper**

Create `src/renderer/components/Terminal.tsx`:
```tsx
import React, { useRef, useEffect } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';
import '@xterm/xterm/css/xterm.css';

interface Props {
  tabId: string;
  isVisible: boolean;
}

// Cache terminals so they persist when switching tabs
const terminalCache = new Map<string, { xterm: XTerm; fitAddon: FitAddon }>();

export function Terminal({ tabId, isVisible }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    let entry = terminalCache.get(tabId);
    if (!entry) {
      const xterm = new XTerm({
        cursorBlink: true,
        fontSize: 14,
        fontFamily: 'Cascadia Code, Consolas, monospace',
        theme: {
          background: '#1e1e1e',
          foreground: '#d4d4d4',
        },
      });
      const fitAddon = new FitAddon();
      xterm.loadAddon(fitAddon);
      entry = { xterm, fitAddon };
      terminalCache.set(tabId, entry);

      xterm.open(containerRef.current);

      try {
        xterm.loadAddon(new WebglAddon());
      } catch {
        // WebGL not available, fall back to canvas renderer
      }

      fitAddon.fit();

      // Forward input to main process
      xterm.onData((data) => {
        window.claudeTerminal.writeToPty(tabId, data);
      });

      // Report size to main process
      xterm.onResize(({ cols, rows }) => {
        window.claudeTerminal.resizePty(tabId, cols, rows);
      });
    } else {
      // Re-attach existing terminal to new container
      containerRef.current.innerHTML = '';
      entry.xterm.open(containerRef.current);
      entry.fitAddon.fit();
    }

    // Listen for PTY data
    const cleanup = window.claudeTerminal.onPtyData((ptTabId, data) => {
      if (ptTabId === tabId) {
        entry!.xterm.write(data);
      }
    });

    // Handle window resize
    const handleResize = () => entry?.fitAddon.fit();
    window.addEventListener('resize', handleResize);

    return () => {
      cleanup();
      window.removeEventListener('resize', handleResize);
    };
  }, [tabId]);

  // Refit when visibility changes
  useEffect(() => {
    if (isVisible) {
      const entry = terminalCache.get(tabId);
      if (entry) {
        setTimeout(() => entry.fitAddon.fit(), 0);
      }
    }
  }, [isVisible, tabId]);

  return (
    <div
      ref={containerRef}
      className="terminal-container"
      style={{ display: isVisible ? 'block' : 'none', width: '100%', height: '100%' }}
    />
  );
}

// Cleanup helper for when a tab is closed
export function destroyTerminal(tabId: string): void {
  const entry = terminalCache.get(tabId);
  if (entry) {
    entry.xterm.dispose();
    terminalCache.delete(tabId);
  }
}
```

**Step 2: Commit**

```bash
git add src/renderer/components/Terminal.tsx
git commit -m "feat: add Terminal component wrapping xterm.js with WebGL"
```

---

### Task 14: Renderer — Status Bar & New Tab Dialog

**Files:**
- Create: `src/renderer/components/StatusBar.tsx`
- Create: `src/renderer/components/NewTabDialog.tsx`

**Step 1: Write StatusBar**

Create `src/renderer/components/StatusBar.tsx`:
```tsx
import React from 'react';
import { Tab, STATUS_INDICATORS } from '@shared/types';

interface Props {
  tab: Tab | null;
  tabCount: number;
}

export function StatusBar({ tab, tabCount }: Props) {
  if (!tab) return <div className="status-bar">No active tab</div>;

  return (
    <div className="status-bar">
      <span className="status-item">
        {STATUS_INDICATORS[tab.status]} {tab.status}
      </span>
      {tab.worktree && (
        <span className="status-item">WT: {tab.worktree}</span>
      )}
      <span className="status-item">{tabCount} tab{tabCount !== 1 ? 's' : ''}</span>
      <span className="status-item status-help">Ctrl+? for help</span>
    </div>
  );
}
```

**Step 2: Write NewTabDialog**

Create `src/renderer/components/NewTabDialog.tsx`:
```tsx
import React, { useState, useEffect } from 'react';

interface Props {
  onCreateWithWorktree: (name: string) => void;
  onCreateWithoutWorktree: () => void;
  onCancel: () => void;
}

export function NewTabDialog({ onCreateWithWorktree, onCreateWithoutWorktree, onCancel }: Props) {
  const [step, setStep] = useState<'ask' | 'name'>('ask');
  const [worktreeName, setWorktreeName] = useState('');
  const [currentBranch, setCurrentBranch] = useState('');

  useEffect(() => {
    window.claudeTerminal.getCurrentBranch().then(setCurrentBranch);
  }, []);

  if (step === 'ask') {
    return (
      <div className="dialog-overlay">
        <div className="dialog">
          <h2>Create worktree?</h2>
          <p>Each worktree gives the Claude instance an isolated copy of the repo.</p>
          <div className="dialog-actions">
            <button onClick={() => setStep('name')}>Yes</button>
            <button onClick={onCreateWithoutWorktree}>No, use main</button>
            <button onClick={onCancel}>Cancel</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="dialog-overlay">
      <div className="dialog">
        <h2>New worktree</h2>
        <label>
          Worktree name:
          <input
            autoFocus
            value={worktreeName}
            onChange={(e) => setWorktreeName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && worktreeName.trim()) {
                onCreateWithWorktree(worktreeName.trim());
              }
              if (e.key === 'Escape') onCancel();
            }}
            placeholder="feature/my-feature"
          />
        </label>
        <p className="branch-info">Base: {currentBranch} (current branch)</p>
        <div className="dialog-actions">
          <button
            disabled={!worktreeName.trim()}
            onClick={() => onCreateWithWorktree(worktreeName.trim())}
          >
            Create
          </button>
          <button onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
```

**Step 3: Commit**

```bash
git add src/renderer/components/StatusBar.tsx src/renderer/components/NewTabDialog.tsx
git commit -m "feat: add StatusBar and NewTabDialog components"
```

---

### Task 15: Renderer — App Shell

**Files:**
- Create: `src/renderer/App.tsx`
- Create: `src/renderer/renderer.ts`
- Create: `src/renderer/global.d.ts`
- Create: `src/renderer/styles/app.css`
- Modify: `src/renderer/index.html`

**Step 1: Create global type declaration for window.claudeTerminal**

Create `src/renderer/global.d.ts`:
```ts
import type { ClaudeTerminalApi } from '../preload';

declare global {
  interface Window {
    claudeTerminal: ClaudeTerminalApi;
  }
}
```

**Step 2: Write the App component**

Create `src/renderer/App.tsx`:
```tsx
import React, { useState, useEffect, useCallback } from 'react';
import { Tab as TabType, PermissionMode } from '@shared/types';
import { StartupDialog } from './components/StartupDialog';
import { TabBar } from './components/TabBar';
import { Terminal, destroyTerminal } from './components/Terminal';
import { StatusBar } from './components/StatusBar';
import { NewTabDialog } from './components/NewTabDialog';

type AppState = 'startup' | 'running';

export function App() {
  const [state, setState] = useState<AppState>('startup');
  const [tabs, setTabs] = useState<TabType[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [showNewTabDialog, setShowNewTabDialog] = useState(false);

  // Listen for tab updates from main process
  useEffect(() => {
    const cleanupUpdate = window.claudeTerminal.onTabUpdate((tab) => {
      setTabs((prev) => prev.map((t) => (t.id === tab.id ? tab : t)));
    });
    const cleanupRemove = window.claudeTerminal.onTabRemoved((tabId) => {
      destroyTerminal(tabId);
      setTabs((prev) => prev.filter((t) => t.id !== tabId));
    });
    return () => { cleanupUpdate(); cleanupRemove(); };
  }, []);

  const handleStart = async (dir: string, mode: PermissionMode) => {
    await window.claudeTerminal.startSession(dir, mode);
    const tab = await window.claudeTerminal.createTab(null);
    setTabs([tab]);
    setActiveTabId(tab.id);
    setState('running');
  };

  const handleNewTab = useCallback(() => setShowNewTabDialog(true), []);

  const handleCreateTab = async (worktree: string | null) => {
    if (worktree) {
      await window.claudeTerminal.createWorktree(worktree);
    }
    const tab = await window.claudeTerminal.createTab(worktree);
    setTabs((prev) => [...prev, tab]);
    setActiveTabId(tab.id);
    setShowNewTabDialog(false);
  };

  const handleCloseTab = async (tabId: string) => {
    await window.claudeTerminal.closeTab(tabId);
    destroyTerminal(tabId);
    setTabs((prev) => {
      const next = prev.filter((t) => t.id !== tabId);
      if (activeTabId === tabId && next.length > 0) {
        setActiveTabId(next[0].id);
      }
      return next;
    });
  };

  const handleRenameTab = async (tabId: string, name: string) => {
    await window.claudeTerminal.renameTab(tabId, name);
    setTabs((prev) => prev.map((t) => (t.id === tabId ? { ...t, name } : t)));
  };

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === 't') { e.preventDefault(); handleNewTab(); }
      if (e.ctrlKey && e.key === 'w') { e.preventDefault(); if (activeTabId) handleCloseTab(activeTabId); }
      if (e.ctrlKey && e.key === 'Tab') {
        e.preventDefault();
        const idx = tabs.findIndex((t) => t.id === activeTabId);
        const next = e.shiftKey
          ? (idx - 1 + tabs.length) % tabs.length
          : (idx + 1) % tabs.length;
        setActiveTabId(tabs[next]?.id ?? null);
      }
      if (e.ctrlKey && e.key >= '1' && e.key <= '9') {
        e.preventDefault();
        const idx = parseInt(e.key) - 1;
        if (tabs[idx]) setActiveTabId(tabs[idx].id);
      }
      if (e.key === 'F2' && activeTabId) {
        e.preventDefault();
        // F2 triggers inline rename — handled by Tab component's double-click
        // Dispatch a custom event the Tab component listens for
        document.dispatchEvent(new CustomEvent('tab:startRename', { detail: activeTabId }));
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [tabs, activeTabId, handleNewTab]);

  if (state === 'startup') {
    return <StartupDialog onStart={handleStart} />;
  }

  const activeTab = tabs.find((t) => t.id === activeTabId) ?? null;

  return (
    <div className="app">
      <TabBar
        tabs={tabs}
        activeTabId={activeTabId}
        onSelectTab={setActiveTabId}
        onCloseTab={handleCloseTab}
        onRenameTab={handleRenameTab}
        onNewTab={handleNewTab}
      />
      <div className="terminal-area">
        {tabs.map((tab) => (
          <Terminal key={tab.id} tabId={tab.id} isVisible={tab.id === activeTabId} />
        ))}
      </div>
      <StatusBar tab={activeTab} tabCount={tabs.length} />
      {showNewTabDialog && (
        <NewTabDialog
          onCreateWithWorktree={(name) => handleCreateTab(name)}
          onCreateWithoutWorktree={() => handleCreateTab(null)}
          onCancel={() => setShowNewTabDialog(false)}
        />
      )}
    </div>
  );
}
```

**Step 3: Write renderer entry point**

Create `src/renderer/renderer.ts`:
```ts
import { createRoot } from 'react-dom/client';
import React from 'react';
import { App } from './App';
import './styles/app.css';

const root = createRoot(document.getElementById('app')!);
root.render(React.createElement(App));
```

**Step 4: Write base CSS**

Create `src/renderer/styles/app.css`:
```css
* { margin: 0; padding: 0; box-sizing: border-box; }

body {
  font-family: 'Segoe UI', sans-serif;
  background: #1e1e1e;
  color: #d4d4d4;
  height: 100vh;
  overflow: hidden;
}

.app {
  display: flex;
  flex-direction: column;
  height: 100vh;
}

/* Tab Bar */
.tab-bar {
  display: flex;
  background: #252526;
  border-bottom: 1px solid #3c3c3c;
  min-height: 36px;
  align-items: center;
  padding: 0 4px;
  -webkit-app-region: drag;
}

.tab {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  cursor: pointer;
  border-right: 1px solid #3c3c3c;
  font-size: 13px;
  -webkit-app-region: no-drag;
  user-select: none;
}

.tab:hover { background: #2a2d2e; }
.tab-active { background: #1e1e1e; border-bottom: 2px solid #007acc; }

.tab-indicator { font-size: 10px; }
.tab-status-working .tab-indicator { color: #dcdcaa; }
.tab-status-requires_response .tab-indicator { color: #ce9178; }
.tab-status-idle .tab-indicator { color: #6a9955; }
.tab-status-new .tab-indicator { color: #569cd6; }

.tab-worktree {
  font-size: 11px;
  color: #808080;
  margin-left: 4px;
}

.tab-close {
  background: none;
  border: none;
  color: #808080;
  cursor: pointer;
  font-size: 16px;
  padding: 0 2px;
  -webkit-app-region: no-drag;
}
.tab-close:hover { color: #fff; }

.tab-rename-input {
  background: #3c3c3c;
  border: 1px solid #007acc;
  color: #d4d4d4;
  font-size: 13px;
  padding: 1px 4px;
  width: 120px;
  outline: none;
}

.new-tab-btn {
  background: none;
  border: none;
  color: #808080;
  font-size: 20px;
  cursor: pointer;
  padding: 4px 12px;
  -webkit-app-region: no-drag;
}
.new-tab-btn:hover { color: #fff; }

/* Terminal Area */
.terminal-area {
  flex: 1;
  position: relative;
  overflow: hidden;
}

.terminal-container {
  position: absolute;
  top: 0; left: 0; right: 0; bottom: 0;
}

/* Status Bar */
.status-bar {
  display: flex;
  gap: 16px;
  padding: 2px 12px;
  background: #007acc;
  color: #fff;
  font-size: 12px;
  min-height: 22px;
  align-items: center;
}

.status-help { margin-left: auto; }

/* Dialogs */
.dialog-overlay {
  position: fixed;
  top: 0; left: 0; right: 0; bottom: 0;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}

.dialog {
  background: #252526;
  border: 1px solid #3c3c3c;
  border-radius: 8px;
  padding: 24px;
  min-width: 400px;
  max-width: 500px;
}

.dialog h1, .dialog h2 { color: #fff; margin-bottom: 16px; }

.dialog input {
  width: 100%;
  padding: 8px;
  margin-top: 8px;
  background: #3c3c3c;
  border: 1px solid #555;
  color: #d4d4d4;
  font-size: 14px;
  border-radius: 4px;
}
.dialog input:focus { border-color: #007acc; outline: none; }

.dialog-actions {
  display: flex;
  gap: 8px;
  margin-top: 20px;
  justify-content: flex-end;
}

.dialog button, .start-btn {
  padding: 8px 16px;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 14px;
  background: #007acc;
  color: #fff;
}
.dialog button:hover, .start-btn:hover { background: #1a8ad4; }
.dialog button:disabled, .start-btn:disabled { opacity: 0.5; cursor: default; }

/* Startup Dialog */
.startup-dialog {
  max-width: 500px;
  margin: 100px auto;
  padding: 32px;
}

.recent-dirs {
  list-style: none;
  margin: 12px 0;
}
.recent-dirs li {
  padding: 8px 12px;
  cursor: pointer;
  border-radius: 4px;
  font-family: 'Cascadia Code', monospace;
  font-size: 13px;
}
.recent-dirs li:hover { background: #2a2d2e; }
.recent-dirs li.selected { background: #007acc; color: #fff; }

.radio-option {
  display: block;
  padding: 4px 0;
  cursor: pointer;
}
.radio-option input { margin-right: 8px; }

.branch-info {
  font-size: 12px;
  color: #808080;
  margin-top: 8px;
}

.selected-dir {
  margin-top: 8px;
  font-family: 'Cascadia Code', monospace;
  color: #4ec9b0;
}

.dir-section, .permission-section {
  margin-bottom: 24px;
}
```

**Step 5: Update index.html**

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <title>ClaudeTerminal</title>
</head>
<body>
  <div id="app"></div>
  <script type="module" src="./renderer.ts"></script>
</body>
</html>
```

**Step 6: Commit**

```bash
git add src/renderer/
git commit -m "feat: add App shell, renderer entry point, and styles"
```

---

### Task 16: Main Process — Wire Everything Together

**Files:**
- Modify: `src/main/index.ts`

**Step 1: Write the main process**

```ts
// src/main/index.ts
import { app, BrowserWindow, ipcMain, dialog, Notification } from 'electron';
import path from 'path';
import { TabManager } from './tab-manager';
import { PtyManager } from './pty-manager';
import { WorktreeManager } from './worktree-manager';
import { HookIpcServer } from './ipc-server';
import { HookInstaller } from './hook-installer';
import { SettingsStore } from './settings-store';
import { PIPE_NAME, PERMISSION_FLAGS, PermissionMode, IpcMessage } from '@shared/types';

let mainWindow: BrowserWindow | null = null;
let workspaceDir: string = '';
let permissionMode: PermissionMode = 'bypassPermissions';

const tabManager = new TabManager();
const ptyManager = new PtyManager();
const settings = new SettingsStore();
const ipcServer = new HookIpcServer(PIPE_NAME);
let worktreeManager: WorktreeManager;
let hookInstaller: HookInstaller;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    title: 'ClaudeTerminal',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    );
  }
}

// Handle hook IPC messages
function handleHookMessage(msg: IpcMessage) {
  const tab = tabManager.getTab(msg.tabId);
  if (!tab) return;

  switch (msg.event) {
    case 'tab:ready':
      tabManager.updateStatus(msg.tabId, 'new');
      break;
    case 'tab:status:working':
      tabManager.updateStatus(msg.tabId, 'working');
      break;
    case 'tab:status:idle':
      tabManager.updateStatus(msg.tabId, 'idle');
      // Notify if not active tab
      if (msg.tabId !== tabManager.getActiveTabId()) {
        new Notification({ title: 'ClaudeTerminal', body: `Tab "${tab.name}" is idle` }).show();
      }
      break;
    case 'tab:status:input':
      tabManager.updateStatus(msg.tabId, 'requires_response');
      if (msg.tabId !== tabManager.getActiveTabId()) {
        new Notification({ title: 'ClaudeTerminal', body: `Tab "${tab.name}" needs your input` }).show();
      }
      break;
    case 'tab:closed':
      tabManager.removeTab(msg.tabId);
      mainWindow?.webContents.send('tab:removed', msg.tabId);
      return; // skip the update below
    default:
      if (msg.event.startsWith('tab:name:') || msg.event === 'tab:name') {
        const name = msg.data ?? msg.event.replace('tab:name:', '');
        if (name) tabManager.rename(msg.tabId, name);
      }
      break;
  }

  const updated = tabManager.getTab(msg.tabId);
  if (updated) mainWindow?.webContents.send('tab:updated', updated);
}

// IPC handlers
function setupIpcHandlers() {
  ipcMain.handle('session:start', async (_, dir: string, mode: PermissionMode) => {
    workspaceDir = dir;
    permissionMode = mode;
    settings.addRecentDir(dir);
    settings.setPermissionMode(mode);
    worktreeManager = new WorktreeManager(dir);
    hookInstaller = new HookInstaller(path.join(app.getAppPath(), 'src', 'hooks'));
  });

  ipcMain.handle('tab:create', async (_, worktree: string | null) => {
    const cwd = worktree
      ? path.join(workspaceDir, '.claude', 'worktrees', worktree)
      : workspaceDir;
    const tab = tabManager.createTab(cwd, worktree);

    // Install hooks
    hookInstaller.install(cwd, tab.id);

    // Spawn Claude
    const args = PERMISSION_FLAGS[permissionMode] ?? [];
    const proc = ptyManager.spawn(tab.id, cwd, args, {
      CLAUDE_TERMINAL_TAB_ID: tab.id,
    });

    tab.pid = proc.pid;

    // Forward PTY data to renderer
    proc.onData((data) => {
      mainWindow?.webContents.send('pty:data', tab.id, data);
    });

    proc.onExit(() => {
      tabManager.updateStatus(tab.id, 'idle');
      const updated = tabManager.getTab(tab.id);
      if (updated) mainWindow?.webContents.send('tab:updated', updated);
    });

    tabManager.setActiveTab(tab.id);
    return tab;
  });

  ipcMain.handle('tab:close', async (_, tabId: string) => {
    ptyManager.kill(tabId);
    const tab = tabManager.getTab(tabId);
    if (tab?.worktree) {
      try { worktreeManager.remove(tab.worktree); } catch {}
    }
    tabManager.removeTab(tabId);
  });

  ipcMain.handle('tab:switch', async (_, tabId: string) => {
    tabManager.setActiveTab(tabId);
  });

  ipcMain.handle('tab:rename', async (_, tabId: string, name: string) => {
    tabManager.rename(tabId, name);
  });

  ipcMain.handle('tab:getAll', async () => tabManager.getAllTabs());
  ipcMain.handle('tab:getActiveId', async () => tabManager.getActiveTabId());

  ipcMain.on('pty:write', (_, tabId: string, data: string) => {
    ptyManager.write(tabId, data);
  });

  ipcMain.on('pty:resize', (_, tabId: string, cols: number, rows: number) => {
    ptyManager.resize(tabId, cols, rows);
  });

  ipcMain.handle('worktree:create', async (_, name: string) => {
    return worktreeManager.create(name);
  });

  ipcMain.handle('worktree:currentBranch', async () => {
    return worktreeManager.getCurrentBranch();
  });

  ipcMain.handle('settings:recentDirs', async () => settings.getRecentDirs());
  ipcMain.handle('settings:permissionMode', async () => settings.getPermissionMode());

  ipcMain.handle('dialog:selectDirectory', async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      properties: ['openDirectory'],
    });
    return result.canceled ? null : result.filePaths[0];
  });
}

// App lifecycle
app.whenReady().then(async () => {
  await ipcServer.start();
  ipcServer.onMessage(handleHookMessage);
  setupIpcHandlers();
  createWindow();
});

app.on('window-all-closed', () => {
  ptyManager.killAll();
  ipcServer.stop();
  app.quit();
});

// Electron Forge Vite globals
declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
declare const MAIN_WINDOW_VITE_NAME: string;
```

**Step 2: Verify it compiles**

```bash
npx tsc --noEmit
```
Expected: No type errors.

**Step 3: Run the app**

```bash
npm start
```
Expected: Window opens, startup dialog shows.

**Step 4: Commit**

```bash
git add src/main/index.ts
git commit -m "feat: wire up main process with IPC handlers, PTY, and hooks"
```

---

### Task 17: Notifications (click-to-switch)

**Files:**
- Modify: `src/main/index.ts`

**Step 1: Update notification handlers to focus window and switch tab on click**

In the `handleHookMessage` function, update the notification creation:

```ts
// Replace simple Notification calls with click handlers
const notif = new Notification({ title: 'ClaudeTerminal', body: `Tab "${tab.name}" needs your input` });
notif.on('click', () => {
  mainWindow?.show();
  mainWindow?.focus();
  tabManager.setActiveTab(msg.tabId);
  mainWindow?.webContents.send('tab:updated', tabManager.getTab(msg.tabId));
});
notif.show();
```

**Step 2: Commit**

```bash
git add src/main/index.ts
git commit -m "feat: add click-to-switch on OS toast notifications"
```

---

### Task 18: CLI Argument Support

**Files:**
- Modify: `src/main/index.ts`

**Step 1: Parse CLI arguments**

Add to the top of `src/main/index.ts`, after imports:

```ts
// Parse CLI arg for starting directory
const cliDir = process.argv.find((arg, i) => i > 0 && !arg.startsWith('-') && !arg.includes('electron'));
```

**Step 2: Pass to renderer**

Add an IPC handler:
```ts
ipcMain.handle('cli:getStartDir', async () => cliDir ?? null);
```

**Step 3: Update StartupDialog to auto-select CLI dir**

In `StartupDialog.tsx`, add:
```tsx
useEffect(() => {
  window.claudeTerminal.getCliStartDir?.().then((dir) => {
    if (dir) setSelectedDir(dir);
  });
}, []);
```

**Step 4: Add to preload**

```ts
getCliStartDir: () => ipcRenderer.invoke('cli:getStartDir'),
```

**Step 5: Commit**

```bash
git add src/main/index.ts src/preload.ts src/renderer/components/StartupDialog.tsx
git commit -m "feat: support CLI argument for starting directory"
```

---

### Task 19: Integration Testing & Polish

**Files:**
- Create: `tests/integration/app.test.ts`

**Step 1: Write a smoke test**

Create `tests/integration/app.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { TabManager } from '@main/tab-manager';
import { TabStatus } from '@shared/types';

describe('integration: tab lifecycle', () => {
  it('full tab lifecycle: create, update status, rename, close', () => {
    const manager = new TabManager();

    // Create
    const tab = manager.createTab('D:\\dev\\Test', null);
    expect(tab.status).toBe('new');

    // Status updates
    manager.updateStatus(tab.id, 'working');
    expect(manager.getTab(tab.id)!.status).toBe('working');

    manager.updateStatus(tab.id, 'requires_response');
    expect(manager.getTab(tab.id)!.status).toBe('requires_response');

    // Rename
    manager.rename(tab.id, 'auth refactor');
    expect(manager.getTab(tab.id)!.name).toBe('auth refactor');

    // Close
    manager.removeTab(tab.id);
    expect(manager.getTab(tab.id)).toBeUndefined();
    expect(manager.getAllTabs()).toHaveLength(0);
  });

  it('active tab switches when current tab is closed', () => {
    const manager = new TabManager();
    const tab1 = manager.createTab('D:\\dev\\A', null);
    const tab2 = manager.createTab('D:\\dev\\B', 'feature/b');

    manager.setActiveTab(tab2.id);
    expect(manager.getActiveTabId()).toBe(tab2.id);

    manager.removeTab(tab2.id);
    expect(manager.getActiveTabId()).toBe(tab1.id);
  });
});
```

**Step 2: Run all tests**

```bash
npx vitest run
```
Expected: All tests PASS.

**Step 3: Commit**

```bash
git add tests/
git commit -m "test: add integration tests for tab lifecycle"
```

---

### Task 20: Final Verification

**Step 1: Build the app**

```bash
npm run make
```
Expected: Electron app builds without errors.

**Step 2: Manual smoke test**

1. Launch the built app
2. Select a git repository directory
3. Verify Claude spawns in the first tab
4. Open a new tab with a worktree
5. Verify status indicators update as Claude works
6. Switch between tabs
7. Rename a tab with F2
8. Close a tab
9. Verify toast notifications fire for background tabs

**Step 3: Final commit**

```bash
git add -A
git commit -m "chore: final polish and verification"
```
