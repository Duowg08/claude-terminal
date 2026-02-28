# Windows Shell Tabs Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add PowerShell and WSL terminal tabs alongside existing Claude tabs, with dropdown menus and keyboard shortcuts.

**Architecture:** Extend the existing `Tab` type with a `type` field (`'claude' | 'powershell' | 'wsl'`). `PtyManager` branches spawn logic on type. Shell tabs skip hook installation and session persistence. UI gets a [+] dropdown and per-tab chevron menu.

**Tech Stack:** Electron, React, node-pty, xterm.js, lucide-react icons

---

### Task 1: Extend Tab Types

**Files:**
- Modify: `src/shared/types.ts`

**Step 1: Add TabType and update Tab interface**

```typescript
// Add after TabStatus line
export type TabType = 'claude' | 'powershell' | 'wsl';
```

Update `TabStatus` to include `'shell'`:
```typescript
export type TabStatus = 'new' | 'working' | 'idle' | 'requires_response' | 'shell';
```

Add `type` field to `Tab` interface (after `id`):
```typescript
export interface Tab {
  id: string;
  type: TabType;
  name: string;
  // ... rest unchanged
}
```

**Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit 2>&1 | head -30`
Expected: Type errors in files that construct `Tab` objects (tab-manager.ts, etc.) — that's correct, we fix them in subsequent tasks.

**Step 3: Commit**

```bash
git add src/shared/types.ts
git commit -m "feat: add TabType and shell status to shared types"
```

---

### Task 2: Update TabManager to Accept Type

**Files:**
- Modify: `src/main/tab-manager.ts`

**Step 1: Update createTab to accept type parameter**

Change `createTab` signature and body:
```typescript
createTab(cwd: string, worktree: string | null, type: TabType = 'claude', savedName?: string): Tab {
  const id = generateId();
  const defaultName = type !== 'claude'
    ? (type === 'powershell' ? 'PowerShell' : 'WSL')
    : (worktree ?? `Tab ${this.nextTabNum++}`);
  const name = savedName ?? defaultName;
  const status: TabStatus = type === 'claude' ? 'new' : 'shell';
  const tab: Tab = { id, type, name, defaultName, status, worktree, cwd, pid: null, sessionId: null };
  this.tabs.set(id, tab);
  if (!this.activeTabId) {
    this.activeTabId = id;
  }
  return tab;
}
```

Add import for `TabType` at top:
```typescript
import { Tab, TabStatus, TabType } from '@shared/types';
```

**Step 2: Add insertTabAfter method for chevron-spawned tabs**

Add after `createTab`:
```typescript
insertTabAfter(afterTabId: string, tab: Tab): void {
  // Remove and re-insert to maintain order
  // Since Map preserves insertion order, we rebuild
  const entries = Array.from(this.tabs.entries());
  const afterIdx = entries.findIndex(([id]) => id === afterTabId);
  if (afterIdx === -1) {
    this.tabs.set(tab.id, tab);
    return;
  }
  const newEntries = [
    ...entries.slice(0, afterIdx + 1),
    [tab.id, tab] as [string, Tab],
    ...entries.slice(afterIdx + 1),
  ];
  this.tabs.clear();
  for (const [id, t] of newEntries) {
    this.tabs.set(id, t);
  }
}
```

**Step 3: Verify TypeScript compiles for this file**

Run: `npx tsc --noEmit 2>&1 | grep tab-manager`
Expected: No errors in tab-manager.ts

**Step 4: Commit**

```bash
git add src/main/tab-manager.ts
git commit -m "feat: add type parameter to TabManager.createTab and insertTabAfter"
```

---

### Task 3: Update PtyManager to Spawn Shells

**Files:**
- Modify: `src/main/pty-manager.ts`

**Step 1: Add spawnShell method**

Add after `spawn()`:
```typescript
spawnShell(
  tabId: string,
  cwd: string,
  shellType: 'powershell' | 'wsl',
): pty.IPty {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([, v]) => v !== undefined),
  ) as Record<string, string>;

  const shell = shellType === 'powershell' ? 'powershell.exe' : 'wsl.exe';

  const proc = pty.spawn(shell, [], {
    name: 'xterm-256color',
    cols: 120,
    rows: 40,
    cwd,
    env,
  });

  this.ptys.set(tabId, { process: proc, tabId });
  return proc;
}
```

**Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit 2>&1 | grep pty-manager`
Expected: No errors

