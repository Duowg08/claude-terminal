# Remote Access

ClaudeTerminal supports remote access to your terminal sessions from any browser or mobile device. A Cloudflare quick tunnel exposes a local HTTP + WebSocket server over HTTPS, and a 6-character access code protects the connection.

## How It Works

```
User clicks Remote Access button in tab bar
  -> activateRemoteAccess() in main process
    -> WebRemoteServer starts HTTP + WebSocket on localhost:3456
      -> TunnelManager starts cloudflared quick tunnel -> localhost:3456
        -> Cloudflare assigns an HTTPS URL (e.g. https://xyz-abc.trycloudflare.com)
          -> Renderer shows URL + access code + QR code
            -> Remote browser opens URL, enters code, gets full terminal view
```

## Tunnel Manager

`TunnelManager` wraps the `cloudflared` npm package to create an ephemeral Cloudflare Quick Tunnel. The tunnel proxies external HTTPS traffic to a local port.

**Auto-install**: On first use, if the `cloudflared` binary does not exist on disk, `TunnelManager.start()` calls `install(bin)` from the `cloudflared` package to download it automatically.

**Lifecycle**:
1. `start(localPort)` — imports the `cloudflared` package (CJS), checks/installs the binary, then calls `Tunnel.quick()` pointing at `http://localhost:<port>`.
2. The tunnel emits events as it progresses: `url` (tunnel URL assigned), `connected` (edge connection established with location/IP), `error`, and `exit`.
3. `stop()` — kills the child process directly. The standard `.stop()` from the cloudflared package sends `SIGINT`, which is a no-op on Windows. Instead, `TunnelManager` calls `child.kill()` on the underlying process. State cleanup happens in the `exit` event handler.

**Event emitter pattern**: `TunnelManager` extends Node.js `EventEmitter` with typed overrides for `on`, `once`, `off`, and `emit`:

```typescript
interface TunnelManagerEvents {
  url: (url: string) => void;
  connected: (connection: CloudflaredConnection) => void;
  error: (error: Error) => void;
  exit: (code: number | null, signal: string | null) => void;
}
```

The main process (`src/main/index.ts`) listens to these events and forwards `RemoteAccessInfo` updates to the renderer via `remote:updated`.

## Web Remote Server

`WebRemoteServer` runs an HTTP server for static file serving and a WebSocket server for real-time terminal communication. Both share the same `http.Server` instance on port 3456, bound to `127.0.0.1`.

**Dependencies injected at construction**:

| Dependency | Purpose |
|---|---|
| `tabManager` | Read/update tab state |
| `ptyManager` | Write to PTY, read terminal dimensions |
| `state` | Shared app state |
| `sendToRenderer` | Forward events to Electron renderer |
| `persistSessions` | Save tab state to disk |
| `serializeTerminal` | Capture visible terminal buffer for initial sync |

**Start/stop**: `start(port)` creates the HTTP server, attaches `WebSocketServer`, and begins listening. `stop()` closes all connected WebSocket clients, shuts down the WSS, and closes the HTTP server.

**Broadcasting**: `broadcast(msg)` sends a JSON payload to all authenticated WebSocket clients.

## Authentication

When the `WebRemoteServer` is constructed, it generates a random 6-character alphanumeric access code from the character set `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` (ambiguous characters like `0`, `O`, `1`, `I` are excluded for readability).

**Token validation** uses `crypto.timingSafeEqual` to compare the submitted token against the stored one, preventing timing-based side-channel attacks.

**Unauthenticated timeout**: Each new WebSocket connection has 10 seconds to authenticate. If the client does not send a valid `auth` message within that window, the server closes the connection with code `4001` ("Authentication timeout").

**Failed auth**: If the token is wrong, the server immediately responds with `auth:fail`, closes the socket, and removes the client from the set. There is no retry — the client must open a new connection.

## Message Protocol

All messages are JSON-encoded and sent over WebSocket.

### Client -> Server

