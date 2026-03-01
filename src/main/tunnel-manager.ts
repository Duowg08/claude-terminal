import fs from 'node:fs';
import https from 'node:https';
import path from 'node:path';
import { spawn, ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { app } from 'electron';
import { log } from './logger';

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

/** Regex to extract the quick-tunnel URL from cloudflared stderr. */
const TUNNEL_URL_RE = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i;

/** Regex to detect a connector connection line from cloudflared stderr. */
const CONNECTED_RE = /Connection ([a-f0-9-]+) registered connectorID=([a-f0-9-]+) location=(\w+)(?: ip=(\S+))?/i;

/**
 * Manages a Cloudflare Quick Tunnel lifecycle.
 *
 * Spawns the `cloudflared` binary directly to create an ephemeral tunnel
 * that proxies external HTTPS traffic to a local port.
 * Uses the `cloudflared` npm package only for binary installation.
 */
export class TunnelManager extends EventEmitter {
  private static MAX_RETRIES = 5;
  private static RETRY_DELAY_MS = 2000;
  private static STARTUP_TIMEOUT_MS = 30_000;

  private _url: string | null = null;
  private _active = false;
  private _stopped = false;
  private child: ChildProcess | null = null;
  private startupTimer: ReturnType<typeof setTimeout> | null = null;

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
    if (this.child) {
      log.warn('[tunnel] already running — stop first');
      return;
    }

    this._stopped = false;

    // The cloudflared package is CJS; import it only for installation metadata.
    const { RELEASE_BASE, CLOUDFLARED_VERSION } = await import('cloudflared');

    const binName = process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared';
    const binPath = path.join(app.getPath('userData'), 'bin', binName);

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

    this.spawnTunnel(binPath, localPort, 0);
  }

  /**
   * Spawn the cloudflared process directly, parsing the tunnel URL from
   * stderr. Retries automatically if it exits before establishing.
   */
  private spawnTunnel(binPath: string, localPort: number, attempt: number): void {
    if (this._stopped) return;

    log.info(`[tunnel] starting quick tunnel → localhost:${localPort} (attempt ${attempt + 1}/${TunnelManager.MAX_RETRIES})`);

    const child = spawn(binPath, ['tunnel', '--url', `http://localhost:${localPort}`], {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    this.child = child;

    let stderrBuf = '';

    // Timeout: if we don't get a URL within 30s, kill and retry.
    this.startupTimer = setTimeout(() => {
      if (!this._active && !this._stopped) {
        log.warn('[tunnel] startup timed out');
        child.kill();
      }
    }, TunnelManager.STARTUP_TIMEOUT_MS);

    const onData = (data: Buffer) => {
      const text = data.toString();
      stderrBuf += text;
      log.info(`[tunnel] ${text.trimEnd()}`);

      // Look for the trycloudflare.com URL
      if (!this._active) {
        const urlMatch = stderrBuf.match(TUNNEL_URL_RE);
        if (urlMatch) {
          this.clearStartupTimer();
          this._url = urlMatch[0];
          this._active = true;
          stderrBuf = ''; // no longer needed — prevent unbounded growth
          log.info(`[tunnel] url: ${this._url}`);
          this.emit('url', this._url);
        }
      }

      // Detect connection events
      const connMatch = text.match(CONNECTED_RE);
      if (connMatch) {
        this.emit('connected', {
          id: connMatch[1],
          ip: connMatch[4] || connMatch[2],
          location: connMatch[3],
        });
      }
    };

    child.stderr?.on('data', onData);
    child.stdout?.on('data', onData);

    child.on('error', (err: Error) => {
      this.clearStartupTimer();
      log.error('[tunnel] process error:', err.message);
      this.emit('error', err);
    });

    child.on('exit', (code: number | null, signal: string | null) => {
      this.clearStartupTimer();
      log.info(`[tunnel] exited code=${code} signal=${signal}`);
      const wasActive = this._active;
      this._url = null;
      this._active = false;
      this.child = null;

      // If it crashed before establishing the tunnel, retry automatically.
      if (code !== 0 && !wasActive && !this._stopped) {
        const nextAttempt = attempt + 1;
        if (nextAttempt < TunnelManager.MAX_RETRIES) {
          log.warn(`[tunnel] failed before connecting, retrying in ${TunnelManager.RETRY_DELAY_MS}ms...`);
          setTimeout(() => this.spawnTunnel(binPath, localPort, nextAttempt), TunnelManager.RETRY_DELAY_MS);
          return;
        }
        // Exhausted retries — surface the error.
        const lastLine = stderrBuf.trim().split('\n').pop() || `cloudflared exited with code ${code}`;
        this.emit('error', new Error(lastLine));
      }

      this.emit('exit', code, signal);
    });
  }

  /** Stop the tunnel and reset state. */
  stop(): void {
    this._stopped = true;
    this.clearStartupTimer();
    if (this.child) {
      log.info('[tunnel] stopping');
      if (!this.child.killed) {
        this.child.kill();
      }
    }
  }

  private clearStartupTimer(): void {
    if (this.startupTimer) {
      clearTimeout(this.startupTimer);
      this.startupTimer = null;
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
