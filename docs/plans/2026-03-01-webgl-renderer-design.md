# WebGL Renderer Design

## Problem

The terminal uses xterm.js v6's default DOM renderer, which is the slowest of three available renderers (DOM → Canvas → WebGL). WebGL was briefly added in commit `f60b767` but removed in `1f5f414` due to dual-renderer artifacts (overlapping cursors). The root cause was likely loading the addon multiple times on tab switches or timing issues — not a fundamental incompatibility.

## Solution

Re-add `@xterm/addon-webgl` with proper lifecycle management. Load WebGL once per terminal after `term.open()`, store the addon instance on the terminal cache for disposal, and handle context loss by falling back to the DOM renderer.

## Renderer Tiers

xterm.js v6 has three renderers:

| Renderer | How activated | Performance |
|----------|--------------|-------------|
| DOM | Default after `term.open()` | Slowest |
| Canvas | `@xterm/addon-canvas` addon | Middle |
| WebGL | `@xterm/addon-webgl` addon | Fastest |

Loading a renderer addon replaces the current one. Disposing a renderer addon reverts to DOM.

**Decision:** WebGL with DOM fallback. No canvas tier — this is an Electron app targeting developer machines where WebGL2 is universally supported. Canvas is YAGNI.

## Architecture

```
term.open(container)          ← DOM renderer active (default)
    ↓
term.loadAddon(webglAddon)    ← WebGL replaces DOM renderer
    ↓
onContextLoss → dispose()     ← reverts to DOM automatically
```

### Remote Access Impact

The same `Terminal.tsx` component is shared between Electron and the web remote client (served via Cloudflare tunnel). The try/catch + onContextLoss fallback handles both environments:

- **Electron:** WebGL always works (known Chromium + GPU)
- **Remote browser:** WebGL works on most devices, gracefully falls back to DOM if it doesn't

No special-casing needed.

## Changes

### `package.json`

Add `@xterm/addon-webgl` as a dev dependency.

### `terminalCache.ts`

Add optional `webglAddon` field to `CachedTerminal`. Dispose it in `destroyTerminal()`.

### `Terminal.tsx`

Load WebGL once per terminal inside the `!alreadyAttached` block, after `term.open()`. Store addon on cache. Register `onContextLoss` to dispose and clear the reference.

Key constraints:
- Load WebGL **once** per terminal lifetime (guarded by `cached.webglAddon`)
- Load **after** `term.open()` (WebGL needs an attached DOM element)
- Never re-attempt after failure — DOM stays active for that terminal

## Verification

1. **Visual** — Run app, open terminal, confirm no dual cursors. Run colorful output (`ls --color`, scrolling).
2. **Programmatic** — Check for WebGL canvas: `container.querySelector('canvas')` exists after addon loads.
3. **Context loss** — Use `WEBGL_lose_context` extension or Chrome DevTools to simulate. Verify terminal continues on DOM.
4. **Multi-tab** — Open 5+ tabs, switch rapidly, verify no artifacts or leaked contexts.
5. **Remote** — Connect via Cloudflare tunnel, verify terminal renders correctly in external browser.