| Message | Fields | Description |
|---|---|---|
| `auth` | `{ type: "auth", token: string }` | Authenticate with the access code. Must be the first message. |
| `pty:write` | `{ type: "pty:write", tabId: string, data: string }` | Send keystrokes / input to a tab's PTY. |
| `pty:resize` | `{ type: "pty:resize", tabId: string, cols: number, rows: number }` | Intentionally ignored. The Electron host owns PTY dimensions — letting remote clients resize would affect the host's terminal layout. |
| `tab:switch` | `{ type: "tab:switch", tabId: string }` | Switch the active tab. Mirrored to the Electron renderer and all other web clients. |
| `tab:rename` | `{ type: "tab:rename", tabId: string, name: string }` | Rename a tab. Persists to disk. |
| `tab:getAll` | `{ type: "tab:getAll" }` | Request a fresh `tabs:sync` response. |

### Server -> Client

| Message | Fields | Description |
|---|---|---|
| `auth:ok` | `{ type: "auth:ok" }` | Authentication succeeded. Followed immediately by `tabs:sync`. |
| `auth:fail` | `{ type: "auth:fail" }` | Authentication failed. Connection is closed. |
| `tabs:sync` | `{ type: "tabs:sync", tabs: Tab[], activeTabId: string, termSizes: Record<string, {cols, rows}> }` | Full tab state. Sent after auth and on `tab:getAll`. The `termSizes` field (present in the initial sync) tells the client what dimensions to create each terminal at. |
| `tab:updated` | `{ type: "tab:updated", tab: Tab }` | A tab's metadata changed (name, status, etc.). |
| `tab:removed` | `{ type: "tab:removed", tabId: string }` | A tab was closed. |
| `tab:switched` | `{ type: "tab:switched", tabId: string }` | The active tab changed (from any source). |
| `pty:data` | `{ type: "pty:data", tabId: string, data: string }` | Terminal output data (ANSI escape sequences). |
| `pty:resized` | `{ type: "pty:resized", tabId: string, cols: number, rows: number }` | The host resized a terminal. Web client should match. |

## Terminal Serialization

When a web client authenticates, it needs to see what is currently on screen — not just future output. The server calls `serializeTerminal(tabId)` for each tab to capture the visible buffer.

This works by calling `window.__serializeTerminal(tabId)` in the Electron renderer via `webContents.executeJavaScript`. That global function (defined in `terminalCache.ts`) uses xterm.js's `SerializeAddon` to dump the terminal's visible content as ANSI escape sequences. The resulting string is sent to the web client as a `pty:data` message, so the remote xterm.js instance renders the same screen content.

## Static File Serving

The HTTP server serves the web client's built assets (HTML, JS, CSS, fonts, images). The static root differs by environment:

| Environment | Static root |
|---|---|
| Development | `<project>/dist/web-client/` (built by `vite.web.config.mjs`) |
| Packaged | `<resources>/web-client/` (copied by Electron Forge config) |

**MIME types**: A hardcoded map covers `.html`, `.js`, `.css`, `.svg`, `.png`, `.json`, `.ico`, `.woff`, `.woff2`, `.ttf`. Unknown extensions fall back to `application/octet-stream`.

**Directory traversal protection**: The resolved file path must start with the resolved static root. Any request that escapes the root returns `403 Forbidden`.

**Routing**: `/` is mapped to `/index.html`. All other paths are resolved relative to the static root. Missing files return `404`.

## QR Code

When the remote access dropdown is open and the tunnel is active, the `RemoteAccessButton` component dynamically imports the `qrcode` npm package and generates a data URL containing the tunnel URL. The QR code is rendered as a 180x180 pixel image with dark-on-dark-theme colors (`#d4d4d4` on `#1e1e1e`).

The QR code encodes only the tunnel URL. The access code must be entered manually — it is never embedded in the QR payload.

## Activation Flow

