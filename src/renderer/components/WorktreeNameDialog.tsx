import { useEffect, useState } from 'react';

interface WorktreeNameDialogProps {
  onCreateWithWorktree: (name: string) => void;
  onCancel: () => void;
}

export default function WorktreeNameDialog({
  onCreateWithWorktree,
  onCancel,
}: WorktreeNameDialogProps) {
  const [worktreeName, setWorktreeName] = useState('');
  const [currentBranch, setCurrentBranch] = useState('');

  useEffect(() => {
    window.claudeTerminal.getCurrentBranch().then(setCurrentBranch).catch(() => {
      setCurrentBranch('unknown');
    });
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onCancel();
    }
  };

  return (
    <div className="dialog-overlay" onKeyDown={handleKeyDown}>
      <div className="dialog">
        <h2>Create Worktree Tab</h2>
        <label>
          Worktree name:
          <input
            type="text"
            value={worktreeName}
            onChange={(e) => setWorktreeName(e.target.value)}
            placeholder="feature-name"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter' && worktreeName.trim()) {
                onCreateWithWorktree(worktreeName.trim());
              }
            }}
          />
        </label>
        {currentBranch && (
          <div className="branch-info">
            Base branch: {currentBranch}
          </div>
        )}
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
