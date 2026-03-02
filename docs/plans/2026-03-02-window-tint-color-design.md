# Window Instance Tint Color

## Problem

When running multiple Claude Terminal instances, there's no visual way to distinguish between them.

## Solution

Automatically assign a tint color to each window instance derived from the process PID. The tint is applied to the tab bar, status bar, and window border — subtle enough to preserve the dark theme but distinct enough to tell windows apart at a glance.

## Hue Generation

Use golden angle hash on the process PID:

```typescript
const hue = (process.pid * 137.508) % 360;
```

The golden angle (137.508°) maximizes spacing between sequential values, so even adjacent PIDs produce well-separated hues.

## Tinted Elements

| Element | Base color | Tinted to |
|---------|-----------|-----------|
| `.tab-bar` | `#252526` | `hsl(hue, 30%, 18%)` |
| `.status-bar` | `#252526` | `hsl(hue, 30%, 18%)` |
| `.app` border | none | `1px solid hsl(hue, 40%, 25%)` |

Terminal area (`#1e1e1e`) is untouched.

## Color Characteristics

- **Saturation 30%**: Low enough to feel dark-themed, high enough to distinguish hues
- **Lightness 18%**: Close to original `#252526` (~15% lightness), preserves readability
- **Border 40% sat / 25% lightness**: Slightly more visible to frame the window

## Files Changed

1. `src/main/ipc-handlers.ts` — `instance:getHue` IPC handle
2. `src/preload.ts` — `getInstanceHue()` preload method
3. `src/renderer/global.d.ts` — type for new method
4. `src/renderer/App.tsx` — set `--instance-hue` CSS var on mount
5. `src/renderer/index.css` — use CSS var for tab bar, status bar, app border

## Not In Scope

- No settings persistence — color is ephemeral per process
- No user color picker — fully automatic
- No remote client changes — tint is local renderer only
