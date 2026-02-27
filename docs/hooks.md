# Hook System

ClaudeTerminal uses Claude Code's hook system to track the state of each Claude instance without parsing terminal output. Hooks are shell scripts that send JSON messages over a Windows named pipe back to the main Electron process.

## How It Works

```
Claude Code fires hook event
  -> Shell script in src/hooks/ runs
    -> pipe-send.sh sends JSON to \\.\pipe\claude-terminal
      -> HookIpcServer (net.Server) receives the message
        -> Main process updates tab state & notifies renderer
```

## Hook Installation

When a tab is created, `HookInstaller.install()` writes a `.claude/settings.local.json` file into the tab's working directory. This file configures Claude Code to invoke our hook scripts for six events.

The generated `settings.local.json` looks like:

```json
{
  "hooks": {
    "SessionStart": [{
      "matcher": "startup",
      "hooks": [{ "type": "command", "command": "bash \"/path/to/on-session-start.sh\" \"tab-id\" \"\\\\.\\pipe\\claude-terminal\"", "timeout": 10 }]
    }],
    "UserPromptSubmit": [{
      "hooks": [{ "type": "command", "command": "bash \"/path/to/on-prompt-submit.sh\" \"tab-id\" \"\\\\.\\pipe\\claude-terminal\"", "timeout": 10 }]
    }],
    ...
  }
}
```

Each hook script receives two arguments:
1. `$1` — Tab ID (e.g., `tab-1709123456789-abc123`)
2. `$2` — Named pipe path (`\\.\pipe\claude-terminal`)

## Hook Scripts

All scripts are in `src/hooks/`.

### pipe-send.sh (shared helper)

The core communication helper. Uses Node.js `net.createConnection` to write JSON to the named pipe. Environment variables (`PIPE_PATH`, `PIPE_MSG`) are used instead of string interpolation to avoid Windows backslash escaping issues in shell scripts.

Includes a 3-second safety timeout to prevent hanging if the pipe is unavailable.

### on-session-start.sh

**Fires**: When Claude Code session initializes.
**Sends**: `{"tabId": "...", "event": "tab:ready", "data": null}`
**Also**: Writes `CLAUDE_TERMINAL_TAB_ID` to `$CLAUDE_ENV_FILE` if available.

### on-prompt-submit.sh

**Fires**: When the user submits a prompt to Claude.
**Reads**: stdin JSON containing the prompt text.
**Sends**: `{"tabId": "...", "event": "tab:name", "data": "<first 40 chars of prompt>"}`
**Purpose**: Auto-names the tab based on the first user prompt.

### on-tool-use.sh

**Fires**: Before Claude executes any tool.
**Sends**: `{"tabId": "...", "event": "tab:status:working", "data": null}`

### on-stop.sh

**Fires**: When Claude finishes a response.
**Sends**: `{"tabId": "...", "event": "tab:status:idle", "data": null}`

### on-notification.sh

**Fires**: When Claude is waiting for user input (idle prompt).
**Sends**: `{"tabId": "...", "event": "tab:status:input", "data": null}`

### on-session-end.sh

**Fires**: When the Claude Code session ends.
**Sends**: `{"tabId": "...", "event": "tab:closed", "data": null}`

## IPC Message Format

```typescript
interface IpcMessage {
  tabId: string;      // Which tab this message is for
  event: string;      // Event type (see table below)
  data: string | null; // Optional payload
}
```

### Event Types

| Event | Data | Effect |
|-------|------|--------|
| `tab:ready` | null | Sets tab status to `new` |
| `tab:status:working` | null | Sets tab status to `working` |
| `tab:status:idle` | null | Sets tab status to `idle`, notifies if background tab |
| `tab:status:input` | null | Sets tab status to `requires_response`, notifies if background tab |
| `tab:name` | `"prompt text..."` | Renames the tab |
| `tab:closed` | null | Removes the tab and kills PTY |

## Named Pipe Server

`HookIpcServer` creates a `net.Server` listening on `\\.\pipe\claude-terminal`. It handles:

- Multiple concurrent connections (one per hook invocation)
- Newline-delimited JSON parsing
- Buffered reads (handles partial messages)
- Graceful shutdown on app exit
