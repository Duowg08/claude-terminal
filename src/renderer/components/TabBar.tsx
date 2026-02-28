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
