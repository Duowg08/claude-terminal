// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import net from 'net';
import { exec } from 'child_process';
import path from 'path';
import { IpcMessage } from '@shared/types';

function execAsync(cmd: string, timeout = 10000): Promise<string> {
  return new Promise((resolve, reject) => {
    exec(cmd, { timeout, shell: 'bash' }, (err, stdout) => {
      if (err && err.killed) {
        reject(new Error(`Command timed out: ${cmd}`));
      } else if (err) {
        reject(err);
      } else {
        resolve(stdout);
      }
    });
  });
}

describe('hook scripts integration', () => {
  // Use forward-slash pipe notation for reliable cross-layer escaping (bash -> node)
  const TEST_PIPE = '//./pipe/claude-terminal-hook-test-' + process.pid;
  let server: net.Server;
  let received: IpcMessage[];

  beforeEach(async () => {
    received = [];
    server = net.createServer((socket) => {
      let buffer = '';
      socket.on('data', (chunk) => {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.trim()) continue;
          try { received.push(JSON.parse(line)); } catch {}
        }
      });
    });
    await new Promise<void>((resolve) => server.listen(TEST_PIPE, resolve));
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('pipe-send.sh sends valid IPC message', async () => {
    const scriptPath = path.resolve('src/hooks/pipe-send.sh').replace(/\\/g, '/');
    await execAsync(`bash "${scriptPath}" "tab-1" "${TEST_PIPE}" "tab:status:working"`);

    // Give the message time to arrive
    await new Promise(resolve => setTimeout(resolve, 500));
    expect(received.length).toBeGreaterThanOrEqual(1);
    expect(received[0].tabId).toBe('tab-1');
    expect(received[0].event).toBe('tab:status:working');
  });
});
