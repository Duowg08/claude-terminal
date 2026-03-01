import fs from 'node:fs';
import https from 'node:https';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { app } from 'electron';
import { log } from './logger';

// Types re-declared here to avoid import issues with cloudflared's .d.ts
interface CloudflaredConnection {
  id: string;
  ip: string;
  location: string;
}

export interface TunnelManagerEvents {
  url: (url: string) => void;
  connected: (connection: CloudflaredConnection) => void;
  error: (error: Error) => void;
  exit: (code: number | null, signal: string | null) => void;
  /** Emitted while the cloudflared binary is being downloaded. */
  installing: (percent: number) => void;
}

/**
 * Manages a Cloudflare Quick Tunnel lifecycle.
 *
 * Wraps the `cloudflared` npm package to create an ephemeral tunnel
 * that proxies external HTTPS traffic to a local port.
 */
export class TunnelManager extends EventEmitter {
  private _url: string | null = null;
  private _active = false;
  private tunnel: ReturnType<typeof import('cloudflared')['Tunnel']['quick']> | null = null;

  /** Current tunnel URL, or null if not connected. */
  get url(): string | null {
    return this._url;
  }

  /** Whether the tunnel is currently connected. */
  get isActive(): boolean {
    return this._active;
  }

  /**
   * Start a quick tunnel pointing to the given local port.
   * Installs the cloudflared binary automatically if it is missing.
   */
  async start(localPort: number): Promise<void> {
    if (this.tunnel) {
      log.warn('[tunnel] already running — stop first');
      return;
    }

    // The cloudflared package is CJS; import it normally.
    const { RELEASE_BASE, CLOUDFLARED_VERSION, use, Tunnel } = await import('cloudflared');

    // The default bin path resolves inside app.asar (read-only) in packaged
    // builds, so we always use a writable location under userData.
    const binName = process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared';
    const binPath = path.join(app.getPath('userData'), 'bin', binName);
    use(binPath);

    // Auto-install the binary if it doesn't exist yet.
    if (!fs.existsSync(binPath)) {
      log.info('[tunnel] cloudflared binary not found, installing…');
      this.emit('installing', 0);
      try {
        await this.installWithProgress(binPath, RELEASE_BASE, CLOUDFLARED_VERSION);
        log.info('[tunnel] cloudflared binary installed');
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        log.error('[tunnel] failed to install cloudflared:', error.message);
        this.emit('error', error);
        return;
      }
    }

    log.info(`[tunnel] starting quick tunnel → localhost:${localPort}`);

    const t = Tunnel.quick(`http://localhost:${localPort}`);
    this.tunnel = t;

    // Collect stderr so we can report a meaningful error on crash.
    let stderrBuf = '';
    t.on('stderr', (data: string) => {
      stderrBuf += data;
      log.info(`[tunnel] ${data.trimEnd()}`);
    });

    t.on('url', (url: string) => {
      this._url = url;
      this._active = true;
      log.info(`[tunnel] url: ${url}`);
      this.emit('url', url);
    });

    t.on('connected', (conn: CloudflaredConnection) => {
      log.info(`[tunnel] connected via ${conn.location} (${conn.ip})`);
      this.emit('connected', conn);
    });

    t.on('error', (err: Error) => {
      log.error('[tunnel] error:', err.message);
      this.emit('error', err);
    });

    t.on('exit', (code: number | null, signal: NodeJS.Signals | null) => {
      log.info(`[tunnel] exited code=${code} signal=${signal}`);
      const wasActive = this._active;
      this._url = null;
      this._active = false;
      this.tunnel = null;

      // If the process crashed before the tunnel was established, surface
      // the last stderr output as an error so the UI doesn't stay stuck.
      if (code !== 0 && !wasActive) {
        const lastLine = stderrBuf.trim().split('\n').pop() || `cloudflared exited with code ${code}`;
        this.emit('error', new Error(lastLine));
      }

      this.emit('exit', code, signal);
    });
  }

