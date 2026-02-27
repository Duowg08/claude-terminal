# Development Guide

## Project Setup

```bash
pnpm install       # Install dependencies (uses hoisted node-linker for Electron Forge)
pnpm start         # Run in dev mode
pnpm run test      # Run tests
```

### pnpm Configuration

Electron Forge requires `node-linker=hoisted` in `.npmrc`. This is already configured. If you switch package managers, you'll need to ensure hoisted dependency layout.

## Code Organization

### Path Aliases

Configured in `tsconfig.json`, `vitest.config.ts`, and `vite.main.config.mjs`:

- `@shared/*` -> `src/shared/*`
- `@main/*` -> `src/main/*`

### Main Process Modules

| Module | Responsibility |
|--------|---------------|
| `index.ts` | App lifecycle, window creation, IPC handler registration |
| `pty-manager.ts` | Spawn/manage node-pty processes per tab |
| `tab-manager.ts` | Pure state management for tabs (no side effects) |
| `ipc-server.ts` | Named pipe server for hook communication |
| `settings-store.ts` | JSON file persistence for settings |
| `worktree-manager.ts` | Git worktree operations via `execSync` |
| `hook-installer.ts` | Writes `.claude/settings.local.json` to target dirs |
| `logger.ts` | Forwards main-process logs to DevTools console via BrowserWindow |

### Renderer Components

| Component | Purpose |
|-----------|---------|
| `App.tsx` | Root: state machine (`startup`/`running`), keyboard shortcuts, event listeners |
| `StartupDialog.tsx` | Directory picker, recent dirs, permission mode selection |
| `TabBar.tsx` | Tab strip container, maps tabs to Tab components |
| `Tab.tsx` | Individual tab: status indicator, name, worktree badge, rename, close |
| `Terminal.tsx` | xterm.js wrapper with WebGL, caching, resize handling |
| `StatusBar.tsx` | Bottom bar: status, worktree, tab count, shortcut hints |
| `NewTabDialog.tsx` | Two-step dialog: worktree yes/no, then name input |

## Testing

### Test Structure

Tests mirror the `src/` layout under `tests/`:

```
tests/
  setup.ts                    # Global test setup
  shared/types.test.ts        # Shared type constants
  main/
    tab-manager.test.ts       # 9 tests - tab CRUD, active tracking
    pty-manager.test.ts       # 5 tests - spawn, write, resize, kill
    ipc-server.test.ts        # 3 tests - real named pipe communication
    settings-store.test.ts    # 7 tests - real temp file persistence
    worktree-manager.test.ts  # 4 tests - mocked execSync
    hook-installer.test.ts    # 3 tests - real temp directory writes
  hooks/
    hook-scripts.test.ts      # 1 test - real pipe-send.sh execution
  integration/
    app.test.ts               # 4 tests - component smoke tests
```

### Mocking Strategy

- **electron**: Mocked globally in `tests/setup.ts`
- **node-pty**: Mocked per test file via `vi.mock('node-pty')`
- **child_process**: Mocked for `worktree-manager.test.ts`
- **Settings store**: Uses real temp files (no mock), cleaned up in `afterEach`
- **IPC server**: Uses real named pipes with unique names per test

### Running Specific Tests

```bash
pnpm run test -- tests/main/pty-manager.test.ts     # Single file
pnpm run test -- --grep "spawns a Claude process"   # By name
```

### Environment Overrides

Some test files override the Vitest environment:
```typescript
// @vitest-environment node
```
This is used for tests that need real Node.js APIs (settings-store, hook-scripts).

## Windows-Specific Notes

### node-pty and .cmd Files

node-pty cannot resolve `.cmd` wrappers. On Windows, Claude Code is installed as `claude.cmd`. The `PtyManager` spawns through `cmd.exe`:

```typescript
const shell = isWindows ? 'cmd.exe' : 'claude';
const spawnArgs = isWindows ? ['/c', 'claude', ...args] : args;
```

### Named Pipe Paths

Windows named pipes use `\\.\pipe\name` syntax. In shell scripts, backslashes need careful handling. The hook scripts use environment variables to pass the pipe path to Node.js, avoiding shell escaping issues.

### Native Module Rebuilding

node-pty has N-API prebuilds. The `forge.config.ts` skips rebuilding via `ignoreModules: ['node-pty']`. If you encounter native module errors, try:

```bash
pnpm exec electron-rebuild
```

## Build & Package

```bash
pnpm run package    # Package without installer
pnpm run make       # Package with installer (Squirrel for Windows)
```

Output goes to `out/`. The build uses:
- `asar: true` for packaging app source
- `AutoUnpackNativesPlugin` for native modules (node-pty)
- Electron Fuses for security hardening

## Adding New Features

### Adding a new IPC handler

1. Add the handler type to `src/preload.ts`
2. Add the handler implementation in `registerIpcHandlers()` in `src/main/index.ts`
3. Update `src/renderer/global.d.ts` if the type changes
4. Add tests

### Adding a new hook event

1. Create a Node.js script in `src/hooks/` (use `.js` — hooks run via `node`)
2. Add the event to `HookInstaller.install()` in `src/main/hook-installer.ts`
3. Handle the event in `handleHookMessage()` in `src/main/index.ts`
4. Add tests

### Adding a new tab status

1. Add the status to `TabStatus` in `src/shared/types.ts`
2. Add the indicator to `STATUS_INDICATORS`
3. Add CSS for `.tab-status-{name}` in `src/renderer/index.css`
