// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { execSync } from 'child_process';

vi.mock('child_process', () => ({
  execSync: vi.fn(),
}));

import { WorktreeManager } from '@main/worktree-manager';

describe('WorktreeManager.listDetails', () => {
  let manager: WorktreeManager;
  const mockExecSync = vi.mocked(execSync);

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new WorktreeManager('/fake/root');
  });

  it('returns empty array when only main worktree exists', () => {
    mockExecSync.mockReturnValueOnce(Buffer.from(
      '/fake/root  abc1234 [master]\n'
    ));
    const result = manager.listDetails();
    expect(result).toEqual([]);
  });

  it('returns details for non-main worktrees', () => {
    mockExecSync.mockReturnValueOnce(Buffer.from(
      '/fake/root  abc1234 [master]\n/fake/root/.claude/worktrees/feat-a  def5678 [feat-a]\n'
    ));
    mockExecSync.mockReturnValueOnce(Buffer.from(''));

    const result = manager.listDetails();
    expect(result).toEqual([
      { name: 'feat-a', path: '/fake/root/.claude/worktrees/feat-a', clean: true, changesCount: 0 },
    ]);
  });

  it('reports dirty worktree with change count', () => {
    mockExecSync.mockReturnValueOnce(Buffer.from(
      '/fake/root  abc1234 [master]\n/fake/root/.claude/worktrees/bugfix  aaa1111 [bugfix]\n'
    ));
    mockExecSync.mockReturnValueOnce(Buffer.from(' M file1.ts\n M file2.ts\n?? file3.ts\n'));

    const result = manager.listDetails();
    expect(result).toEqual([
      { name: 'bugfix', path: '/fake/root/.claude/worktrees/bugfix', clean: false, changesCount: 3 },
    ]);
  });

  it('handles multiple worktrees', () => {
    mockExecSync.mockReturnValueOnce(Buffer.from(
      '/fake/root  abc [master]\n/fake/root/.claude/worktrees/a  def [a]\n/fake/root/.claude/worktrees/b  ghi [b]\n'
    ));
    mockExecSync.mockReturnValueOnce(Buffer.from(''));
    mockExecSync.mockReturnValueOnce(Buffer.from(' M x.ts\n'));

    const result = manager.listDetails();
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ name: 'a', clean: true, changesCount: 0 });
    expect(result[1]).toMatchObject({ name: 'b', clean: false, changesCount: 1 });
  });
});
