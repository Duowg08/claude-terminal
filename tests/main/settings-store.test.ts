// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => os.tmpdir()) },
}));

import { SettingsStore } from '@main/settings-store';

describe('SettingsStore', () => {
  let store: SettingsStore;
  let tmpFile: string;

  beforeEach(() => {
    tmpFile = path.join(os.tmpdir(), `claude-terminal-test-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
    store = new SettingsStore(tmpFile);
  });

  afterEach(() => {
    try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
  });

  it('returns empty recent dirs by default', () => {
    expect(store.getRecentDirs()).toEqual([]);
  });

  it('adds a recent directory', () => {
    store.addRecentDir('D:\\dev\\MyApp');
    expect(store.getRecentDirs()).toContain('D:\\dev\\MyApp');
  });

  it('moves duplicate to front', () => {
    store.addRecentDir('D:\\dev\\A');
    store.addRecentDir('D:\\dev\\B');
    store.addRecentDir('D:\\dev\\A');
    const dirs = store.getRecentDirs();
    expect(dirs[0]).toBe('D:\\dev\\A');
    expect(dirs).toHaveLength(2);
  });

  it('limits to 10 recent dirs', () => {
    for (let i = 0; i < 15; i++) {
      store.addRecentDir(`D:\\dev\\project${i}`);
    }
    expect(store.getRecentDirs()).toHaveLength(10);
  });

  it('returns bypassPermissions as default permission mode', () => {
    expect(store.getPermissionMode()).toBe('bypassPermissions');
  });

  it('saves and retrieves permission mode', () => {
    store.setPermissionMode('plan');
    expect(store.getPermissionMode()).toBe('plan');
  });

  it('persists to disk and reloads', () => {
    store.addRecentDir('D:\\dev\\Persist');
    const store2 = new SettingsStore(tmpFile);
    expect(store2.getRecentDirs()).toContain('D:\\dev\\Persist');
  });
});
