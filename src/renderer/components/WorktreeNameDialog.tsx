import { useEffect, useState } from 'react';

// Must be a valid git branch name: no spaces, no .., no control chars,
// no ~^:?\*[, can't start/end with dot or slash, no consecutive dots/slashes.
function validateWorktreeName(name: string): string | null {
  if (!name) return null;
  if (/\s/.test(name)) return 'Name cannot contain spaces';
  if (/\.\./.test(name)) return 'Name cannot contain ".."';
  if (/\/\//.test(name)) return 'Name cannot contain consecutive slashes';
  if (/[~^:?*\[\]\\]/.test(name)) return 'Name contains invalid characters';
  if (name.startsWith('.') || name.startsWith('/')) return 'Name cannot start with "." or "/"';
  if (name.endsWith('.') || name.endsWith('/') || name.endsWith('.lock')) return 'Invalid ending';
  return null;
}

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

  const validationError = validateWorktreeName(worktreeName.trim());
  const canSubmit = worktreeName.trim() && !validationError;

  const handleSubmit = () => {
    if (canSubmit) onCreateWithWorktree(worktreeName.trim());
  };

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
              if (e.key === 'Enter') handleSubmit();
            }}
          />
        </label>
        {validationError && (
          <div className="validation-error">{validationError}</div>
        )}
        {currentBranch && (
          <div className="branch-info">
            Base branch: {currentBranch}
          </div>
        )}
        <div className="dialog-actions">
          <button
            disabled={!canSubmit}
            onClick={handleSubmit}
          >
            Create
          </button>
          <button onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
