# Multi-Project Workspaces Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Support multiple project directories per window with a collapsible sidebar, workspace persistence, and project-scoped color tinting.

**Architecture:** Introduce `ProjectManager` holding `Map<projectId, ProjectContext>`, each owning its own `WorktreeManager`, `HookConfigStore`, `HookEngine`. Workspaces (named collections of projects) persist in `%APPDATA%/claude-terminal/workspaces/`. The `Tab` type gains a `projectId` field. The current `AppState` singletons (`workspaceDir`, `worktreeManager`, etc.) are removed entirely in favor of `ProjectManager`.

**Tech Stack:** Electron, React, TypeScript, Vitest, xterm.js, node-pty

**Design doc:** `docs/plans/2026-03-02-multi-project-workspaces-design.md`

---

### Task 1: Fix HookInstaller to Read-Merge-Write (Prerequisite)

**Files:**
- Modify: `src/main/hook-installer.ts`
- Modify: `tests/main/hook-installer.test.ts`

This is a prerequisite fix. Currently `HookInstaller.install()` overwrites `settings.local.json` entirely, destroying any existing content. It needs to read-merge-write and support uninstall.

**Step 1: Write failing tests for merge behavior**

Add tests to `tests/main/hook-installer.test.ts`:

```typescript
describe('install with existing settings.local.json', () => {
  it('preserves non-ClaudeTerminal hooks in existing settings.local.json', () => {
    const existingSettings = {
      hooks: {
        SessionStart: [
          { matcher: '', hooks: [{ type: 'command', command: 'echo user-hook', timeout: 5 }] },
        ],
      },
      someOtherSetting: true,
    };
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(existingSettings));

    installer.install('/target');

    const written = JSON.parse(vi.mocked(fs.writeFileSync).mock.calls[0][1] as string);
    // Should have both user hook and ClaudeTerminal hook for SessionStart
    expect(written.hooks.SessionStart).toHaveLength(2);
    expect(written.hooks.SessionStart[0].hooks[0].command).toBe('echo user-hook');
    expect(written.someOtherSetting).toBe(true);
  });

  it('replaces existing ClaudeTerminal hooks on re-install', () => {
    const existingSettings = {
      hooks: {
        SessionStart: [
          { matcher: '', hooks: [{ type: 'command', command: `node "${hooksDir}/on-session-start.js"`, timeout: 10 }] },
        ],
      },
    };
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(existingSettings));

    installer.install('/target');

    const written = JSON.parse(vi.mocked(fs.writeFileSync).mock.calls[0][1] as string);
    // Should have exactly one ClaudeTerminal hook, not two
    expect(written.hooks.SessionStart).toHaveLength(1);
  });
});

describe('uninstall', () => {
  it('removes only ClaudeTerminal hooks and preserves user hooks', () => {
    const existingSettings = {
      hooks: {
        SessionStart: [
          { matcher: '', hooks: [{ type: 'command', command: 'echo user-hook', timeout: 5 }] },
          { matcher: '', hooks: [{ type: 'command', command: `node "${hooksDir}/on-session-start.js"`, timeout: 10 }] },
        ],
      },
      someOtherSetting: true,
    };
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(existingSettings));

    installer.uninstall('/target');

    const written = JSON.parse(vi.mocked(fs.writeFileSync).mock.calls[0][1] as string);
    expect(written.hooks.SessionStart).toHaveLength(1);
    expect(written.hooks.SessionStart[0].hooks[0].command).toBe('echo user-hook');
    expect(written.someOtherSetting).toBe(true);
  });

  it('deletes settings.local.json if only ClaudeTerminal hooks remain', () => {
    const existingSettings = {
      hooks: {
        SessionStart: [
          { matcher: '', hooks: [{ type: 'command', command: `node "${hooksDir}/on-session-start.js"`, timeout: 10 }] },
        ],
      },
    };
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(existingSettings));

    installer.uninstall('/target');

    expect(vi.mocked(fs.unlinkSync)).toHaveBeenCalled();
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `pnpm vitest run tests/main/hook-installer.test.ts`
Expected: FAIL — `uninstall` method doesn't exist, merge behavior not implemented

**Step 3: Implement read-merge-write in HookInstaller**

Modify `src/main/hook-installer.ts`:

```typescript
import fs from 'node:fs';
import path from 'node:path';

export class HookInstaller {
  private hooksDir: string;

  constructor(hooksDir: string) {
    this.hooksDir = hooksDir;
  }

  /** Check if a hook entry was installed by ClaudeTerminal */
  private isOurHook(entry: any): boolean {
    return entry?.hooks?.some((h: any) =>
      typeof h.command === 'string' && h.command.includes(this.hooksDir)
    ) ?? false;
  }

  /** Read existing settings.local.json or return empty object */
  private readExisting(targetDir: string): any {
    const filePath = path.join(targetDir, '.claude', 'settings.local.json');
    if (fs.existsSync(filePath)) {
      try {
        return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      } catch {
        return {};
      }
    }
    return {};
  }

  install(targetDir: string): void {
    const claudeDir = path.join(targetDir, '.claude');
    fs.mkdirSync(claudeDir, { recursive: true });

    const hookCommand = (scriptName: string) =>
      `node "${path.join(this.hooksDir, scriptName)}"`;

    const ourHooks: Record<string, any[]> = {
      SessionStart: [
        { matcher: '', hooks: [{ type: 'command', command: hookCommand('on-session-start.js'), timeout: 10 }] },
      ],
      UserPromptSubmit: [
        { matcher: '', hooks: [{ type: 'command', command: hookCommand('on-prompt-submit.js'), timeout: 10 }] },
      ],
      PreToolUse: [
        { matcher: '', hooks: [{ type: 'command', command: hookCommand('on-tool-use.js'), timeout: 10 }] },
      ],
      Stop: [
        { matcher: '', hooks: [{ type: 'command', command: hookCommand('on-stop.js'), timeout: 10 }] },
      ],
      Notification: [
        { matcher: '', hooks: [{ type: 'command', command: hookCommand('on-notification.js'), timeout: 10 }] },
      ],
      SessionEnd: [
        { matcher: '', hooks: [{ type: 'command', command: hookCommand('on-session-end.js'), timeout: 10 }] },
      ],
    };

    // Read existing, remove our old hooks, merge in new ones
    const existing = this.readExisting(targetDir);
    const mergedHooks: Record<string, any[]> = { ...(existing.hooks ?? {}) };

    for (const [event, entries] of Object.entries(ourHooks)) {
      // Remove any existing ClaudeTerminal hooks for this event
      const existingEntries = mergedHooks[event] ?? [];
      const userEntries = existingEntries.filter((e: any) => !this.isOurHook(e));
      mergedHooks[event] = [...userEntries, ...entries];
    }

    const settings = { ...existing, hooks: mergedHooks };

    fs.writeFileSync(
      path.join(claudeDir, 'settings.local.json'),
      JSON.stringify(settings, null, 2),
      'utf-8',
    );
  }