**Step 3: Commit**

```bash
git add src/main/pty-manager.ts
git commit -m "feat: add spawnShell method for PowerShell and WSL"
```

---

### Task 4: Add Shell Tab IPC Handler

**Files:**
- Modify: `src/main/index.ts`
- Modify: `src/preload.ts`

**Step 1: Add IPC handler in index.ts**

Add after the `tab:create` handler (after line 415):
```typescript
ipcMain.handle('tab:createShell', async (
  _event,
  shellType: 'powershell' | 'wsl',
  afterTabId?: string,
) => {
  if (!workspaceDir) throw new Error('Session not started');

  // Determine cwd: if afterTabId provided, use that tab's cwd
  let cwd = workspaceDir;
  if (afterTabId) {
    const parentTab = tabManager.getTab(afterTabId);
    if (parentTab) cwd = parentTab.cwd;
  }

  const tab = tabManager.createTab(cwd, null, shellType);

  // If opened from a tab's chevron, insert after that tab
  if (afterTabId) {
    tabManager.removeTab(tab.id);
    tabManager.insertTabAfter(afterTabId, tab);
  }

  // Spawn the shell PTY (no hooks, no Claude args)
  const proc = ptyManager.spawnShell(tab.id, cwd, shellType);
  tab.pid = proc.pid;

  // Forward PTY output to the renderer
  proc.onData((data: string) => {
    sendToRenderer('pty:data', tab.id, data);
  });

  // Clean up on exit
  proc.onExit(() => {
    if (tabManager.getTab(tab.id)) {
      tabManager.removeTab(tab.id);
      sendToRenderer('tab:removed', tab.id);
    }
  });

  // Set as active
  tabManager.setActiveTab(tab.id);

  sendToRenderer('tab:updated', tab);
  return tab;
});
```

**Step 2: Update tab:close handler to skip worktree removal for shell tabs**

In the `tab:close` handler (line 417-433), the worktree removal check already guards on `tab?.worktree` which will be null for shell tabs, so no change needed.

**Step 3: Update persistSessions to skip shell tabs**

In `persistSessions()` (line 170-182), update the filter to exclude shell tabs:
```typescript
const savedTabs = allTabs
  .filter(t => t.sessionId && t.type === 'claude')
  .map(t => ({
```

**Step 4: Update close confirmation to skip shell tabs**

In the `mainWindow.on('close')` handler (line 107), the `status === 'working'` check already excludes shell tabs since they have `status: 'shell'`. No change needed.

**Step 5: Add createShellTab to preload.ts**

Add after `createTab` in the api object:
```typescript
createShellTab: (shellType: 'powershell' | 'wsl', afterTabId?: string): Promise<Tab> =>
  ipcRenderer.invoke('tab:createShell', shellType, afterTabId),
```

**Step 6: Verify TypeScript compiles**

Run: `npx tsc --noEmit 2>&1 | head -20`
Expected: Remaining errors only in renderer files (not yet updated)

**Step 7: Commit**

```bash
git add src/main/index.ts src/preload.ts
git commit -m "feat: add shell tab IPC handler and preload API"
```

---

### Task 5: Update Tab Component with Shell Styling and Chevron

**Files:**
- Modify: `src/renderer/components/Tab.tsx`
- Modify: `src/renderer/components/TabIndicator.tsx`
- Modify: `src/renderer/index.css`

**Step 1: Update TabIndicator to handle 'shell' status**

Add to the switch in `TabIndicator.tsx`. Import `TerminalSquare` from lucide-react:
```typescript
import { Circle, Loader2, CheckCircle2, MessageCircle, TerminalSquare } from 'lucide-react';
```

Add case before the closing brace:
```typescript
case 'shell':
  return (
    <span className="tab-indicator">
      <TerminalSquare size={ICON_SIZE} />
    </span>
  );
```

**Step 2: Add shell icon components to Tab.tsx**

Import icons and add type-specific icon rendering. Update imports:
```typescript
import type { Tab as TabType, TabType as ShellType } from '../../shared/types';
import TabIndicator from './TabIndicator';
```

