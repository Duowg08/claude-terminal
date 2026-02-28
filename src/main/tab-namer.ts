import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getClaudeCommand } from '@shared/claude-cli';
import { log } from './logger';
import type { TabManager } from './tab-manager';

export interface TabNamerDeps {
  tabManager: TabManager;
  sendToRenderer: (channel: string, ...args: unknown[]) => void;
  persistSessions: () => void;
}

export function createTabNamer(deps: TabNamerDeps) {
  function cleanupNamingFlag(tabId: string) {
    const flagFile = path.join(os.tmpdir(), `claude-terminal-named-${tabId}`);
    try { fs.unlinkSync(flagFile); } catch { /* best-effort */ }
  }

  function generateTabName(tabId: string, prompt: string) {
    log.debug('[generateTabName] starting for tab', tabId, 'prompt:', prompt.substring(0, 80));
    const namePrompt = `Generate a short tab title (3-5 words) for a coding conversation that starts with this message. Reply with ONLY the title, no quotes, no punctuation:\n\n${prompt}`;

    const { command: cmd, args: baseArgs } = getClaudeCommand([
      '-p', '--no-session-persistence', '--model', 'claude-haiku-4-5-20251001',
    ]);

    log.debug('[generateTabName] spawning:', cmd, baseArgs.join(' '));
    const isWindows = process.platform === 'win32';
    const child = execFile(cmd, baseArgs, { timeout: 30000 }, (err, stdout, stderr) => {
      if (err) {
        log.error('[generateTabName] FAILED:', err.message);
        log.error('[generateTabName] stderr:', stderr);
        if (child.pid) {
          if (isWindows) {
            try { execFile('taskkill', ['/pid', String(child.pid), '/T', '/F']); } catch { /* best effort */ }
          } else {
            child.kill('SIGKILL');
          }
        }
        return;
      }
      log.debug('[generateTabName] stdout:', JSON.stringify(stdout));

      const name = stdout.trim().replace(/^["']|["']$/g, '').substring(0, 50);
      if (!name) return;

      const tab = deps.tabManager.getTab(tabId);
      if (!tab) return;

      deps.tabManager.rename(tabId, name);
      const updated = deps.tabManager.getTab(tabId);
      if (updated) {
        deps.sendToRenderer('tab:updated', updated);
        deps.persistSessions();
      }
    });

    child.stdin?.write(namePrompt);
    child.stdin?.end();
  }

  return { generateTabName, cleanupNamingFlag };
}
