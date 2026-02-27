// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import path from 'path';
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
    expect(result).toContain(path.join('feature', 'auth'));
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