  uninstall(targetDir: string): void {
    const filePath = path.join(targetDir, '.claude', 'settings.local.json');
    if (!fs.existsSync(filePath)) return;

    const existing = this.readExisting(targetDir);
    const hooks: Record<string, any[]> = existing.hooks ?? {};

    // Remove our hooks from each event
    for (const event of Object.keys(hooks)) {
      hooks[event] = hooks[event].filter((e: any) => !this.isOurHook(e));
      if (hooks[event].length === 0) {
        delete hooks[event];
      }
    }

    // If nothing left besides empty hooks, delete the file
    const remaining = { ...existing, hooks };
    if (Object.keys(remaining.hooks).length === 0) {
      delete remaining.hooks;
    }
    if (Object.keys(remaining).length === 0) {
      fs.unlinkSync(filePath);
    } else {
      fs.writeFileSync(filePath, JSON.stringify(remaining, null, 2), 'utf-8');
    }
  }
}
```

**Step 4: Run tests to verify they pass**

Run: `pnpm vitest run tests/main/hook-installer.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/main/hook-installer.ts tests/main/hook-installer.test.ts
git commit -m "fix: hook installer read-merge-write instead of overwriting settings.local.json"
```

---

### Task 2: Add Project and Workspace Types

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `tests/shared/types.test.ts`

**Step 1: Write failing test for new types**

Add to `tests/shared/types.test.ts`:

```typescript
describe('Project types', () => {
  it('Tab has projectId field', () => {
    const tab: Tab = {
      id: 'tab-1', type: 'claude', name: 'Test', defaultName: 'New Tab',
      status: 'new', worktree: null, cwd: '/test', pid: null, sessionId: null,
      projectId: 'proj-1',
    };
    expect(tab.projectId).toBe('proj-1');
  });

  it('PROJECT_COLORS has at least 8 colors', () => {
    expect(PROJECT_COLORS.length).toBeGreaterThanOrEqual(8);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/shared/types.test.ts`
Expected: FAIL — `projectId` doesn't exist on `Tab`, `PROJECT_COLORS` not exported

**Step 3: Add types to shared/types.ts**

Add `projectId` to `Tab` interface, add `PROJECT_COLORS` array, add `WorkspaceConfig` and `ProjectConfig` interfaces:

```typescript
// Add to Tab interface:
export interface Tab {
  // ...existing fields...
  projectId: string;
}

// Add to SavedTab:
export interface SavedTab {
  // ...existing fields... (no projectId — it's inferred from which project dir the file is in)
}

// New types:
export const PROJECT_COLORS = [
  { name: 'blue',   hue: 210 },
  { name: 'green',  hue: 140 },
  { name: 'orange', hue: 30  },
  { name: 'purple', hue: 270 },
  { name: 'teal',   hue: 180 },
  { name: 'red',    hue: 0   },
  { name: 'pink',   hue: 330 },
  { name: 'yellow', hue: 55  },
] as const;

export interface ProjectConfig {
  id: string;
  dir: string;
  colorIndex: number;
}

export interface WorkspaceConfig {
  id: string;
  name: string;
  projects: ProjectConfig[];
  activeProjectId: string;
  geometry: { x: number; y: number; width: number; height: number };
}
```

**Step 4: Fix all compilation errors from adding `projectId` to Tab**

Every place that constructs a `Tab` object now needs `projectId`. This includes:
- `src/main/tab-manager.ts:22` — `createTab()` needs a `projectId` parameter
- `tests/main/tab-manager.test.ts` — update all `createTab` calls
- `tests/main/ipc-handlers.test.ts` — update mock tab objects
- `tests/main/hook-router.test.ts` — update mock tab objects
- `tests/main/tab-namer.test.ts` — update mock tab objects
- `tests/main/web-remote-server.test.ts` — update mock tab objects
- `tests/integration/app.test.ts` — update all test tabs

**Step 5: Run all tests**

Run: `pnpm test`
Expected: PASS

**Step 6: Commit**

```bash
git add src/shared/types.ts tests/shared/types.test.ts src/main/tab-manager.ts tests/
git commit -m "feat: add projectId to Tab and workspace/project config types"
```

---

### Task 3: Update TabManager for Project Awareness

**Files:**
- Modify: `src/main/tab-manager.ts`
- Modify: `tests/main/tab-manager.test.ts`

**Step 1: Write failing tests**

Add tests to `tests/main/tab-manager.test.ts`:

```typescript
describe('project-scoped operations', () => {
  it('createTab assigns projectId', () => {
    const tab = manager.createTab('/test', null, 'claude', undefined, 'proj-1');
    expect(tab.projectId).toBe('proj-1');
  });

  it('getTabsByProject returns only tabs for that project', () => {
    manager.createTab('/a', null, 'claude', undefined, 'proj-1');
    manager.createTab('/b', null, 'claude', undefined, 'proj-2');
    manager.createTab('/c', null, 'claude', undefined, 'proj-1');

    const proj1Tabs = manager.getTabsByProject('proj-1');
    expect(proj1Tabs).toHaveLength(2);
    expect(proj1Tabs.every(t => t.projectId === 'proj-1')).toBe(true);
  });

  it('removeTabsByProject removes all tabs for a project', () => {
    manager.createTab('/a', null, 'claude', undefined, 'proj-1');
    manager.createTab('/b', null, 'claude', undefined, 'proj-2');
    manager.createTab('/c', null, 'claude', undefined, 'proj-1');

    const removed = manager.removeTabsByProject('proj-1');
    expect(removed).toHaveLength(2);
    expect(manager.getAllTabs()).toHaveLength(1);
    expect(manager.getAllTabs()[0].projectId).toBe('proj-2');
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `pnpm vitest run tests/main/tab-manager.test.ts`
Expected: FAIL

**Step 3: Implement changes in TabManager**

Modify `src/main/tab-manager.ts`:
- Add `projectId` parameter to `createTab(cwd, worktree, type, savedName, projectId)`
- Add `getTabsByProject(projectId: string): Tab[]`
- Add `removeTabsByProject(projectId: string): Tab[]` — returns removed tabs

```typescript
createTab(cwd: string, worktree: string | null, type: TabType = 'claude', savedName?: string, projectId?: string): Tab {
  const id = generateId();
  // ... existing defaultName logic ...
  const tab: Tab = { id, type, name, defaultName, status, worktree, cwd, pid: null, sessionId: null, projectId: projectId ?? '' };
  this.tabs.set(id, tab);
  if (!this.activeTabId) this.activeTabId = id;
  return tab;
}

getTabsByProject(projectId: string): Tab[] {
  return this.getAllTabs().filter(t => t.projectId === projectId);
}

removeTabsByProject(projectId: string): Tab[] {
  const removed: Tab[] = [];
  for (const [id, tab] of this.tabs) {
    if (tab.projectId === projectId) {
      removed.push(tab);
      this.tabs.delete(id);
    }
  }
  if (this.activeTabId && !this.tabs.has(this.activeTabId)) {
    const remaining = this.getAllTabs();
    this.activeTabId = remaining.length > 0 ? remaining[0].id : null;
  }
  return removed;
}
```

**Step 4: Update all existing createTab callers to pass projectId**

- `src/main/ipc-handlers.ts` — all `tabManager.createTab(...)` calls need projectId
- For now, use a placeholder `''` since the full IPC refactor comes later

**Step 5: Run all tests**

Run: `pnpm test`
Expected: PASS

**Step 6: Commit**

```bash
git add src/main/tab-manager.ts tests/main/tab-manager.test.ts src/main/ipc-handlers.ts
git commit -m "feat: add project-scoped operations to TabManager"
```

---

### Task 4: Create WorkspaceStore

**Files:**
- Create: `src/main/workspace-store.ts`
- Create: `tests/main/workspace-store.test.ts`

**Step 1: Write failing tests**

Create `tests/main/workspace-store.test.ts`:

```typescript
// @vitest-environment node
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => os.tmpdir()) },
}));

vi.mock('@main/logger', () => ({
  log: { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

import { WorkspaceStore } from '../../src/main/workspace-store';
import type { WorkspaceConfig } from '@shared/types';

describe('WorkspaceStore', () => {
  let tmpDir: string;
  let store: WorkspaceStore;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-test-'));
    store = new WorkspaceStore(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('listWorkspaces returns empty array when no workspaces exist', async () => {
    const list = await store.listWorkspaces();
    expect(list).toEqual([]);
  });

  it('saveWorkspace creates a workspace file', async () => {
    const ws: WorkspaceConfig = {
      id: 'ws-1', name: 'Test', projects: [], activeProjectId: '',
      geometry: { x: 0, y: 0, width: 1200, height: 800 },
    };
    await store.saveWorkspace(ws);
    const list = await store.listWorkspaces();
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe('Test');
  });

  it('getWorkspace retrieves a saved workspace', async () => {
    const ws: WorkspaceConfig = {
      id: 'ws-1', name: 'My Workspace', projects: [
        { id: 'p1', dir: '/test/repo', colorIndex: 0 },
      ], activeProjectId: 'p1',
      geometry: { x: 100, y: 100, width: 1400, height: 900 },
    };
    await store.saveWorkspace(ws);
    const loaded = await store.getWorkspace('ws-1');
    expect(loaded).toEqual(ws);
  });

  it('deleteWorkspace removes the workspace file', async () => {
    const ws: WorkspaceConfig = {
      id: 'ws-1', name: 'Temp', projects: [], activeProjectId: '',
      geometry: { x: 0, y: 0, width: 1200, height: 800 },
    };
    await store.saveWorkspace(ws);
    await store.deleteWorkspace('ws-1');
    const list = await store.listWorkspaces();
    expect(list).toEqual([]);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `pnpm vitest run tests/main/workspace-store.test.ts`
Expected: FAIL — module doesn't exist

**Step 3: Implement WorkspaceStore**

Create `src/main/workspace-store.ts`:

```typescript
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { app } from 'electron';
import type { WorkspaceConfig } from '@shared/types';
import { log } from './logger';

export class WorkspaceStore {
  private dir: string;

  constructor(baseDir?: string) {
    this.dir = baseDir
      ? path.join(baseDir, 'workspaces')
      : path.join(app.getPath('userData'), 'workspaces');
  }

  private ensureDir(): void {
    fs.mkdirSync(this.dir, { recursive: true });
  }

  private filePath(id: string): string {
    return path.join(this.dir, `${id}.json`);
  }

  async listWorkspaces(): Promise<WorkspaceConfig[]> {
    this.ensureDir();
    try {
      const files = await fsp.readdir(this.dir);
      const workspaces: WorkspaceConfig[] = [];
      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        try {
          const raw = await fsp.readFile(path.join(this.dir, file), 'utf-8');
          workspaces.push(JSON.parse(raw));
        } catch (err) {
          log.warn('[workspace-store] failed to read', file, String(err));
        }
      }
      return workspaces;
    } catch {
      return [];
    }
  }

  async getWorkspace(id: string): Promise<WorkspaceConfig | null> {
    try {
      const raw = await fsp.readFile(this.filePath(id), 'utf-8');
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  async saveWorkspace(ws: WorkspaceConfig): Promise<void> {
    this.ensureDir();
    await fsp.writeFile(this.filePath(ws.id), JSON.stringify(ws, null, 2), 'utf-8');
    log.debug('[workspace-store] saved workspace', ws.id, ws.name);
  }

  async deleteWorkspace(id: string): Promise<void> {
    try {
      await fsp.unlink(this.filePath(id));
      log.debug('[workspace-store] deleted workspace', id);
    } catch {
      // File may not exist
    }
  }
}
```

**Step 4: Run tests**

Run: `pnpm vitest run tests/main/workspace-store.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/main/workspace-store.ts tests/main/workspace-store.test.ts
git commit -m "feat: add WorkspaceStore for workspace persistence in AppData"
```

---

### Task 5: Create ProjectManager

**Files:**
- Create: `src/main/project-manager.ts`
- Create: `tests/main/project-manager.test.ts`

**Step 1: Write failing tests**

Create `tests/main/project-manager.test.ts`:

```typescript
// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: vi.fn(() => '/tmp') },
}));
vi.mock('@main/logger', () => ({
  log: { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));
vi.mock('@main/worktree-manager', () => ({
  WorktreeManager: vi.fn(function(dir: string) {
    return { dir, getCurrentBranch: vi.fn(async () => 'main') };
  }),
}));
vi.mock('@main/hook-config-store', () => ({
  HookConfigStore: vi.fn(function(dir: string) { return { dir }; }),
}));
vi.mock('@main/hook-engine', () => ({
  HookEngine: vi.fn(function() { return { emit: vi.fn() }; }),
}));
vi.mock('@main/hook-installer', () => ({
  HookInstaller: vi.fn(function() { return { install: vi.fn(), uninstall: vi.fn() }; }),
}));
vi.mock('fs', () => ({
  default: { existsSync: vi.fn(() => true) },
  existsSync: vi.fn(() => true),
}));

import { ProjectManager } from '../../src/main/project-manager';

describe('ProjectManager', () => {
  let pm: ProjectManager;

  beforeEach(() => {
    pm = new ProjectManager('/hooks-dir', vi.fn());
  });

  it('addProject creates a ProjectContext with auto-assigned color', () => {
    const ctx = pm.addProject('/repo-a');
    expect(ctx.id).toBeTruthy();
    expect(ctx.dir).toBe('/repo-a');
    expect(ctx.colorIndex).toBe(0);
  });

  it('addProject assigns sequential colors', () => {
    const a = pm.addProject('/repo-a');
    const b = pm.addProject('/repo-b');
    expect(a.colorIndex).toBe(0);
    expect(b.colorIndex).toBe(1);
  });

  it('getProject returns the context by id', () => {
    const ctx = pm.addProject('/repo-a');
    expect(pm.getProject(ctx.id)).toBe(ctx);
  });

  it('getProjectByDir returns the context by directory', () => {
    const ctx = pm.addProject('/repo-a');
    expect(pm.getProjectByDir('/repo-a')).toBe(ctx);
  });

  it('removeProject deletes the context', () => {
    const ctx = pm.addProject('/repo-a');
    pm.removeProject(ctx.id);
    expect(pm.getProject(ctx.id)).toBeUndefined();
  });

  it('getAllProjects returns all contexts', () => {
    pm.addProject('/repo-a');
    pm.addProject('/repo-b');
    expect(pm.getAllProjects()).toHaveLength(2);
  });

  it('rejects duplicate directory', () => {
    pm.addProject('/repo-a');
    expect(() => pm.addProject('/repo-a')).toThrow();
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `pnpm vitest run tests/main/project-manager.test.ts`
Expected: FAIL — module doesn't exist

**Step 3: Implement ProjectManager**

Create `src/main/project-manager.ts`:

```typescript
import { v4 as uuidv4 } from 'crypto';
import fs from 'node:fs';
import { WorktreeManager } from './worktree-manager';
import { HookConfigStore } from './hook-config-store';
import { HookEngine } from './hook-engine';
import { HookInstaller } from './hook-installer';
import type { HookExecutionStatus } from '@shared/types';
import { log } from './logger';

export interface ProjectContext {
  id: string;
  dir: string;
  colorIndex: number;
  worktreeManager: WorktreeManager | null;
  hookConfigStore: HookConfigStore;
  hookEngine: HookEngine;
  hookInstaller: HookInstaller;
}

function generateProjectId(): string {
  // Use crypto.randomUUID if available, otherwise fallback
  return `proj-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export class ProjectManager {
  private projects = new Map<string, ProjectContext>();
  private nextColorIndex = 0;
  private hooksDir: string;
  private onHookStatus: (status: HookExecutionStatus) => void;

  constructor(hooksDir: string, onHookStatus: (status: HookExecutionStatus) => void) {
    this.hooksDir = hooksDir;
    this.onHookStatus = onHookStatus;
  }

  addProject(dir: string, id?: string, colorIndex?: number): ProjectContext {
    // Check for duplicate
    for (const ctx of this.projects.values()) {
      if (ctx.dir === dir) {
        throw new Error(`Project already added: ${dir}`);
      }
    }

    const projectId = id ?? generateProjectId();
    const assignedColor = colorIndex ?? this.nextColorIndex++;

    // Initialize managers (WorktreeManager only if it's a git repo)
    let worktreeManager: WorktreeManager | null = null;
    try {
      if (fs.existsSync(dir) && fs.existsSync(`${dir}/.git`)) {
        worktreeManager = new WorktreeManager(dir);
      }
    } catch {
      // Not a git repo, that's fine
    }

    const hookConfigStore = new HookConfigStore(dir);
    const hookEngine = new HookEngine(hookConfigStore, this.onHookStatus);
    const hookInstaller = new HookInstaller(this.hooksDir);

    const ctx: ProjectContext = {
      id: projectId,
      dir,
      colorIndex: assignedColor,
      worktreeManager,
      hookConfigStore,
      hookEngine,
      hookInstaller,
    };

    this.projects.set(projectId, ctx);
    log.info('[project-manager] added project', projectId, dir);

    return ctx;
  }

  removeProject(id: string): void {
    const ctx = this.projects.get(id);
    if (ctx) {
      // Uninstall hooks from the project directory
      try {
        ctx.hookInstaller.uninstall(ctx.dir);
      } catch (err) {
        log.warn('[project-manager] failed to uninstall hooks from', ctx.dir, String(err));
      }
      this.projects.delete(id);
      log.info('[project-manager] removed project', id, ctx.dir);
    }
  }

  getProject(id: string): ProjectContext | undefined {
    return this.projects.get(id);
  }

  getProjectByDir(dir: string): ProjectContext | undefined {
    for (const ctx of this.projects.values()) {
      if (ctx.dir === dir) return ctx;
    }
    return undefined;
  }

  getAllProjects(): ProjectContext[] {
    return Array.from(this.projects.values());
  }
}
```

**Step 4: Run tests**

Run: `pnpm vitest run tests/main/project-manager.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/main/project-manager.ts tests/main/project-manager.test.ts
git commit -m "feat: add ProjectManager with per-project context management"
```

---

### Task 6: Refactor AppState and IPC Handlers

**Files:**
- Modify: `src/main/ipc-handlers.ts` — replace `AppState` with `ProjectManager`
- Modify: `src/main/index.ts` — remove singletons, use `ProjectManager`
- Modify: `tests/main/ipc-handlers.test.ts` — update mocks

This is the largest refactor. The key changes:

1. `AppState` loses `workspaceDir`, `worktreeManager`, `hookInstaller`, `hookConfigStore`, `hookEngine` — replaced by `projectManager: ProjectManager`
2. `session:start` IPC becomes `project:add` — adds a project to the workspace
3. `tab:create` IPC now takes `projectId` and resolves the project context from it
4. Worktree operations look up the project from the tab's `projectId`
5. Hook config operations become project-scoped

**Step 1: Update AppState interface**

In `src/main/ipc-handlers.ts`, change `AppState`:

```typescript
export interface AppState {
  workspaceId: string | null;
  projectManager: ProjectManager | null;
  permissionMode: PermissionMode;
  mainWindow: { setTitle: (title: string) => void } | null;
  cliStartDir: string | null;
  pipeName: string;
}
```

**Step 2: Update IPC handlers one by one**

Replace `session:start` with `project:add` and `workspace:init`:
- `workspace:init` — sets up the workspace (permission mode, returns workspace id)
- `project:add` — adds a project dir to the current workspace, returns ProjectConfig
- `project:remove` — removes a project from the workspace
- `project:list` — returns all projects
- Keep `session:getSavedTabs` but make it take a dir (unchanged)

Update `tab:create` to take `projectId`:
```typescript
ipcMain.handle('tab:create', async (_event, projectId: string, worktreeName: string | null, resumeSessionId?: string, savedName?: string) => {
  const project = state.projectManager!.getProject(projectId);
  if (!project) throw new Error(`Unknown project: ${projectId}`);
  const cwd = worktreeName
    ? path.join(project.dir, '.claude', 'worktrees', worktreeName)
    : project.dir;
  // ... rest similar but using project.hookInstaller, project.dir instead of state.workspaceDir
});
```

Update worktree handlers to derive project from the calling context:
```typescript
ipcMain.handle('worktree:create', async (_event, projectId: string, name: string) => {
  const project = state.projectManager!.getProject(projectId);
  if (!project?.worktreeManager) throw new Error('Not a git repo');
  // ...
});
```

Update hookConfig handlers to take projectId:
```typescript
ipcMain.handle('hookConfig:load', async (_event, projectId: string) => {
  const project = state.projectManager!.getProject(projectId);
  if (!project) throw new Error('Unknown project');
  return project.hookConfigStore.load();
});
```

**Step 3: Update git HEAD watcher**

The git HEAD watcher needs to be per-project. Move it into `ProjectContext` or create a watcher per project when `project:add` is called.

**Step 4: Update all tests**

Update `tests/main/ipc-handlers.test.ts` to reflect new IPC signatures and mock structure.

**Step 5: Update `src/main/index.ts`**

- Remove `state.workspaceDir`, `state.worktreeManager`, etc.
- Add `state.projectManager = new ProjectManager(hooksDir, onHookStatus)`
- Update `doPersistSessions()` to iterate all projects
- Update `window-all-closed` handler

**Step 6: Run all tests**

Run: `pnpm test`
Expected: PASS

**Step 7: Commit**

```bash
git add src/main/ipc-handlers.ts src/main/index.ts tests/main/ipc-handlers.test.ts
git commit -m "refactor: replace AppState singletons with ProjectManager"
```

---

### Task 7: Update Preload Bridge and Renderer Types

**Files:**
- Modify: `src/preload.ts` — update IPC bridge to include projectId params
- Modify: `src/renderer/App.tsx` — placeholder; just update call signatures

**Step 1: Update preload.ts**

Add new IPC methods and update existing ones:

```typescript
// New workspace/project methods:
initWorkspace: (mode: PermissionMode) => ipcRenderer.invoke('workspace:init', mode),
addProject: (dir: string) => ipcRenderer.invoke('project:add', dir),
removeProject: (projectId: string) => ipcRenderer.invoke('project:remove', projectId),
listProjects: () => ipcRenderer.invoke('project:list'),

// Updated tab methods (now require projectId):
createTab: (projectId: string, worktree?: string | null, resumeSessionId?: string, savedName?: string) =>
  ipcRenderer.invoke('tab:create', projectId, worktree ?? null, resumeSessionId, savedName),

// Updated worktree methods (now require projectId):
createTabWithWorktree: (projectId: string, name: string) =>
  ipcRenderer.invoke('tab:createWithWorktree', projectId, name),
getCurrentBranch: (projectId: string) =>
  ipcRenderer.invoke('worktree:currentBranch', projectId),

// New project events:
onProjectAdded: (cb: (project: ProjectConfig) => void) => { ... },
onProjectRemoved: (cb: (projectId: string) => void) => { ... },
```

**Step 2: Run all tests**

Run: `pnpm test`
Expected: PASS

**Step 3: Commit**

```bash
git add src/preload.ts
git commit -m "feat: update preload bridge with project-scoped IPC methods"
```

---

### Task 8: Create Sidebar Component

**Files:**
- Create: `src/renderer/components/ProjectSidebar.tsx`
- Modify: `src/renderer/index.css` — add sidebar styles
- Create: `tests/renderer/ProjectSidebar.test.tsx`

**Step 1: Write failing test**

Create `tests/renderer/ProjectSidebar.test.tsx`:

```typescript
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import ProjectSidebar from '../../src/renderer/components/ProjectSidebar';

describe('ProjectSidebar', () => {
  const projects = [
    { id: 'p1', dir: 'D:/dev/repo-a', colorIndex: 0 },
    { id: 'p2', dir: 'D:/dev/repo-b', colorIndex: 1 },
  ];
  const tabCounts = {
    p1: { idle: 1, working: 1, requires_response: 0, total: 2 },
    p2: { idle: 0, working: 0, requires_response: 1, total: 1 },
  };

  it('renders project names from directory paths', () => {
    render(
      <ProjectSidebar
        projects={projects}
        activeProjectId="p1"
        tabCounts={tabCounts}
        collapsed={false}
        onSelectProject={vi.fn()}
        onAddProject={vi.fn()}
        onToggleCollapse={vi.fn()}
      />
    );
    expect(screen.getByText('repo-a')).toBeTruthy();
    expect(screen.getByText('repo-b')).toBeTruthy();
  });

  it('calls onSelectProject when clicked', () => {
    const onSelect = vi.fn();
    render(
      <ProjectSidebar
        projects={projects}
        activeProjectId="p1"
        tabCounts={tabCounts}
        collapsed={false}
        onSelectProject={onSelect}
        onAddProject={vi.fn()}
        onToggleCollapse={vi.fn()}
      />
    );
    fireEvent.click(screen.getByText('repo-b'));
    expect(onSelect).toHaveBeenCalledWith('p2');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/renderer/ProjectSidebar.test.tsx`
Expected: FAIL — component doesn't exist

**Step 3: Implement ProjectSidebar**

Create `src/renderer/components/ProjectSidebar.tsx`:

```typescript
import { useMemo } from 'react';
import path from 'path-browserify'; // or just use string split
import { PROJECT_COLORS, type ProjectConfig } from '../../shared/types';

interface TabCounts {
  idle: number;
  working: number;
  requires_response: number;
  total: number;
}

interface Props {
  projects: ProjectConfig[];
  activeProjectId: string;
  tabCounts: Record<string, TabCounts>;
  collapsed: boolean;
  onSelectProject: (id: string) => void;
  onAddProject: () => void;
  onToggleCollapse: () => void;
}

export default function ProjectSidebar({
  projects, activeProjectId, tabCounts, collapsed,
  onSelectProject, onAddProject, onToggleCollapse,
}: Props) {
  return (
    <div className={`project-sidebar ${collapsed ? 'sidebar-collapsed' : 'sidebar-expanded'}`}>
      <div className="sidebar-projects">
        {projects.map((project) => {
          const dirName = project.dir.split(/[/\\]/).pop() ?? project.dir;
          const counts = tabCounts[project.id] ?? { idle: 0, working: 0, requires_response: 0, total: 0 };
          const isActive = project.id === activeProjectId;
          const hue = PROJECT_COLORS[project.colorIndex % PROJECT_COLORS.length].hue;

          return (
            <button
              key={project.id}
              className={`sidebar-project ${isActive ? 'sidebar-project-active' : ''}`}
              style={{ '--project-hue': hue } as React.CSSProperties}
              onClick={() => onSelectProject(project.id)}
            >
              <span className="sidebar-project-name">{dirName}</span>
              <span className="sidebar-project-counts">
                {counts.working > 0 && <span className="sidebar-count-working">{counts.working}●</span>}
                {counts.requires_response > 0 && <span className="sidebar-count-response">{counts.requires_response}↓</span>}
                {counts.idle > 0 && <span className="sidebar-count-idle">{counts.idle}</span>}
              </span>
            </button>
          );
        })}
      </div>
      <button className="sidebar-add-btn" onClick={onAddProject} title="Add project">+</button>
    </div>
  );
}
```

**Step 4: Add sidebar CSS to `src/renderer/index.css`**

```css
/* Project sidebar */
.project-sidebar {
  display: flex;
  flex-direction: column;
  background: #181818;
  border-right: 1px solid #3c3c3c;
  flex-shrink: 0;
  overflow: hidden;
}

.sidebar-expanded { width: 200px; }

.sidebar-collapsed {
  width: 48px;
}
.sidebar-collapsed .sidebar-project {
  writing-mode: vertical-lr;
  transform: rotate(180deg);
  white-space: nowrap;
  padding: 8px 4px;
  font-size: 11px;
}

.sidebar-projects {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
}

.sidebar-project {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  padding: 8px 12px;
  background: none;
  border: none;
  border-left: 3px solid transparent;
  color: #808080;
  cursor: pointer;
  text-align: left;
  font-size: 12px;
  font-family: inherit;
}
.sidebar-project:hover { background: #252526; }
.sidebar-project-active {
  border-left-color: hsl(var(--project-hue, 210) 60% 50%);
  color: #d4d4d4;
  background: #252526;
}

.sidebar-project-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sidebar-project-counts { display: flex; gap: 4px; font-size: 10px; flex-shrink: 0; }
.sidebar-count-working { color: #dcdcaa; }
.sidebar-count-response { color: #ce9178; }
.sidebar-count-idle { color: #6a9955; }

.sidebar-add-btn {
  background: none; border: none; border-top: 1px solid #3c3c3c;
  color: #808080; font-size: 18px; padding: 8px; cursor: pointer;
}
.sidebar-add-btn:hover { color: #fff; background: #252526; }
```

**Step 5: Run tests**

Run: `pnpm vitest run tests/renderer/ProjectSidebar.test.tsx`
Expected: PASS

**Step 6: Commit**

```bash
git add src/renderer/components/ProjectSidebar.tsx src/renderer/index.css tests/renderer/ProjectSidebar.test.tsx
git commit -m "feat: add ProjectSidebar component with collapsed vertical tabs"
```

---

### Task 9: Create Project Switcher Dialog (Ctrl+P)

**Files:**
- Create: `src/renderer/components/ProjectSwitcherDialog.tsx`
- Modify: `src/renderer/index.css` — add switcher styles
- Create: `tests/renderer/ProjectSwitcherDialog.test.tsx`

**Step 1: Write failing test**

```typescript
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import ProjectSwitcherDialog from '../../src/renderer/components/ProjectSwitcherDialog';

describe('ProjectSwitcherDialog', () => {
  const projects = [
    { id: 'p1', dir: 'D:/dev/repo-a', colorIndex: 0, tabCount: 2 },
    { id: 'p2', dir: 'D:/dev/repo-b', colorIndex: 1, tabCount: 1 },
  ];

  it('renders project list', () => {
    render(<ProjectSwitcherDialog projects={projects} onSelect={vi.fn()} onAddProject={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByText('repo-a')).toBeTruthy();
    expect(screen.getByText('repo-b')).toBeTruthy();
  });

  it('navigates with arrow keys', () => {
    const onSelect = vi.fn();
    const { container } = render(
      <ProjectSwitcherDialog projects={projects} onSelect={onSelect} onAddProject={vi.fn()} onCancel={vi.fn()} />
    );
    fireEvent.keyDown(container.firstChild!, { key: 'ArrowDown' });
    fireEvent.keyDown(container.firstChild!, { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledWith('p2');
  });

  it('closes on Escape', () => {
    const onCancel = vi.fn();
    const { container } = render(
      <ProjectSwitcherDialog projects={projects} onSelect={vi.fn()} onAddProject={vi.fn()} onCancel={onCancel} />
    );
    fireEvent.keyDown(container.firstChild!, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalled();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/renderer/ProjectSwitcherDialog.test.tsx`

**Step 3: Implement ProjectSwitcherDialog**

A modal dialog with:
- List of projects (dir name, full path, color swatch, tab count)
- Keyboard navigation (ArrowUp/ArrowDown/Enter/Escape)
- "Add Project..." at the bottom
- OK and Cancel buttons
- Double-click to select

**Step 4: Add CSS**

**Step 5: Run tests**

Run: `pnpm vitest run tests/renderer/ProjectSwitcherDialog.test.tsx`
Expected: PASS

**Step 6: Commit**

```bash
git add src/renderer/components/ProjectSwitcherDialog.tsx src/renderer/index.css tests/renderer/ProjectSwitcherDialog.test.tsx
git commit -m "feat: add Ctrl+P project switcher dialog"
```

---

### Task 10: Update Color Tinting to Be Per-Project

**Files:**
- Modify: `src/renderer/index.css` — change `--instance-hue` to `--project-hue` where applicable
- Modify: `src/renderer/App.tsx` — set `--project-hue` CSS variable based on active project

Currently the app uses `--instance-hue` (PID-based) for the border, tab bar, and status bar. This needs to change to `--project-hue` that updates when the active project changes.

**Step 1: Update CSS**

Change `.tab-bar`, `.status-bar`, `.app` border to use `--project-hue` instead of `--instance-hue`:

```css
.app {
  border: 1px solid hsl(var(--project-hue, 0) 40% 25%);
}
.tab-bar {
  background: hsl(var(--project-hue, 0) 30% 18%);
}
.tab:hover { background: hsl(var(--project-hue, 0) 20% 24%); }
.tab-active { background: hsl(var(--project-hue, 0) 45% 30%); }
.status-bar {
  background: hsl(var(--project-hue, 0) 30% 18%);
}
```

**Step 2: Update App.tsx**

When active project changes, set the CSS variable:

```typescript
useEffect(() => {
  const project = projects.find(p => p.id === activeProjectId);
  if (project) {
    const hue = PROJECT_COLORS[project.colorIndex % PROJECT_COLORS.length].hue;
    document.documentElement.style.setProperty('--project-hue', String(hue));
  }
}, [activeProjectId, projects]);
```

**Step 3: Remove the old instance hue effect** (the `getInstanceHue` IPC call and `--instance-hue` variable)

**Step 4: Run all tests**

Run: `pnpm test`
Expected: PASS

**Step 5: Commit**

```bash
git add src/renderer/index.css src/renderer/App.tsx
git commit -m "feat: per-project color tinting for tab bar, status bar, and border"
```

---

### Task 11: Refactor App.tsx for Multi-Project State

**Files:**
- Modify: `src/renderer/App.tsx` — add project state management, wire sidebar and switcher

This is the main renderer refactor. Key changes:

**Step 1: Add project state**

```typescript
const [projects, setProjects] = useState<ProjectConfig[]>([]);
const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
const [sidebarCollapsed, setSidebarCollapsed] = useState(true);
const [showProjectSwitcher, setShowProjectSwitcher] = useState(false);
```

**Step 2: Filter tabs by active project**

```typescript
const activeProjectTabs = useMemo(
  () => tabs.filter(t => t.projectId === activeProjectId),
  [tabs, activeProjectId]
);
```

Use `activeProjectTabs` instead of `tabs` in the tab bar and status bar.

**Step 3: Compute tabCounts per project**

```typescript
const tabCounts = useMemo(() => {
  const counts: Record<string, { idle: number; working: number; requires_response: number; total: number }> = {};
  for (const project of projects) {
    counts[project.id] = { idle: 0, working: 0, requires_response: 0, total: 0 };
  }
  for (const tab of tabs) {
    const c = counts[tab.projectId];
    if (c) {
      c.total++;
      if (tab.status === 'idle') c.idle++;
      else if (tab.status === 'working') c.working++;
      else if (tab.status === 'requires_response') c.requires_response++;
    }
  }
  return counts;
}, [tabs, projects]);
```

**Step 4: Add project switching handler**

```typescript
const handleSelectProject = useCallback((projectId: string) => {
  setActiveProjectId(projectId);
  // Auto-select first tab of the new project
  const projectTabs = tabsRef.current.filter(t => t.projectId === projectId);
  if (projectTabs.length > 0) {
    handleSelectTab(projectTabs[0].id);
  }
}, [handleSelectTab]);
```

**Step 5: Add Ctrl+P keybinding**

In the keyboard handler, add:
```typescript
if (e.ctrlKey && e.key === 'p') {
  e.preventDefault();
  setShowProjectSwitcher(true);
  return;
}
```

**Step 6: Update layout JSX**

Change the `app` div layout from column to row+column:

```tsx
<div className="app">
  <ProjectSidebar
    projects={projects}
    activeProjectId={activeProjectId ?? ''}
    tabCounts={tabCounts}
    collapsed={sidebarCollapsed}
    onSelectProject={handleSelectProject}
    onAddProject={() => setShowProjectSwitcher(true)}
    onToggleCollapse={() => setSidebarCollapsed(!sidebarCollapsed)}
  />
  <div className="app-main">
    <TabBar tabs={activeProjectTabs} ... />
    <div className="terminal-area">
      {tabs.map((tab) => (
        <Terminal key={tab.id} tabId={tab.id} isVisible={tab.id === activeTabId} />
      ))}
    </div>
    <StatusBar tabs={activeProjectTabs} ... />
  </div>
  {showProjectSwitcher && <ProjectSwitcherDialog ... />}
</div>
```

Note: ALL terminals still mount (including hidden projects) — only visibility changes. This preserves the existing "no data loss" behavior.

**Step 7: Update `.app` CSS layout**

```css
.app {
  display: flex;
  flex-direction: row;  /* was column */
  height: 100vh;
  border: 1px solid hsl(var(--project-hue, 0) 40% 25%);
}
.app-main {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
}
```

**Step 8: Run all tests**

Run: `pnpm test`
Expected: PASS

**Step 9: Commit**

```bash
git add src/renderer/App.tsx src/renderer/index.css
git commit -m "feat: multi-project App state with sidebar and project-scoped tabs"
```

---

### Task 12: Update Startup and Workspace Picker Flow

**Files:**
- Modify: `src/renderer/components/StartupDialog.tsx` — becomes workspace picker
- Modify: `src/renderer/App.tsx` — startup flow

**Step 1: Redesign StartupDialog**

The startup dialog now shows:
1. **Saved workspaces** (if any) — list with name, project count, click to open
2. **"New Workspace"** button — opens the existing directory picker + permission mode selector
3. If no workspaces exist, fall back to the current single-directory flow

**Step 2: Update startup flow in App.tsx**

```typescript
// On mount, check for saved workspaces
useEffect(() => {
  (async () => {
    const workspaces = await window.claudeTerminal.listWorkspaces();
    if (workspaces.length > 0) {
      setAvailableWorkspaces(workspaces);
    }
  })();
}, []);
```

When a workspace is selected:
1. `workspace:init` IPC — set permission mode
2. For each project in the workspace: `project:add` IPC
3. For each project: load saved tabs from `sessions.json`, create tabs

When "New Workspace" is selected:
1. Show directory picker
2. Create workspace with that single directory
3. Proceed as above

**Step 3: Run all tests**

Run: `pnpm test`
Expected: PASS

**Step 4: Commit**

```bash
git add src/renderer/components/StartupDialog.tsx src/renderer/App.tsx
git commit -m "feat: workspace picker startup flow with saved workspace restore"
```

---

### Task 13: Update Session Persistence for Multi-Project

**Files:**
- Modify: `src/main/index.ts` — persist workspace config on changes
- Modify: `src/main/ipc-handlers.ts` — workspace save triggers

**Step 1: Save workspace config on project add/remove**

When a project is added or removed, save the workspace config:

```typescript
function persistWorkspace() {
  if (!state.workspaceId || !state.projectManager) return;
  const ws: WorkspaceConfig = {
    id: state.workspaceId,
    name: '...', // derive from first project or use saved name
    projects: state.projectManager.getAllProjects().map(p => ({
      id: p.id, dir: p.dir, colorIndex: p.colorIndex,
    })),
    activeProjectId: '...', // current active project
    geometry: mainWindow.getBounds(),
  };
  workspaceStore.saveWorkspace(ws);
}
```

**Step 2: Per-project session persistence**

Update `doPersistSessions()` to iterate all projects:

```typescript
async function doPersistSessions() {
  if (shuttingDown || !state.projectManager) return;
  for (const project of state.projectManager.getAllProjects()) {
    const projectTabs = tabManager.getTabsByProject(project.id);
    const claudeTabs = projectTabs.filter(t => t.type === 'claude');
    const savedTabs = claudeTabs
      .filter(t => t.sessionId && t.status !== 'new')
      .map(t => ({ name: t.name, cwd: t.cwd, worktree: t.worktree, sessionId: t.sessionId! }));
    if (savedTabs.length === 0 && claudeTabs.length > 0) continue;
    await settings.saveSessions(project.dir, savedTabs);
  }
}
```

**Step 3: Run all tests**

Run: `pnpm test`
Expected: PASS

**Step 4: Commit**

```bash
git add src/main/index.ts src/main/ipc-handlers.ts
git commit -m "feat: per-project session persistence and workspace config save"
```

---

### Task 14: Project-Aware Toast Notifications

**Files:**
- Modify: `src/main/hook-router.ts` — include projectId in notification
- Modify: `src/renderer/App.tsx` — toast handler switches project

**Step 1: Update hook router**

When a notification is fired for a tab, include the tab's `projectId` in the renderer event:

```typescript
// In handleHookMessage for 'tab:status:input':
const tab = tabManager.getTab(msg.tabId);
if (tab) {
  sendToRenderer('tab:notification', { tabId: tab.id, projectId: tab.projectId, name: tab.name });
}
```

**Step 2: Update renderer toast handler**

When the user clicks the toast:
1. Switch to the tab's project (`handleSelectProject(projectId)`)
2. Switch to the specific tab (`handleSelectTab(tabId)`)

**Step 3: Run all tests**

Run: `pnpm test`
Expected: PASS

**Step 4: Commit**

```bash
git add src/main/hook-router.ts src/renderer/App.tsx
git commit -m "feat: project-aware toast notifications with project switching"
```

---

### Task 15: Update Window Title

**Files:**
- Modify: `src/shared/window-title.ts` — include workspace name
- Modify: `tests/shared/window-title.test.ts` — update tests

**Step 1: Write failing test**

```typescript
it('includes workspace name and active project', () => {
  const title = buildWindowTitle('My Workspace', 'claude-terminal', [], 'main');
  expect(title).toBe('My Workspace - claude-terminal (main)');
});
```

**Step 2: Update buildWindowTitle signature**

```typescript
export function buildWindowTitle(
  workspaceName: string | null,
  activeProjectName: string | null,
  tabs: Tab[],
  branch: string | null,
): string
```

**Step 3: Run tests**

Run: `pnpm vitest run tests/shared/window-title.test.ts`
Expected: PASS

**Step 4: Commit**

```bash
git add src/shared/window-title.ts tests/shared/window-title.test.ts
git commit -m "feat: window title includes workspace and active project names"
```

---

### Task 16: Update Keybindings for Project Navigation

**Files:**
- Modify: `src/renderer/keybindings.ts` — add Ctrl+P for project switcher
- Modify: `src/renderer/App.tsx` — wire keybinding

**Step 1: Add Ctrl+P keybinding**

In the keybinding config, add:
```typescript
{ key: 'p', ctrl: true, action: (ctx) => ctx.openProjectSwitcher() }
```

Add `openProjectSwitcher` to `KeybindingContext`.

**Step 2: Run tests**

Run: `pnpm test`
Expected: PASS

**Step 3: Commit**

```bash
git add src/renderer/keybindings.ts src/renderer/App.tsx
git commit -m "feat: Ctrl+P keybinding opens project switcher"
```

---

### Task 17: Migration from Single-Project to Workspaces

**Files:**
- Modify: `src/main/index.ts` or `src/main/ipc-handlers.ts` — migration logic

**Step 1: Add migration check on startup**

When the app starts and finds no workspace files but has `recentDirs` in settings:
1. Create a workspace from the most recent directory
2. Save it to the workspace store

This ensures users upgrading from single-project mode don't lose their recent directories.

**Step 2: Test migration manually**

1. Start old version, open a project, create tabs
2. Upgrade to new version
3. Verify: workspace is auto-created from recent dir, tabs are restored

**Step 3: Commit**

```bash
git add src/main/index.ts
git commit -m "feat: auto-migrate single-project users to workspace model"
```

---

### Task 18: Integration Testing and Cleanup

**Files:**
- Modify: `tests/integration/app.test.ts` — update for multi-project flow
- Clean up any remaining `--instance-hue` references
- Remove `instance:getHue` IPC handler

**Step 1: Update integration tests**

Update the integration test to:
1. Add a project
2. Create tabs in it
3. Add a second project
4. Create tabs in it
5. Verify tab filtering by project
6. Verify session persistence per project

**Step 2: Run full test suite**

Run: `pnpm test`
Expected: PASS

**Step 3: Clean up dead code**

- Remove `instance:getHue` IPC handler from `ipc-handlers.ts`
- Remove `getInstanceHue` from preload
- Remove `--instance-hue` from CSS
- Remove `window:createNew` if Ctrl+N now opens workspace picker instead

**Step 4: Commit**

```bash
git add -A
git commit -m "test: update integration tests for multi-project and clean up dead code"
```
