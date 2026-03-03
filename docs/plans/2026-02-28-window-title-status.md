# Window Title Tab Status Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Dynamically update the Electron window title to show tab status counts like `ClaudeTerminal - D:\dev [2 Working, 1 Input]`.

**Architecture:** Renderer-driven — `App.tsx` computes the title from its `tabs[]` state on every change and sends it to the main process via IPC. Main process calls `BrowserWindow.setTitle()`.

**Tech Stack:** Electron IPC, React useEffect, TypeScript

---

### Task 1: Add `buildWindowTitle` utility

**Files:**
- Create: `src/shared/window-title.ts`
- Create: `tests/shared/window-title.test.ts`

**Step 1: Write the failing test**

```typescript
// tests/shared/window-title.test.ts
import { buildWindowTitle } from '@shared/window-title';
import type { Tab } from '@shared/types';

const makeTab = (status: Tab['status']): Tab => ({
  id: `tab-${Math.random()}`,
  name: 'Tab',
  defaultName: 'Tab',
  status,
  worktree: null,
  cwd: '/test',
  pid: null,
  sessionId: null,
});

describe('buildWindowTitle', () => {
  it('shows base title with no tabs', () => {
    expect(buildWindowTitle('D:\\dev', [])).toBe('ClaudeTerminal - D:\\dev');
  });

  it('shows single working tab', () => {
    const tabs = [makeTab('working')];
    expect(buildWindowTitle('D:\\dev', tabs)).toBe('ClaudeTerminal - D:\\dev [1 Working]');
  });

  it('shows multiple states, hides zero counts', () => {
    const tabs = [makeTab('working'), makeTab('working'), makeTab('idle'), makeTab('requires_response')];
    expect(buildWindowTitle('D:\\dev', tabs)).toBe('ClaudeTerminal - D:\\dev [2 Working, 1 Idle, 1 Input]');
  });

  it('hides states with zero count', () => {
    const tabs = [makeTab('idle'), makeTab('idle')];
    expect(buildWindowTitle('D:\\dev', tabs)).toBe('ClaudeTerminal - D:\\dev [2 Idle]');
  });

  it('shows New state', () => {
    const tabs = [makeTab('new')];
    expect(buildWindowTitle('D:\\dev', tabs)).toBe('ClaudeTerminal - D:\\dev [1 New]');
  });

  it('shows all four states when all present', () => {
    const tabs = [makeTab('new'), makeTab('working'), makeTab('idle'), makeTab('requires_response')];
    expect(buildWindowTitle('D:\\dev', tabs)).toBe('ClaudeTerminal - D:\\dev [1 New, 1 Working, 1 Idle, 1 Input]');
  });

  it('uses fallback title when no workspace dir', () => {
    expect(buildWindowTitle(null, [])).toBe('ClaudeTerminal');
  });

  it('uses fallback title with tabs but no workspace dir', () => {
    const tabs = [makeTab('working')];
    expect(buildWindowTitle(null, tabs)).toBe('ClaudeTerminal [1 Working]');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/shared/window-title.test.ts`
Expected: FAIL — module not found

**Step 3: Write minimal implementation**

```typescript
// src/shared/window-title.ts
import type { Tab, TabStatus } from './types';

const STATUS_LABELS: [TabStatus, string][] = [
  ['new', 'New'],
  ['working', 'Working'],
  ['idle', 'Idle'],
  ['requires_response', 'Input'],
];

export function buildWindowTitle(workspaceDir: string | null, tabs: Tab[]): string {
  const base = workspaceDir ? `ClaudeTerminal - ${workspaceDir}` : 'ClaudeTerminal';

  if (tabs.length === 0) return base;

  const parts: string[] = [];
  for (const [status, label] of STATUS_LABELS) {
    const count = tabs.filter((t) => t.status === status).length;
    if (count > 0) parts.push(`${count} ${label}`);
  }

  if (parts.length === 0) return base;
  return `${base} [${parts.join(', ')}]`;
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/shared/window-title.test.ts`
Expected: PASS (all 8 tests)

**Step 5: Commit**

```bash
git add src/shared/window-title.ts tests/shared/window-title.test.ts
git commit -m "feat: add buildWindowTitle utility for dynamic window title"
```

---

### Task 2: Add `window:setTitle` IPC handler in main process

**Files:**
- Modify: `src/main/index.ts` (inside `registerIpcHandlers()`, around line 278)

**Step 1: Add the IPC handler**

In `src/main/index.ts`, inside `registerIpcHandlers()`, add:

```typescript
ipcMain.handle('window:setTitle', (_event, title: string) => {
  if (mainWindow) {
    mainWindow.setTitle(title);
  }
});
```

**Step 2: Remove the static title set in `session:start`**

In `src/main/index.ts` line 285-286, inside the `session:start` handler, remove or comment out:

```typescript
// REMOVE this line:
mainWindow.setTitle(`ClaudeTerminal - ${dir}`);
```

The renderer will now manage the title dynamically.

**Step 3: Commit**

```bash
git add src/main/index.ts
git commit -m "feat: add window:setTitle IPC handler, remove static title"
```

---

### Task 3: Add `setWindowTitle` to preload API

**Files:**
- Modify: `src/preload.ts` (add one method to the api object)

**Step 1: Add the method**

In `src/preload.ts`, add to the `api` object (e.g., after the Settings section):

```typescript
// Window title
setWindowTitle: (title: string): void =>
  ipcRenderer.send('window:setTitle', title),
```

Note: Use `send` (fire-and-forget) not `invoke` since we don't need a return value. Update the main process handler accordingly — use `ipcMain.on` instead of `ipcMain.handle`.

**Step 2: Commit**

```bash
git add src/preload.ts
git commit -m "feat: expose setWindowTitle in preload API"
```

---

### Task 4: Add `useEffect` in App.tsx to update window title

**Files:**
- Modify: `src/renderer/App.tsx`

**Step 1: Import buildWindowTitle and add useEffect**

At the top of `App.tsx`, add import:

```typescript
import { buildWindowTitle } from '../shared/window-title';
```

Inside the `App` component, add a new state to track workspaceDir and a useEffect:

```typescript
const [workspaceDir, setWorkspaceDir] = useState<string | null>(null);
```

In `handleStartSession`, after `await window.claudeTerminal.startSession(dir, mode)`, add:

```typescript
setWorkspaceDir(dir);
```

Similarly in the CLI auto-start useEffect, after `const cliDir = ...` is confirmed, add:

```typescript
setWorkspaceDir(cliDir);
```

Then add the title update effect:

```typescript
// Update window title when tabs change
useEffect(() => {
  const title = buildWindowTitle(workspaceDir, tabs);
  window.claudeTerminal.setWindowTitle(title);
}, [tabs, workspaceDir]);
```

**Step 2: Verify manually**

Run: `npm start`
- Open app, start a session
- Create multiple tabs
- Observe window title updates as tabs change status (working/idle/etc.)
- Check Windows taskbar shows the updated title

**Step 3: Commit**

```bash
git add src/renderer/App.tsx
git commit -m "feat: dynamically update window title with tab status counts"
```
