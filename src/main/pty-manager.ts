import * as pty from 'node-pty';

interface ManagedPty {
  process: pty.IPty;
  tabId: string;
}

export class PtyManager {
  private ptys = new Map<string, ManagedPty>();

  spawn(
    tabId: string,
    cwd: string,
    args: string[],
    extraEnv: Record<string, string>,
  ): pty.IPty {
    const shell = 'claude';
    const env = { ...process.env, ...extraEnv } as Record<string, string>;

    const proc = pty.spawn(shell, args, {
      name: 'xterm-256color',
      cols: 120,
      rows: 40,
      cwd,
      env,
    });

    this.ptys.set(tabId, { process: proc, tabId });
    return proc;
  }

  getPty(tabId: string): pty.IPty | undefined {
    return this.ptys.get(tabId)?.process;
  }

  write(tabId: string, data: string): void {
    this.ptys.get(tabId)?.process.write(data);
  }

  resize(tabId: string, cols: number, rows: number): void {
    this.ptys.get(tabId)?.process.resize(cols, rows);
  }

  kill(tabId: string): void {
    const managed = this.ptys.get(tabId);
    if (!managed) return;
    managed.process.write('exit\r');
    this.ptys.delete(tabId);
    setTimeout(() => {
      try { managed.process.kill(); } catch { /* already dead */ }
    }, 500);
  }

  killAll(): void {
    for (const tabId of this.ptys.keys()) {
      this.kill(tabId);
    }
  }
}
