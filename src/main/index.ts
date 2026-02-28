import { app, BrowserWindow, dialog, Menu, shell } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { handleSquirrelEvent } from './squirrel-startup';

import { TabManager } from './tab-manager';
import { PtyManager } from './pty-manager';
import { HookIpcServer } from './ipc-server';
import { SettingsStore } from './settings-store';
import { createTabNamer } from './tab-namer';
import { createHookRouter } from './hook-router';
import { registerIpcHandlers, type AppState } from './ipc-handlers';
import { log } from './logger';

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (handleSquirrelEvent(app)) {
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Singletons
// ---------------------------------------------------------------------------
const tabManager = new TabManager();
const ptyManager = new PtyManager();
const settings = new SettingsStore();
const PIPE_NAME = `\\\\.\\pipe\\claude-terminal-${process.pid}`;
let ipcServer: HookIpcServer | null = null;

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------
function parseCliStartDir(): string | null {
  for (const arg of process.argv.slice(1)) {
    if (arg.startsWith('-')) continue;
    if (arg === '.') continue; // Electron Forge passes '.' as the app entry
    if (arg.toLowerCase().includes('electron')) continue;
    if (arg.includes('.vite') || arg.includes('node_modules')) continue;
    try {
      if (fs.statSync(arg).isDirectory()) return arg;
    } catch { /* not a valid path */ }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Shared mutable state
// ---------------------------------------------------------------------------
const state: AppState = {
  workspaceDir: null,
  permissionMode: 'bypassPermissions',
  worktreeManager: null,
  hookInstaller: null,
  mainWindow: null,
  cliStartDir: parseCliStartDir(),
  pipeName: PIPE_NAME,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function sendToRenderer(channel: string, ...args: unknown[]) {
  const win = state.mainWindow as BrowserWindow | null;
  if (win && !win.isDestroyed()) {
    win.webContents.send(channel, ...args);
  }
}

function persistSessions() {
  if (!state.workspaceDir) return;
  const allTabs = tabManager.getAllTabs();
  const savedTabs = allTabs
    .filter(t => t.sessionId && t.type === 'claude')
    .map(t => ({
      name: t.name,
      cwd: t.cwd,
      worktree: t.worktree,
      sessionId: t.sessionId!,
    }));
  settings.saveSessions(state.workspaceDir, savedTabs);
}

// ---------------------------------------------------------------------------
// Wire up extracted modules
// ---------------------------------------------------------------------------
const { generateTabName, cleanupNamingFlag } = createTabNamer({
  tabManager, sendToRenderer, persistSessions,
});

const { handleHookMessage } = createHookRouter({
  tabManager, sendToRenderer, persistSessions,
  generateTabName, cleanupNamingFlag,
  getMainWindow: () => state.mainWindow as BrowserWindow | null,
});

// ---------------------------------------------------------------------------
// Window creation
// ---------------------------------------------------------------------------
const createWindow = () => {
  Menu.setApplicationMenu(null);

  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    icon: path.resolve(__dirname, '../../assets/icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });

  state.mainWindow = mainWindow;

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    );
  }

  const initialTitle = state.cliStartDir
    ? `ClaudeTerminal - ${path.resolve(state.cliStartDir)}`
    : 'ClaudeTerminal';
  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow.setTitle(initialTitle);
    log.attach(mainWindow);
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    const appUrl = MAIN_WINDOW_VITE_DEV_SERVER_URL || 'file://';
    if (!url.startsWith(appUrl)) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  mainWindow.webContents.on('before-input-event', (_event, input) => {
    if (input.control && input.shift && input.key === 'I') {
      mainWindow.webContents.toggleDevTools();
    }
  });

  mainWindow.on('close', (event) => {
    const workingTabs = tabManager.getAllTabs().filter(t => t.status === 'working');
    if (workingTabs.length > 0) {
      const names = workingTabs.map(t => t.name).join(', ');
      const result = dialog.showMessageBoxSync(mainWindow, {
        type: 'warning',
        buttons: ['Close', 'Cancel'],
        defaultId: 1,
        title: 'Close ClaudeTerminal?',
        message: `${workingTabs.length === 1 ? '1 tab is' : `${workingTabs.length} tabs are`} still running`,
        detail: names,
      });
      if (result === 1) {
        event.preventDefault();
      }
    }
  });

  mainWindow.on('closed', () => {
    state.mainWindow = null;
  });
};

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------
app.setPath(
  'sessionData',
  path.join(app.getPath('temp'), `claude-terminal-${process.pid}`),
);

app.on('ready', async () => {
  ipcServer = new HookIpcServer(PIPE_NAME);
  try {
    await ipcServer.start();
    log.info('[ipc-server] listening on pipe');
  } catch (err) {
    log.error('[ipc-server] FAILED to start:', String(err));
  }

  ipcServer.onMessage(handleHookMessage);

  registerIpcHandlers({
    tabManager, ptyManager, settings, state,
    sendToRenderer, persistSessions, cleanupNamingFlag,
  });

  createWindow();
});

app.on('window-all-closed', async () => {
  log.info('[quit] workspaceDir:', state.workspaceDir, 'tabs:', tabManager.getAllTabs().length);
  persistSessions();

  for (const tab of tabManager.getAllTabs()) {
    cleanupNamingFlag(tab.id);
  }

  ptyManager.killAll();
  if (ipcServer) {
    try { await ipcServer.stop(); } catch { /* best-effort */ }
  }
  app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// ---------------------------------------------------------------------------
// Forge Vite plugin globals (injected at build time)
// ---------------------------------------------------------------------------
declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string;
declare const MAIN_WINDOW_VITE_NAME: string;
