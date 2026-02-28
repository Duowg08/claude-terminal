import { execSync, execFileSync, spawn } from 'child_process';
import path from 'path';

export interface WorktreeInfo {
  path: string;
  branch: string;
}

export interface WorktreeDetails {
  name: string;
  path: string;
  clean: boolean;
  changesCount: number;
}

export class WorktreeManager {
  private rootDir: string;

  constructor(rootDir: string) {
    this.rootDir = rootDir;
  }

  getCurrentBranch(): string {
    const result = execSync('git rev-parse --abbrev-ref HEAD', {
      cwd: this.rootDir,
      encoding: 'utf-8',
    });
    return String(result).trim();
  }

  create(name: string): string {
    const worktreePath = path.join(this.rootDir, '.claude', 'worktrees', name);
    const branch = this.getCurrentBranch();
    execFileSync(
      'git',
      ['worktree', 'add', worktreePath, '-b', name, branch],
      { cwd: this.rootDir, encoding: 'utf-8' },
    );
    return worktreePath;
  }

  createAsync(name: string, onOutput: (text: string) => void): Promise<string> {
    const worktreePath = path.join(this.rootDir, '.claude', 'worktrees', name);
    const branch = this.getCurrentBranch();

    return new Promise((resolve, reject) => {
      const proc = spawn(
        'git',
        ['worktree', 'add', worktreePath, '-b', name, branch],
        { cwd: this.rootDir },
      );

      proc.stdout.on('data', (data: Buffer) => onOutput(data.toString()));
      proc.stderr.on('data', (data: Buffer) => onOutput(data.toString()));

      proc.on('error', (err) => {
        reject(new Error(`Failed to spawn git: ${err.message}`));
      });

      proc.on('close', (code) => {
        if (code === 0) {
          resolve(worktreePath);
        } else {
          reject(new Error(`git worktree add failed with exit code ${code}`));
        }
      });
    });
  }

  checkStatus(worktreePath: string): { clean: boolean; changesCount: number } {
    let statusOutput = '';
    try {
      statusOutput = String(
        execSync('git status --porcelain', { cwd: worktreePath, encoding: 'utf-8' })
      );
    } catch {
      // worktree may be in a broken state
    }
    const lines = statusOutput.trim().split('\n').filter(Boolean);
    return { clean: lines.length === 0, changesCount: lines.length };
  }

  remove(worktreePath: string): void {
    // Derive the branch name from the worktree directory name
    const branchName = path.basename(worktreePath);
    execFileSync(
      'git',
      ['worktree', 'remove', worktreePath, '--force'],
      { cwd: this.rootDir, encoding: 'utf-8' },
    );
    try {
      execFileSync('git', ['branch', '-D', branchName], { cwd: this.rootDir, encoding: 'utf-8' });
    } catch {
      // branch may not exist or may have been merged
    }
  }

  private list(): WorktreeInfo[] {
    const result = execSync('git worktree list', {
      cwd: this.rootDir,
      encoding: 'utf-8',
    });
    const output = String(result);
    return output
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line: string) => {
        const match = line.match(/^(.+?)\s+\w+\s+\[(.+?)\]/);
        return match
          ? { path: match[1].trim(), branch: match[2] }
          : { path: line.trim(), branch: 'unknown' };
      });
  }

  listDetails(): WorktreeDetails[] {
    const worktrees = this.list();
    // Skip first entry (main worktree)
    return worktrees.slice(1).map((wt) => {
      const name = path.basename(wt.path);
      let statusOutput = '';
      try {
        statusOutput = String(
          execSync('git status --porcelain', { cwd: wt.path, encoding: 'utf-8' })
        );
      } catch {
        // worktree may be in a broken state
      }
      const lines = statusOutput.trim().split('\n').filter(Boolean);
      return {
        name,
        path: wt.path,
        clean: lines.length === 0,
        changesCount: lines.length,
      };
    });
  }
}
