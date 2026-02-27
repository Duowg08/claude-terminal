import fs from 'fs';
import path from 'path';
import { app } from 'electron';
import { PermissionMode, SavedTab } from '@shared/types';

const MAX_RECENT_DIRS = 10;
const SESSIONS_DIR = '.claude-terminal';
const SESSIONS_FILE = 'sessions.json';

interface StoreData {
  recentDirs: string[];
  permissionMode: PermissionMode;
}

const DEFAULTS: StoreData = {
  recentDirs: [],
  permissionMode: 'bypassPermissions',
};

export class SettingsStore {
  private filePath: string;
  private data: StoreData;

  constructor(filePath?: string) {
    this.filePath = filePath ?? path.join(app.getPath('userData'), 'claude-terminal-settings.json');
    this.data = this.load();
  }

  private load(): StoreData {
    try {
      const raw = fs.readFileSync(this.filePath, 'utf-8');
      return { ...DEFAULTS, ...JSON.parse(raw) };
    } catch {
      return { ...DEFAULTS };
    }
  }

  private save(): void {
    const dir = path.dirname(this.filePath);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), 'utf-8');
  }

  getRecentDirs(): string[] {
    return this.data.recentDirs;
  }

  addRecentDir(dir: string): void {
    this.data.recentDirs = this.data.recentDirs.filter(d => d !== dir);
    this.data.recentDirs.unshift(dir);
    this.data.recentDirs = this.data.recentDirs.slice(0, MAX_RECENT_DIRS);
    this.save();
  }

  getPermissionMode(): PermissionMode {
    return this.data.permissionMode;
  }

  setPermissionMode(mode: PermissionMode): void {
    this.data.permissionMode = mode;
    this.save();
  }

  // --- Per-directory session persistence (stored in <dir>/.claude-terminal/sessions.json) ---

  private sessionsPath(dir: string): string {
    return path.join(dir, SESSIONS_DIR, SESSIONS_FILE);
  }

  getSessions(dir: string): SavedTab[] {
    try {
      const raw = fs.readFileSync(this.sessionsPath(dir), 'utf-8');
      return JSON.parse(raw) as SavedTab[];
    } catch {
      return [];
    }
  }

  saveSessions(dir: string, tabs: SavedTab[]): void {
    const sessDir = path.join(dir, SESSIONS_DIR);
    fs.mkdirSync(sessDir, { recursive: true });
    fs.writeFileSync(this.sessionsPath(dir), JSON.stringify(tabs, null, 2), 'utf-8');
  }

  clearSessions(dir: string): void {
    try {
      fs.unlinkSync(this.sessionsPath(dir));
    } catch {
      // file may not exist
    }
  }
}
