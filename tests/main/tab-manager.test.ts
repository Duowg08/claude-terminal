import { describe, it, expect, beforeEach } from 'vitest';
import { TabManager } from '@main/tab-manager';

describe('TabManager', () => {
  let manager: TabManager;

  beforeEach(() => {
    manager = new TabManager();
  });

  it('creates a tab with correct defaults', () => {
    const tab = manager.createTab('D:\\dev\\MyApp', null);
    expect(tab.status).toBe('new');
    expect(tab.cwd).toBe('D:\\dev\\MyApp');
    expect(tab.worktree).toBeNull();
    expect(tab.name).toBe('Tab 1');
  });

  it('increments tab names', () => {
    manager.createTab('D:\\dev\\MyApp', null);
    const tab2 = manager.createTab('D:\\dev\\MyApp', null);
    expect(tab2.name).toBe('Tab 2');
  });

  it('uses worktree name as tab name when provided', () => {
    const tab = manager.createTab('D:\\dev\\MyApp', 'feature/auth');
    expect(tab.name).toBe('feature/auth');
  });

  it('returns all tabs', () => {
    manager.createTab('D:\\dev\\A', null);
    manager.createTab('D:\\dev\\B', null);
    expect(manager.getAllTabs()).toHaveLength(2);
  });

  it('gets tab by id', () => {
    const tab = manager.createTab('D:\\dev\\MyApp', null);
    expect(manager.getTab(tab.id)).toBe(tab);
  });

  it('updates tab status', () => {
    const tab = manager.createTab('D:\\dev\\MyApp', null);
    manager.updateStatus(tab.id, 'working');
    expect(manager.getTab(tab.id)!.status).toBe('working');
  });

  it('renames a tab', () => {
    const tab = manager.createTab('D:\\dev\\MyApp', null);
    manager.rename(tab.id, 'auth refactor');
    expect(manager.getTab(tab.id)!.name).toBe('auth refactor');
  });

  it('removes a tab', () => {
    const tab = manager.createTab('D:\\dev\\MyApp', null);
    manager.removeTab(tab.id);
    expect(manager.getTab(tab.id)).toBeUndefined();
  });

  it('tracks active tab', () => {
    const tab1 = manager.createTab('D:\\dev\\A', null);
    const tab2 = manager.createTab('D:\\dev\\B', null);
    expect(manager.getActiveTabId()).toBe(tab1.id);
    manager.setActiveTab(tab2.id);
    expect(manager.getActiveTabId()).toBe(tab2.id);
  });
});