Add a chevron dropdown and shell-specific icons. Replace the `Tab` component's props to accept new callbacks:
```typescript
interface TabProps {
  tab: TabType;
  isActive: boolean;
  onClick: () => void;
  onClose: () => void;
  onRename: (name: string) => void;
  onOpenShell?: (shellType: 'powershell' | 'wsl') => void;
}
```

Add the chevron dropdown state and rendering inside the component (after `handleCloseClick`):
```typescript
const [showChevron, setShowChevron] = useState(false);
const chevronRef = useRef<HTMLDivElement>(null);

// Close chevron dropdown on outside click
useEffect(() => {
  if (!showChevron) return;
  const handler = (e: MouseEvent) => {
    if (chevronRef.current && !chevronRef.current.contains(e.target as Node)) {
      setShowChevron(false);
    }
  };
  document.addEventListener('mousedown', handler);
  return () => document.removeEventListener('mousedown', handler);
}, [showChevron]);

const handleChevronClick = (e: React.MouseEvent) => {
  e.stopPropagation();
  setShowChevron(!showChevron);
};

const handleOpenShell = (shellType: 'powershell' | 'wsl') => {
  setShowChevron(false);
  onOpenShell?.(shellType);
};
```

Update the return JSX — add chevron for Claude tabs, distinct styling for shell tabs:
```tsx
const isShell = tab.type !== 'claude';
const shellClass = isShell ? `tab-shell tab-shell-${tab.type}` : '';

return (
  <div
    ref={tabRef}
    className={`tab ${isActive ? 'tab-active' : ''} ${statusClass} ${shellClass}`}
    onClick={onClick}
    onDoubleClick={handleDoubleClick}
  >
    <TabIndicator status={tab.status} />
    {isRenaming ? (
      <input
        ref={inputRef}
        className="tab-rename-input"
        value={renameValue}
        onChange={(e) => setRenameValue(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={commitRename}
      />
    ) : (
      <span className="tab-name">{tab.name}</span>
    )}
    {tab.worktree && (
      <span className="tab-worktree">[{tab.worktree}]</span>
    )}
    {/* Chevron dropdown for Claude tabs */}
    {tab.type === 'claude' && onOpenShell && (
      <div className="tab-chevron-wrapper" ref={chevronRef}>
        <button
          className="tab-chevron"
          onClick={handleChevronClick}
          title="Open shell here"
        >
          ▾
        </button>
        {showChevron && (
          <div className="tab-chevron-dropdown">
            <button
              className="tab-chevron-item"
              onClick={() => handleOpenShell('powershell')}
            >
              PowerShell here
            </button>
            <button
              className="tab-chevron-item"
              onClick={() => handleOpenShell('wsl')}
            >
              WSL here
            </button>
          </div>
        )}
      </div>
    )}
    <button className="tab-close" onClick={handleCloseClick} title="Close tab">
      &times;
    </button>
  </div>
);
```

**Step 3: Add CSS for shell tabs and chevron dropdown**

Add to `src/renderer/index.css`:
```css
/* Shell tab styling */
.tab-shell { border-top: 2px solid transparent; }
.tab-shell-powershell { border-top-color: #012456; }
.tab-shell-wsl { border-top-color: #e95420; }
.tab-status-shell .tab-indicator { color: #569cd6; }

/* Tab chevron dropdown */
.tab-chevron-wrapper { position: relative; }
.tab-chevron {
  background: none; border: none; color: #808080;
  cursor: pointer; font-size: 12px; padding: 0 2px;
  -webkit-app-region: no-drag;
}
.tab-chevron:hover { color: #fff; }
.tab-chevron-dropdown {
  position: absolute; top: 100%; left: 0;
  background: #252526; border: 1px solid #3c3c3c; border-radius: 4px;
  min-width: 160px; padding: 4px 0; z-index: 50;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
}
.tab-chevron-item {
  display: block; width: 100%; padding: 6px 12px;
  background: none; border: none; color: #d4d4d4;
  font-size: 12px; cursor: pointer; text-align: left;
}
.tab-chevron-item:hover { background: #2a2d2e; }
```

**Step 4: Commit**

