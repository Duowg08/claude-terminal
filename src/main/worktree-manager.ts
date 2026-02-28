import { execSync } from 'child_process';
import path from 'path';

export interface WorktreeInfo {
  path: string;
  branch: string;
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
    execSync(
      `git worktree add "${worktreePath}" -b "${name}" "${branch}"`,
      { cwd: this.rootDir, encoding: 'utf-8' },
    );
    return worktreePath;
  }

  remove(worktreePath: string): void {
    // Derive the branch name from the worktree directory name
    const branchName = path.basename(worktreePath);
    execSync(
      `git worktree remove "${worktreePath}" --force`,
      { cwd: this.rootDir, encoding: 'utf-8' },
    );
    try {
      execSync(`git branch -D "${branchName}"`, { cwd: this.rootDir, encoding: 'utf-8' });
    } catch {
      // branch may not exist or may have been merged
    }
  }

  list(): WorktreeInfo[] {
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
}
