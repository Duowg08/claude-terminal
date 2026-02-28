import { useEffect, useRef, useState } from 'react';
import { SquareTerminal } from 'lucide-react';
import type { Tab as TabType } from '../../shared/types';
import TabIndicator from './TabIndicator';

interface TabProps {
  tab: TabType;
  isActive: boolean;
  onClick: () => void;
  onClose: () => void;
  onRename: (name: string) => void;
  onOpenShell?: (shellType: 'powershell' | 'wsl') => void;
}

export default function Tab({ tab, isActive, onClick, onClose, onRename, onOpenShell }: TabProps) {
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(tab.name);
  const [showChevron, setShowChevron] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const tabRef = useRef<HTMLDivElement>(null);
  const chevronRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isRenaming && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isRenaming]);

  // Listen for F2 rename event (dispatched from App shell)
  useEffect(() => {
    const handler = (e: Event) => {
      const customEvent = e as CustomEvent<{ tabId: string }>;
      if (customEvent.detail.tabId === tab.id) {
        setRenameValue(tab.name);
        setIsRenaming(true);
      }
    };
    window.addEventListener('tab:startRename', handler);
    return () => window.removeEventListener('tab:startRename', handler);
  }, [tab.id, tab.name]);

  // Outside-click handler for chevron dropdown
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

  const commitRename = () => {
    setIsRenaming(false);
    const trimmed = renameValue.trim();
    if (trimmed && trimmed !== tab.name) {
      onRename(trimmed);
    }
  };

  const handleDoubleClick = () => {
    setRenameValue(tab.name);
    setIsRenaming(true);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      commitRename();
    } else if (e.key === 'Escape') {
      setIsRenaming(false);
    }
  };

  const handleCloseClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onClose();
  };

  const handleChevronClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setShowChevron(!showChevron);
  };

  const handleOpenShell = (shellType: 'powershell' | 'wsl') => {
    setShowChevron(false);
    onOpenShell?.(shellType);
  };

  const statusClass = `tab-status-${tab.status}`;
  const shellClass = tab.type !== 'claude' ? `tab-shell tab-shell-${tab.type}` : '';

  return (
    <div
      ref={tabRef}
      className={`tab ${isActive ? 'tab-active' : ''} ${statusClass} ${shellClass}`}
      onClick={onClick}
      onDoubleClick={handleDoubleClick}
    >
      {tab.type === 'claude' ? (
        <TabIndicator status={tab.status} />
      ) : (
        <span className="tab-indicator">
          {tab.type === 'powershell' ? (
            <SquareTerminal size={12} />
          ) : (
            <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M17.9 15a5.87 5.87 0 0 0-1.7-3.3l-.2-.2c-.6-.6-1-1.5-1-2.5V5a3 3 0 1 0-6 0v4a3.74 3.74 0 0 1-1.2 2.8 6.2 6.2 0 0 0-1.7 3.3" />
              <path d="M9 10c-2 4-4-1-7 2" />
              <path d="M9 8.9c3-1.9 6 0 6 0s-2 3.1-3 4c-1-.9-3-4-3-4" />
              <path d="M15 10c2 4 4-1 7 2" />
              <path d="M2 19c0-1 1-1 1-2 0-.6.4-1 1-1 1 0 1-1 2-1 .4 0 .7.2.9.5L8.8 19a2 2 0 0 1-2.7 2.7l-3.5-1.9c-.4-.1-.6-.4-.6-.8" />
              <path d="M8.7 21a6.07 6.07 0 0 0 6.6 0" />
              <path d="M22 19c0-1-1-1-1-2 0-.6-.4-1-1-1-1 0-1-1-2-1-.4 0-.7.2-.9.5L15.2 19a2 2 0 0 0 2.7 2.7l3.5-1.9c.4-.1.6-.4.6-.8" />
            </svg>
          )}
        </span>
      )}
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
      {tab.type === 'claude' && onOpenShell && (
        <div className="tab-chevron-wrapper" ref={chevronRef}>
          <button className="tab-chevron" onClick={handleChevronClick} title="Open shell here">&#9662;</button>
          {showChevron && (
            <div className="tab-chevron-dropdown">
              <button className="tab-chevron-item" onClick={() => handleOpenShell('powershell')}>PowerShell here</button>
              <button className="tab-chevron-item" onClick={() => handleOpenShell('wsl')}>WSL here</button>
            </div>
          )}
        </div>
      )}
      <button className="tab-close" onClick={handleCloseClick} title="Close tab">
        &times;
      </button>
    </div>
  );
}
