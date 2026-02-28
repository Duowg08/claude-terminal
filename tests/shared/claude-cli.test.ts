import { describe, it, expect } from 'vitest';
import { getClaudeCommand } from '@shared/claude-cli';

describe('getClaudeCommand', () => {
  it('returns command and args with flags', () => {
    const result = getClaudeCommand(['--dangerously-skip-permissions']);
    const isWindows = process.platform === 'win32';

    if (isWindows) {
      expect(result.command).toBe('cmd.exe');
      expect(result.args).toEqual(['/c', 'claude', '--dangerously-skip-permissions']);
    } else {
      expect(result.command).toBe('claude');
      expect(result.args).toEqual(['--dangerously-skip-permissions']);
    }
  });

  it('returns command with empty flags', () => {
    const result = getClaudeCommand([]);
    const isWindows = process.platform === 'win32';

    if (isWindows) {
      expect(result.command).toBe('cmd.exe');
      expect(result.args).toEqual(['/c', 'claude']);
    } else {
      expect(result.command).toBe('claude');
      expect(result.args).toEqual([]);
    }
  });

  it('preserves multiple flags in order', () => {
    const result = getClaudeCommand(['-p', '--model', 'claude-haiku-4-5-20251001']);
    const isWindows = process.platform === 'win32';

    if (isWindows) {
      expect(result.args).toEqual(['/c', 'claude', '-p', '--model', 'claude-haiku-4-5-20251001']);
    } else {
      expect(result.args).toEqual(['-p', '--model', 'claude-haiku-4-5-20251001']);
    }
  });
});
