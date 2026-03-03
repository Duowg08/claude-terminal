import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Handle Squirrel.Windows install/update/uninstall events.
 * Returns true if a Squirrel event was handled (caller should exit).
 */
export function handleSquirrelEvent(): boolean {
  if (process.platform !== 'win32') return false;

  const squirrelCommand = process.argv[1];
  if (!squirrelCommand) return false;

  // appFolder  = versioned dir, e.g. %LOCALAPPDATA%\ClaudeTerminal\app-1.6.0
  // installRoot = stable parent,  e.g. %LOCALAPPDATA%\ClaudeTerminal
  const appFolder = path.dirname(process.execPath);
  const exeName = path.basename(process.execPath);
  const installRoot = path.join(appFolder, '..');

  switch (squirrelCommand) {
    case '--squirrel-install':
    case '--squirrel-updated':
      copyHooksToStable(appFolder, installRoot);
      createCliShim(installRoot);
      cleanOldAppPathEntries(installRoot);
      addToPath(path.join(installRoot, 'bin'));
      execSync(`"${path.join(appFolder, '..', 'Update.exe')}" --createShortcut="${exeName}"`, {
        stdio: 'ignore',
      });
      return true;

    case '--squirrel-uninstall':
      removeFromPath(path.join(installRoot, 'bin'));
      removeStableDirs(installRoot);
      execSync(`"${path.join(appFolder, '..', 'Update.exe')}" --removeShortcut="${exeName}"`, {
        stdio: 'ignore',
      });
      return true;

    case '--squirrel-obsolete':
      return true;

    default:
      return false;
  }
}

/**
 * Copy hook scripts from the versioned resources dir to the stable hooks dir.
 * Runs on install and every update so scripts stay current.
 */
function copyHooksToStable(appFolder: string, installRoot: string): void {
  const srcDir = path.join(appFolder, 'resources', 'hooks');
  const dstDir = path.join(installRoot, 'hooks');
  try {
    fs.mkdirSync(dstDir, { recursive: true });
    const files = fs.readdirSync(srcDir).filter(f => f.endsWith('.js'));
    for (const file of files) {
      fs.copyFileSync(path.join(srcDir, file), path.join(dstDir, file));
    }
  } catch {
    // best-effort
  }
}

/**
 * Write claudeterm.cmd to the stable bin\ dir using the absolute exe path.
 * This survives version updates because the path to ClaudeTerminal.exe is
 * baked in at install/update time, not relative to the shim location.
 */
function createCliShim(installRoot: string): void {
  const binDir = path.join(installRoot, 'bin');
  fs.mkdirSync(binDir, { recursive: true });
  const shimPath = path.join(binDir, 'claudeterm.cmd');
  const shimContent = `@echo off\r\n"${process.execPath}" %*\r\n`;
  fs.writeFileSync(shimPath, shimContent, 'utf-8');
}

/**
 * Remove the stable bin\ and hooks\ dirs on uninstall.
 */
function removeStableDirs(installRoot: string): void {
  for (const dir of ['bin', 'hooks']) {
    try {
      fs.rmSync(path.join(installRoot, dir), { recursive: true, force: true });
    } catch {
      // best-effort
    }
  }
}

/**
 * Scan user PATH and remove any entries matching installRoot\app-* (stale
 * versioned dirs left behind by previous installs/updates).
 */
function cleanOldAppPathEntries(installRoot: string): void {
  try {
    const currentPath = execSync('reg query "HKCU\\Environment" /v Path', {
      encoding: 'utf-8',
    });
    const match = currentPath.match(/Path\s+REG_(?:EXPAND_)?SZ\s+(.*)/i);
    if (!match) return;

    const existingPath = match[1].trim();
    const appPattern = new RegExp(
      `^${escapeRegex(installRoot)}[/\\\\]app-`,
      'i',
    );
    const filtered = existingPath
      .split(';')
      .filter(p => !appPattern.test(p.trim()))
      .join(';');

    if (filtered !== existingPath) {
      setUserPath(filtered);
    }
  } catch {
    // best-effort
  }
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function addToPath(dir: string): void {
  try {
    const currentPath = execSync('reg query "HKCU\\Environment" /v Path', {
      encoding: 'utf-8',
    });
    const match = currentPath.match(/Path\s+REG_(?:EXPAND_)?SZ\s+(.*)/i);
    const existingPath = match ? match[1].trim() : '';

    const pathEntries = existingPath.split(';').map(p => p.toLowerCase());
    if (pathEntries.includes(dir.toLowerCase())) return;

    const newPath = existingPath ? `${existingPath};${dir}` : dir;
    setUserPath(newPath);
  } catch {
    try {
      setUserPath(dir);
    } catch {
      // best-effort
    }
  }
}

function removeFromPath(dir: string): void {
  try {
    const currentPath = execSync('reg query "HKCU\\Environment" /v Path', {
      encoding: 'utf-8',
    });
    const match = currentPath.match(/Path\s+REG_(?:EXPAND_)?SZ\s+(.*)/i);
    if (!match) return;

    const existingPath = match[1].trim();
    const filtered = existingPath
      .split(';')
      .filter(p => p.toLowerCase() !== dir.toLowerCase())
      .join(';');

    if (filtered !== existingPath) {
      setUserPath(filtered);
    }
  } catch {
    // best-effort
  }
}

/**
 * Write the user PATH environment variable via `reg add` instead of `setx`.
 * `setx` silently truncates values longer than 1024 characters, which can
 * corrupt a user's PATH. `reg add` has no such limit.
 *
 * After writing, broadcasts WM_SETTINGCHANGE so running processes (Explorer,
 * terminals) pick up the change without requiring a reboot.
 */
function setUserPath(newPath: string): void {
  execSync(`reg add "HKCU\\Environment" /v Path /t REG_EXPAND_SZ /d "${newPath}" /f`, {
    stdio: 'ignore',
  });

  // Broadcast WM_SETTINGCHANGE so Explorer and other processes pick up the
  // environment change immediately (best-effort, mirrors what setx does).
  try {
    execSync(
      'powershell -NoProfile -Command "Add-Type -Namespace Win32 -Name NativeMethods -MemberDefinition \'[DllImport(\\\"user32.dll\\\", SetLastError = true, CharSet = CharSet.Auto)] public static extern IntPtr SendMessageTimeout(IntPtr hWnd, uint Msg, UIntPtr wParam, string lParam, uint fuFlags, uint uTimeout, out UIntPtr lpdwResult);\'; $HWND_BROADCAST = [IntPtr]0xffff; $WM_SETTINGCHANGE = 0x1a; $result = [UIntPtr]::Zero; [Win32.NativeMethods]::SendMessageTimeout($HWND_BROADCAST, $WM_SETTINGCHANGE, [UIntPtr]::Zero, \'Environment\', 2, 5000, [ref]$result)"',
      { stdio: 'ignore' },
    );
  } catch {
    // best-effort — environment change will take effect on next login
  }
}
