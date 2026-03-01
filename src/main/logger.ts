import { BrowserWindow } from 'electron';
import * as fs from 'fs';
import * as path from 'path';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

let _window: BrowserWindow | null = null;
let _logStream: fs.WriteStream | null = null;
let _logFile: string | null = null;
let _rotatedFile: string | null = null;
let _bytesWritten = 0;
const pending: Array<{ level: LogLevel; msg: string }> = [];

const MAX_LOG_SIZE = 1 * 1024 * 1024; // 1 MB

function timestamp(): string {
  return new Date().toISOString();
}

function format(args: unknown[]): string {
  return args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
}

function rotate() {
  if (!_logStream || !_logFile || !_rotatedFile) return;
  _logStream.end();
  try { fs.unlinkSync(_rotatedFile); } catch { /* doesn't exist */ }
  fs.renameSync(_logFile, _rotatedFile);
  _logStream = fs.createWriteStream(_logFile, { flags: 'a' });
  _bytesWritten = 0;
}

function writeToFile(level: LogLevel, msg: string) {
  if (_logStream) {
    const line = `${timestamp()} [${level.toUpperCase()}] ${msg}\n`;
    _logStream.write(line);
    _bytesWritten += Buffer.byteLength(line);
    if (_bytesWritten > MAX_LOG_SIZE) rotate();
  }
}

function emit(level: LogLevel, msg: string) {
  writeToFile(level, msg);
  if (_window && !_window.isDestroyed()) {
    _window.webContents.executeJavaScript(
      `console.${level}('[main]', ${JSON.stringify(msg)})`,
    );
  } else {
    pending.push({ level, msg });
  }
}

export const log = {
  debug(...args: unknown[]) { emit('debug', format(args)); },
  info(...args: unknown[])  { emit('info',  format(args)); },
  warn(...args: unknown[])  { emit('warn',  format(args)); },
  error(...args: unknown[]) { emit('error', format(args)); },

  /** Start file logging to <dir>/.claude-terminal/logs/main.log */
  init(dir: string) {
    const logsDir = path.join(dir, '.claude-terminal', 'logs');
    fs.mkdirSync(logsDir, { recursive: true });

    _logFile = path.join(logsDir, 'main.log');
    _rotatedFile = path.join(logsDir, 'main.log.1');

    // Delete previous logs, start fresh each run
    try { fs.unlinkSync(_rotatedFile); } catch { /* doesn't exist */ }
    try { fs.unlinkSync(_logFile); } catch { /* doesn't exist */ }

    _logStream = fs.createWriteStream(_logFile, { flags: 'a' });
    _bytesWritten = 0;
    log.info('--- Log session started ---');
  },

  /** Bind logger to the main BrowserWindow so it can forward to DevTools. */
  attach(win: BrowserWindow) {
    _window = win;
    while (pending.length > 0) {
      const entry = pending.shift()!;
      emit(entry.level, entry.msg);
    }
  },
};