  /** Stop the tunnel and reset state. */
  stop(): void {
    if (this.tunnel) {
      log.info('[tunnel] stopping');
      // cloudflared's .stop() sends SIGINT which is a no-op on Windows.
      // Kill the child process directly instead.
      const child = this.tunnel.process;
      if (child && !child.killed) {
        child.kill();
      }
      // State is cleaned up in the 'exit' handler above.
    }
  }

  /**
   * Download cloudflared binary with progress reporting.
   * Replaces the cloudflared package's `install()` so we can emit progress.
   */
  private async installWithProgress(
    to: string,
    releaseBase: string,
    version: string,
  ): Promise<void> {
    const fileMap: Record<string, Record<string, string | undefined>> = {
      win32: { x64: 'cloudflared-windows-amd64.exe', ia32: 'cloudflared-windows-386.exe' },
      linux: { arm64: 'cloudflared-linux-arm64', arm: 'cloudflared-linux-arm', x64: 'cloudflared-linux-amd64', ia32: 'cloudflared-linux-386' },
      darwin: { arm64: 'cloudflared-darwin-arm64.tgz', x64: 'cloudflared-darwin-amd64.tgz' },
    };

    const platformFiles = fileMap[process.platform];
    if (!platformFiles) throw new Error(`Unsupported platform: ${process.platform}`);
    const file = platformFiles[process.arch];
    if (!file) throw new Error(`Unsupported architecture: ${process.arch}`);

    const base = version === 'latest'
      ? `${releaseBase}latest/download/`
      : `${releaseBase}download/${version}/`;

    const isTgz = file.endsWith('.tgz');
    const dest = isTgz ? `${to}.tgz` : to;

    await this.downloadWithProgress(base + file, dest);

    if (isTgz) {
      // macOS: extract the tarball
      const { execSync } = await import('node:child_process');
      execSync(`tar -xzf ${path.basename(dest)}`, { cwd: path.dirname(to) });
      fs.unlinkSync(dest);
      fs.renameSync(path.join(path.dirname(to), 'cloudflared'), to);
    }

    if (process.platform !== 'win32') {
      fs.chmodSync(to, '755');
    }
  }

  /** HTTPS download with redirect following and progress events. */
  private downloadWithProgress(url: string, to: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const dir = path.dirname(to);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      const follow = (currentUrl: string, redirects: number) => {
        if (redirects > 5) {
          reject(new Error('Too many redirects'));
          return;
        }

        const request = https.get(currentUrl, (res) => {
          const redirectCodes = [301, 302, 303, 307, 308];
          if (redirectCodes.includes(res.statusCode!) && res.headers.location) {
            request.destroy();
            follow(res.headers.location, redirects + 1);
            return;
          }

          if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
            request.destroy();
            reject(new Error(`HTTP ${res.statusCode}`));
            return;
          }

          const totalBytes = parseInt(res.headers['content-length'] || '0', 10);
          let receivedBytes = 0;
          let lastPercent = -1;

          const file = fs.createWriteStream(to);
          res.on('data', (chunk: Buffer) => {
            receivedBytes += chunk.length;
            if (totalBytes > 0) {
              const percent = Math.round((receivedBytes / totalBytes) * 100);
              if (percent !== lastPercent) {
                lastPercent = percent;
                this.emit('installing', percent);
              }
            }
          });
          res.pipe(file);
          file.on('finish', () => file.close(() => resolve()));
          file.on('error', (err) => {
            fs.unlink(to, () => reject(err));
          });
        });

        request.on('error', (err) => reject(err));
        request.end();
      };

      follow(url, 0);
    });
  }

  // Typed event helpers
  on<E extends keyof TunnelManagerEvents>(event: E, listener: TunnelManagerEvents[E]): this {
    return super.on(event, listener);
  }
  once<E extends keyof TunnelManagerEvents>(event: E, listener: TunnelManagerEvents[E]): this {
    return super.once(event, listener);
  }
  off<E extends keyof TunnelManagerEvents>(event: E, listener: TunnelManagerEvents[E]): this {
    return super.off(event, listener);
  }
  emit<E extends keyof TunnelManagerEvents>(event: E, ...args: Parameters<TunnelManagerEvents[E]>): boolean {
    return super.emit(event, ...args);
  }
}