```bash
git add src/renderer/components/Tab.tsx src/renderer/components/TabIndicator.tsx src/renderer/index.css
git commit -m "feat: add shell tab styling, chevron dropdown, and shell indicator"
```

---

### Task 6: Replace [+] Button with Dropdown Menu

**Files:**
- Modify: `src/renderer/components/TabBar.tsx`
- Modify: `src/renderer/index.css`

**Step 1: Update TabBar props and add dropdown**

```tsx
import { useEffect, useRef, useState } from 'react';
import type { Tab as TabType } from '../../shared/types';
import Tab from './Tab';
import HamburgerMenu from './HamburgerMenu';

interface TabBarProps {
  tabs: TabType[];
  activeTabId: string | null;
  onSelectTab: (tabId: string) => void;
  onCloseTab: (tabId: string) => void;
  onRenameTab: (tabId: string, name: string) => void;
  onNewClaudeTab: () => void;
  onNewWorktreeTab: () => void;
  onNewShellTab: (shellType: 'powershell' | 'wsl', afterTabId?: string) => void;
  worktreeCount: number;
  onManageWorktrees: () => void;
}

export default function TabBar({
  tabs,
  activeTabId,
  onSelectTab,
  onCloseTab,
  onRenameTab,
  onNewClaudeTab,
  onNewWorktreeTab,
  onNewShellTab,
  worktreeCount,
  onManageWorktrees,
}: TabBarProps) {
  const [showNewTabMenu, setShowNewTabMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showNewTabMenu) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowNewTabMenu(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showNewTabMenu]);

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
          onOpenShell={(shellType) => onNewShellTab(shellType, tab.id)}
        />
      ))}
      <div className="new-tab-menu" ref={menuRef}>
        <button
          className="new-tab-btn"
          onClick={() => setShowNewTabMenu(!showNewTabMenu)}
          title="New tab"
        >
          +
        </button>
        {showNewTabMenu && (
          <div className="new-tab-dropdown">
            <button
              className="new-tab-item"
              onClick={() => { setShowNewTabMenu(false); onNewClaudeTab(); }}
            >
              <span>Claude Tab</span>
              <span className="new-tab-shortcut">Ctrl+T</span>
            </button>
            <button
              className="new-tab-item"
              onClick={() => { setShowNewTabMenu(false); onNewWorktreeTab(); }}
            >
              <span>Claude Worktree</span>
              <span className="new-tab-shortcut">Ctrl+W</span>
            </button>
            <div className="new-tab-separator" />
            <button
              className="new-tab-item"
              onClick={() => { setShowNewTabMenu(false); onNewShellTab('powershell'); }}
            >
              <span>PowerShell</span>
              <span className="new-tab-shortcut">Ctrl+P</span>
            </button>
            <button
              className="new-tab-item"
              onClick={() => { setShowNewTabMenu(false); onNewShellTab('wsl'); }}
            >
              <span>WSL</span>
              <span className="new-tab-shortcut">Ctrl+L</span>
            </button>
          </div>
        )}
      </div>
      <HamburgerMenu worktreeCount={worktreeCount} onManageWorktrees={onManageWorktrees} />
    </div>
  );
}
```

**Step 2: Add CSS for new tab dropdown**

Add to `src/renderer/index.css`:
```css
/* New tab dropdown menu */
.new-tab-menu { position: relative; -webkit-app-region: no-drag; }
.new-tab-dropdown {
  position: absolute; top: 100%; left: 0;
  background: #252526; border: 1px solid #3c3c3c; border-radius: 6px;
  min-width: 200px; padding: 4px 0; z-index: 50;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
}
.new-tab-item {
  display: flex; align-items: center; justify-content: space-between;
  width: 100%; padding: 8px 12px; background: none; border: none;
  color: #d4d4d4; font-size: 13px; cursor: pointer; text-align: left;
}
.new-tab-item:hover { background: #2a2d2e; }
.new-tab-shortcut { font-size: 11px; color: #808080; }
.new-tab-separator { height: 1px; background: #3c3c3c; margin: 4px 8px; }
```

**Step 3: Commit**

```bash
git add src/renderer/components/TabBar.tsx src/renderer/index.css
git commit -m "feat: replace [+] button with dropdown menu for tab types"
```

---

### Task 7: Wire Up App.tsx with Shell Tab Handlers and Shortcuts