1. **User clicks the cloud icon** in the tab bar, then clicks "Activate" in the dropdown.
2. **Renderer calls** `window.claudeTerminal.activateRemoteAccess()` (IPC to main process).
3. **Main process** (`activateRemoteAccess()` in `src/main/index.ts`):
   a. Creates a `WebRemoteServer` instance, injecting dependencies including a `serializeTerminal` function that calls into the renderer.
   b. Starts the HTTP+WS server on `localhost:3456`.
   c. Starts the Cloudflare tunnel pointing at port 3456.
4. **Tunnel emits `url` event** when Cloudflare assigns the HTTPS URL.
5. **Main process forwards** `remote:updated` to the renderer with `{ status: 'active', tunnelUrl, token }`.
6. **Renderer updates** the `RemoteAccessButton` dropdown to show the URL, access code, and QR code.
7. **Remote user** opens the tunnel URL in a browser, sees the `TokenScreen`, enters the 6-character code.
8. **Web client** (`ws-bridge.ts`) opens a WebSocket to the same host, sends `{ type: 'auth', token }`.
9. **Server authenticates**, sends `auth:ok` + `tabs:sync` + terminal snapshots.
10. **Web client renders** the full terminal UI using the same React components as the Electron app.

**Deactivation**: Clicking "Deactivate" calls `deactivateRemoteAccess()`, which stops the tunnel (kills cloudflared) and stops the web server (closes all WebSocket connections).

**Error handling**: If either the HTTP server or tunnel fails to start, both are stopped and the status is set to `error` with the error message.

## Web Client

The web client (`src/web-client/`) is a standalone React app that reuses the Electron renderer's components (`TabBar`, `Terminal`, `StatusBar`) but replaces Electron IPC with a `WebSocketBridge`.

**Three screens**:
- `TokenScreen` — access code entry form. Auto-reconnects if a code is saved in `sessionStorage`.
- `RemoteApp` — full terminal UI with tab bar and terminal views.
- `DisconnectedScreen` — shown on connection loss. Attempts exponential-backoff reconnection (up to 20 attempts).

**WebSocketBridge** (`ws-bridge.ts`) implements the same `ClaudeTerminalApi` interface as `preload.ts`, but over WebSocket instead of Electron IPC. Operations not available remotely (create tab, create worktree, settings, etc.) are stubbed as no-ops or throw.

**Terminal sizing**: Remote terminals render at the host's exact dimensions (received via `termSizes` in `tabs:sync` and `pty:resized` events). The CSS uses `width: max-content` to allow horizontal scrolling on narrow mobile screens rather than forcing a resize. `pty:resize` messages from the web client are intentionally ignored by the server.

**Build**: The web client is built separately via `vite.web.config.mjs` (root `src/web-client/`, output `dist/web-client/`). In production builds, the output is copied to `resources/web-client/` by the Electron Forge config.

## Key Files

| File | Purpose |
|---|---|
| `src/main/tunnel-manager.ts` | Cloudflare quick tunnel lifecycle (start, stop, events) |
| `src/main/web-remote-server.ts` | HTTP static server + WebSocket server with auth |
| `src/main/index.ts` | Activation/deactivation orchestration, event wiring |
| `src/main/ipc-handlers.ts` | `remote:activate`, `remote:deactivate`, `remote:getInfo` IPC handlers |
| `src/shared/types.ts` | `RemoteAccessInfo`, `RemoteAccessStatus` type definitions |
| `src/preload.ts` | Electron preload API for remote access IPC |
| `src/renderer/components/RemoteAccessButton.tsx` | UI: cloud button, dropdown with URL/code/QR |
| `src/renderer/components/terminalCache.ts` | `__serializeTerminal` global for buffer capture |
| `src/web-client/index.html` | Web client entry HTML |
| `src/web-client/main.tsx` | Web client React app (TokenScreen, RemoteApp, DisconnectedScreen) |
| `src/web-client/ws-bridge.ts` | WebSocket-based implementation of ClaudeTerminalApi |
| `src/web-client/web-client.css` | Mobile/browser CSS overrides |
| `vite.web.config.mjs` | Vite build config for the web client |
