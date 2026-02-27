# Getting Started

## Prerequisites

- **Node.js** 18+ (LTS recommended)
- **pnpm** 10+ (`npm install -g pnpm`)
- **Git** (for worktree features)
- **Claude Code CLI** installed and on PATH (`claude` command available)
- **Windows 10/11** (uses ConPTY via node-pty and Windows named pipes)

## Installation

```bash
git clone https://github.com/yarong-lifemap/claude-terminal.git
cd claude-terminal
pnpm install
```

## Running in Development

```bash
pnpm start
```

This runs Electron Forge with Vite in dev mode. Changes to renderer code hot-reload automatically. Changes to main process code require restarting (type `rs` in the terminal running `pnpm start`).

## Running Tests

```bash
pnpm run test          # Single run (40 tests)
pnpm run test:watch    # Watch mode
```

## Usage

### Startup

1. Launch the app with `pnpm start`
2. The **Startup Dialog** appears:
   - Select a **working directory** from recent dirs or browse for one
   - Choose a **permission mode** (default: Bypass Permissions)
   - Click **Start**

You can also pass a directory via CLI:
```bash
pnpm start -- /path/to/project
```

### Working with Tabs

| Action | How |
|--------|-----|
| New tab | `Ctrl+T` or click `+` button |
| Close tab | `Ctrl+W` or click `x` on tab |
| Switch tabs | `Ctrl+Tab` / `Ctrl+Shift+Tab` |
| Jump to tab | `Ctrl+1` through `Ctrl+9` |
| Rename tab | `F2` or double-click tab name |

### New Tab Dialog

When creating a new tab, you're prompted:
1. **Create a worktree?** — Yes opens a name input, No uses the main workspace directory
2. If yes, enter a worktree name. It creates a git worktree branched from the current branch.

### Tab Status Indicators

| Symbol | Status | Meaning |
|--------|--------|---------|
| `●` | new | Claude session just started |
| `◉` | working | Claude is executing tools |
| `○` | idle | Claude finished, waiting |
| `◈` | requires_response | Claude needs your input |

Background tabs that become `idle` or `requires_response` trigger native OS toast notifications.

### Permission Modes

| Mode | CLI Flag | Description |
|------|----------|-------------|
| Bypass Permissions | `--dangerously-skip-permissions` | Skip all prompts (default) |
| Accept Edits | `--allowedTools Edit,Write,NotebookEdit` | Auto-approve file edits |
| Plan | `--plan` | Read-only planning mode |
| Default | (none) | Ask permission for each action |

The selected mode applies to **all tabs** in the session.

## Building for Distribution

```bash
pnpm run make
```

Outputs are in the `out/` directory. Uses Squirrel for Windows installer.

## Troubleshooting

### "File not found" when creating a tab

node-pty can't find the `claude` command. Ensure Claude Code CLI is installed and `claude` is on your system PATH. On Windows, it's typically installed as `claude.cmd`.

### App window doesn't appear

Check if another instance is already running. Kill any stale `electron.exe` processes.

### Named pipe errors

The app uses `\\.\pipe\claude-terminal` for hook communication. If another process is using this pipe name, the IPC server will fail to start. Check the main process console for errors.