**Files:**
- Modify: `src/renderer/App.tsx`

**Step 1: Add shell tab handler**

Add after `handleNewTabWithoutWorktree`:
```typescript
const handleNewShellTab = async (shellType: 'powershell' | 'wsl', afterTabId?: string) => {
  const tab = await window.claudeTerminal.createShellTab(shellType, afterTabId);
  setActiveTabId(tab.id);
};
```

**Step 2: Add keyboard shortcuts for Ctrl+P and Ctrl+L**

In the keyboard handler (inside the `useEffect`), add before the `Ctrl+F4` block:
```typescript
// Ctrl+P: new PowerShell tab
if (e.ctrlKey && e.key === 'p') {
  e.preventDefault();
  handleNewShellTab('powershell');
  return;
}

// Ctrl+L: new WSL tab
if (e.ctrlKey && e.key === 'l') {
  e.preventDefault();
  handleNewShellTab('wsl');
  return;
}
```

**Step 3: Update TabBar props**

Replace the `onNewTab` prop with the new props:
```tsx
<TabBar
  tabs={tabs}
  activeTabId={activeTabId}
  onSelectTab={handleSelectTab}
  onCloseTab={handleCloseTab}
  onRenameTab={handleRenameTab}
  onNewClaudeTab={handleNewTabWithoutWorktree}
  onNewWorktreeTab={() => setShowWorktreeDialog(true)}
  onNewShellTab={handleNewShellTab}
  worktreeCount={worktreeCount}
  onManageWorktrees={() => setShowWorktreeManager(true)}
/>
```

**Step 4: Remove NewTabDialog usage**

Remove the `showNewTabDialog` state and `NewTabDialog` component entirely. The [+] dropdown replaces it. Remove the import of `NewTabDialog`. Update the auto-start and startup flows: where they did `setShowNewTabDialog(true)` when no tabs exist, instead auto-create a Claude tab:
```typescript
// Replace: setShowNewTabDialog(true);
// With:
handleNewTabWithoutWorktree();
```

Do this in both the `useEffect` (line 57) and `handleStartSession` (line 212).

**Step 5: Verify build compiles**

Run: `npx tsc --noEmit`
Expected: Clean compile

**Step 6: Commit**

```bash
git add src/renderer/App.tsx
git commit -m "feat: wire shell tab handlers and keyboard shortcuts into App"
```

---

### Task 8: Fix createTab Call Sites for New Signature

**Files:**
- Modify: `src/main/index.ts` (the existing `tab:create` handler)

**Step 1: Update tab:create handler**

The `tabManager.createTab()` now has a third parameter `type`. The existing call at line 358 needs updating:
```typescript
const tab = tabManager.createTab(cwd, worktreeName, 'claude', savedName);
```

**Step 2: Verify full build**

Run: `npm run build 2>&1 | tail -20`
Expected: Clean build

**Step 3: Commit**

```bash
git add src/main/index.ts
git commit -m "fix: update createTab call site for new type parameter"
```

---

### Task 9: Manual Testing

**Step 1: Start the app**

Run: `npm start`

**Step 2: Test [+] dropdown**

- Click [+] → verify dropdown appears with Claude Tab, Claude Worktree, separator, PowerShell, WSL
- Click "PowerShell" → verify a PS tab opens with PS prompt
- Click "WSL" → verify a WSL tab opens with bash prompt

**Step 3: Test keyboard shortcuts**

- Ctrl+T → new Claude tab
- Ctrl+W → worktree name dialog
- Ctrl+P → new PowerShell tab
- Ctrl+L → new WSL tab

**Step 4: Test chevron on Claude tabs**

- Hover over a Claude tab → verify ▾ chevron is visible
- Click ▾ → verify dropdown with "PowerShell here" and "WSL here"
- Click "PowerShell here" → verify tab opens next to the Claude tab with same cwd
- Verify shell tabs do NOT have a chevron

**Step 5: Test tab closing**

- Close a shell tab → verify it's removed
- Verify closing a shell tab doesn't try to remove a worktree
- Verify shell tabs don't appear in saved sessions on restart

**Step 6: Commit any fixes**

```bash
git add -A
git commit -m "fix: manual testing fixes for shell tabs"
```
