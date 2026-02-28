// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import path from 'path';
import { execSync, spawn } from 'child_process';

vi.mock('child_process', () => ({
  execSync: vi.fn(),
  spawn: vi.fn(),
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

  it('checkStatus returns clean for worktree with no changes', () => {
    mockExecSync.mockReturnValue(Buffer.from(''));
    const status = manager.checkStatus('D:\\dev\\MyApp\\.claude\\worktrees\\feat');
    expect(status.clean).toBe(true);
    expect(status.changesCount).toBe(0);
  });

  it('checkStatus returns dirty for worktree with changes', () => {
    mockExecSync.mockReturnValue(Buffer.from('M  src/index.ts\n?? new-file.ts\n'));
    const status = manager.checkStatus('D:\\dev\\MyApp\\.claude\\worktrees\\feat');
    expect(status.clean).toBe(false);
    expect(status.changesCount).toBe(2);
  });

  it('removes a worktree', () => {
    mockExecSync.mockReturnValue(Buffer.from(''));
    manager.remove('feature/auth');
    expect(mockExecSync).toHaveBeenCalledWith(
      expect.stringContaining('git worktree remove'),
      expect.anything(),
    );
  });

  it('lists worktree details (skipping main worktree)', () => {
    mockExecSync
      .mockReturnValueOnce(Buffer.from(
        'D:/dev/MyApp  abc1234 [main]\nD:/dev/MyApp/.claude/worktrees/feat  def5678 [feat]\n'
      ))  // list() via listDetails()
      .mockReturnValueOnce(Buffer.from('M  src/index.ts\n'));  // git status --porcelain for feat
    const details = manager.listDetails();
    expect(details).toHaveLength(1);
    expect(details[0].name).toBe('feat');
    expect(details[0].clean).toBe(false);
    expect(details[0].changesCount).toBe(1);
  });

  describe('createAsync', () => {
    const mockSpawn = vi.mocked(spawn);

    it('resolves with worktree path on success', async () => {
      mockExecSync.mockReturnValueOnce(Buffer.from('main\n')); // getCurrentBranch

      const mockProc = {
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        on: vi.fn(),
      };
      mockSpawn.mockReturnValue(mockProc as any);

      const onOutput = vi.fn();
      const promise = manager.createAsync('my-feature', onOutput);

      // Simulate stdout output
      const stdoutCb = mockProc.stdout.on.mock.calls[0][1];
      stdoutCb(Buffer.from('Preparing worktree'));

      // Simulate successful close
      const closeCb = mockProc.on.mock.calls.find((c: any) => c[0] === 'close')![1];
      closeCb(0);

      const result = await promise;
      expect(result).toContain(path.join('.claude', 'worktrees', 'my-feature'));
      expect(onOutput).toHaveBeenCalledWith('Preparing worktree');
      expect(mockSpawn).toHaveBeenCalledWith(
        'git',
        expect.arrayContaining(['worktree', 'add']),
        expect.objectContaining({ cwd: 'D:\\dev\\MyApp' }),
      );
    });

    it('rejects when git exits with non-zero code', async () => {
      mockExecSync.mockReturnValueOnce(Buffer.from('main\n'));

      const mockProc = {
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        on: vi.fn(),
      };
      mockSpawn.mockReturnValue(mockProc as any);

      const onOutput = vi.fn();
      const promise = manager.createAsync('bad-name', onOutput);

      const closeCb = mockProc.on.mock.calls.find((c: any) => c[0] === 'close')![1];
      closeCb(128);

      await expect(promise).rejects.toThrow('git worktree add failed with exit code 128');
    });

    it('rejects when spawn fails', async () => {
      mockExecSync.mockReturnValueOnce(Buffer.from('main\n'));

      const mockProc = {
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        on: vi.fn(),
      };
      mockSpawn.mockReturnValue(mockProc as any);

      const onOutput = vi.fn();
      const promise = manager.createAsync('feat', onOutput);

      const errorCb = mockProc.on.mock.calls.find((c: any) => c[0] === 'error')![1];
      errorCb(new Error('ENOENT'));

      await expect(promise).rejects.toThrow('Failed to spawn git: ENOENT');
    });
  });
});
