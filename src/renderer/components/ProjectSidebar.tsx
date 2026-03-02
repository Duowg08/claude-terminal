import { useState, useCallback } from 'react';
import { PROJECT_COLORS, type ProjectConfig } from '../../shared/types';
import { cn } from '@/lib/utils';

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
  onRemoveProject: (id: string) => void;
  onRenameProject: (id: string, name: string) => void;
  onToggleCollapse: () => void;
}

export default function ProjectSidebar({
  projects, activeProjectId, tabCounts, collapsed,
  onSelectProject, onAddProject, onRemoveProject, onRenameProject, onToggleCollapse,
}: Props) {
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [contextMenuId, setContextMenuId] = useState<string | null>(null);
  const [contextMenuPos, setContextMenuPos] = useState<{ x: number; y: number } | null>(null);

  const handleContextMenu = useCallback((e: React.MouseEvent, projectId: string) => {
    e.preventDefault();
    setContextMenuId(projectId);
    setContextMenuPos({ x: e.clientX, y: e.clientY });
  }, []);

  const closeContextMenu = useCallback(() => {
    setContextMenuId(null);
    setContextMenuPos(null);
  }, []);

  const startRename = useCallback((projectId: string, currentName: string) => {
    setRenamingId(projectId);
    setRenameValue(currentName);
    closeContextMenu();
  }, [closeContextMenu]);

  const commitRename = useCallback(() => {
    if (renamingId && renameValue.trim()) {
      onRenameProject(renamingId, renameValue.trim());
    }
    setRenamingId(null);
  }, [renamingId, renameValue, onRenameProject]);

  return (
    <div
      className={cn(
        'flex flex-col bg-[#181818] border-r border-border shrink-0 overflow-hidden',
        collapsed ? 'w-6' : 'w-[200px]',
      )}
      onClick={() => { if (contextMenuId) closeContextMenu(); }}
    >
      {/* Collapse toggle */}
      <button
        className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-accent text-xs border-b border-border flex items-center justify-center"
        onClick={onToggleCollapse}
        title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      >
        <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
          {collapsed
            ? <path d="M3 1 L8 5 L3 9" fill="none" stroke="currentColor" strokeWidth="1.5" />
            : <path d="M7 1 L2 5 L7 9" fill="none" stroke="currentColor" strokeWidth="1.5" />
          }
        </svg>
      </button>

      {/* Project list */}
      <div className="flex-1 overflow-y-auto flex flex-col">
        {projects.map((project) => {
          const dirName = project.displayName ?? project.dir.split(/[/\\]/).pop() ?? project.dir;
          const counts = tabCounts[project.id] ?? { idle: 0, working: 0, requires_response: 0, total: 0 };
          const isActive = project.id === activeProjectId;
          const hue = PROJECT_COLORS[project.colorIndex % PROJECT_COLORS.length].hue;
          const isRenaming = renamingId === project.id;

          return (
            <button
              key={project.id}
              data-active={isActive}
              className={cn(
                'flex items-center justify-between gap-1.5 px-4 py-2 border-none border-l-[3px] border-l-transparent',
                'text-muted-foreground cursor-pointer text-left text-xs font-inherit',
                isActive && 'text-foreground',
                collapsed && '[writing-mode:vertical-lr] whitespace-nowrap px-3 py-2 text-[11px]',
              )}
              style={{
                backgroundColor: isActive ? `hsl(${hue} 45% 30%)` : `hsl(${hue} 20% 15%)`,
                borderLeftColor: isActive ? `hsl(${hue} 60% 50%)` : 'transparent',
              }}
              onClick={() => onSelectProject(project.id)}
              onContextMenu={(e) => handleContextMenu(e, project.id)}
              onDoubleClick={(e) => {
                e.preventDefault();
                startRename(project.id, dirName);
              }}
            >
              {isRenaming ? (
                <input
                  className="bg-transparent border border-border text-foreground text-xs px-1 py-0 w-full outline-none"
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onBlur={commitRename}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitRename();
                    if (e.key === 'Escape') setRenamingId(null);
                    e.stopPropagation();
                  }}
                  onClick={(e) => e.stopPropagation()}
                  autoFocus
                />
              ) : (
                <span className="overflow-hidden text-ellipsis whitespace-nowrap">{dirName}</span>
              )}
              {!collapsed && !isRenaming && (
                <span className="flex gap-1 text-[10px] shrink-0">
                  {counts.working > 0 && (
                    <span className="text-warning" data-count-working>{counts.working}</span>
                  )}
                  {counts.requires_response > 0 && (
                    <span className="text-attention" data-count-response>{counts.requires_response}</span>
                  )}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Add project button */}
      <button
        className="bg-transparent border-none border-t border-border text-muted-foreground text-lg p-2 cursor-pointer hover:text-foreground hover:bg-accent"
        onClick={onAddProject}
        title="Add project"
      >
        +
      </button>

      {/* Context menu */}
      {contextMenuId && contextMenuPos && (
        <div
          className="fixed z-50 bg-card border border-border rounded shadow-lg py-1 min-w-[140px]"
          style={{ left: contextMenuPos.x, top: contextMenuPos.y }}
        >
          <button
            className="w-full text-left px-3 py-1.5 text-xs text-foreground hover:bg-accent bg-transparent border-none cursor-pointer font-inherit"
            onClick={() => {
              const project = projects.find(p => p.id === contextMenuId);
              if (project) {
                const name = project.displayName ?? project.dir.split(/[/\\]/).pop() ?? project.dir;
                startRename(contextMenuId, name);
              }
            }}
          >
            Rename
          </button>
          {projects.length > 1 && (
            <button
              className="w-full text-left px-3 py-1.5 text-xs text-destructive hover:bg-accent bg-transparent border-none cursor-pointer font-inherit"
              onClick={() => {
                onRemoveProject(contextMenuId);
                closeContextMenu();
              }}
            >
              Remove
            </button>
          )}
        </div>
      )}
    </div>
  );
}
