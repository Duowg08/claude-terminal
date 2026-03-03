# WebGL Renderer Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the default DOM renderer with WebGL for GPU-accelerated terminal rendering, with automatic DOM fallback on failure.

**Architecture:** Load `@xterm/addon-webgl` once per terminal after `term.open()`. Store addon reference on terminal cache for lifecycle management. Handle context loss by disposing addon (reverts to DOM). Same `Terminal.tsx` component serves both Electron and remote web client — no branching needed.

**Tech Stack:** `@xterm/addon-webgl`, xterm.js v6, React, TypeScript

---

### Task 1: Install dependency

**Files:**
- Modify: `package.json`

**Step 1: Install @xterm/addon-webgl**

Run: `pnpm add -D @xterm/addon-webgl`

**Step 2: Verify installation**

Run: `pnpm ls @xterm/addon-webgl`
Expected: Shows installed version (should be ~0.19.x, compatible with @xterm/xterm@6.x)

**Step 3: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "feat: add @xterm/addon-webgl dependency"
```

---

### Task 2: Add WebGL addon to terminal cache

**Files:**
- Modify: `src/renderer/components/terminalCache.ts:1-11` (interface + import)
- Modify: `src/renderer/components/terminalCache.ts:22-28` (destroyTerminal)

**Step 1: Add import and update interface**

Add `WebglAddon` import and optional field to `CachedTerminal`:

```typescript
import { WebglAddon } from '@xterm/addon-webgl';

export interface CachedTerminal {
  term: XTerm;
  fitAddon: FitAddon;
  serializeAddon: SerializeAddon;
  onDataDisposable?: IDisposable;
  webglAddon?: WebglAddon;
}
```

**Step 2: Dispose WebGL addon in destroyTerminal**

Update `destroyTerminal` to dispose the WebGL addon before disposing the terminal:

```typescript
export function destroyTerminal(tabId: string): void {
  const cached = terminalCache.get(tabId);
  if (cached) {
    cached.webglAddon?.dispose();
    cached.onDataDisposable?.dispose();
    cached.term.dispose();
    terminalCache.delete(tabId);
  }
  pendingBytes.delete(tabId);
  pausedTabs.delete(tabId);
  pendingWrites.delete(tabId);
}
```

**Step 3: Verify build**

Run: `pnpm exec tsc --noEmit`
Expected: No type errors

**Step 4: Commit**

```bash
git add src/renderer/components/terminalCache.ts
git commit -m "feat: add WebGL addon field to terminal cache"
```

---

### Task 3: Load WebGL addon in Terminal.tsx

**Files:**
- Modify: `src/renderer/components/Terminal.tsx:1-7` (imports)
- Modify: `src/renderer/components/Terminal.tsx:184-190` (!alreadyAttached block)

**Step 1: Add import**

Add to imports at top of `Terminal.tsx`:

```typescript
import { WebglAddon } from '@xterm/addon-webgl';
```

**Step 2: Load WebGL after term.open()**

Replace the `!alreadyAttached` block (lines 184-190) with:

```typescript
    if (!alreadyAttached) {
      // Clear container and attach
      container.innerHTML = '';
      term.open(container);

      // Activate WebGL renderer (replaces default DOM renderer)
      if (!cached.webglAddon) {
        try {
          const webglAddon = new WebglAddon();
          webglAddon.onContextLoss(() => {
            webglAddon.dispose();
            cached!.webglAddon = undefined;
          });
          term.loadAddon(webglAddon);
          cached.webglAddon = webglAddon;
        } catch {
          // WebGL unavailable — DOM renderer remains active
        }
      }

      attachedRef.current = tabId;
    }
```

**Step 3: Verify build**

Run: `pnpm exec tsc --noEmit`
Expected: No type errors

**Step 4: Commit**

```bash
git add src/renderer/components/Terminal.tsx
git commit -m "feat: load WebGL renderer with DOM fallback"
```

---

### Task 4: Manual verification

**Step 1: Start the app**

Run: `pnpm start`

**Step 2: Visual checks**

- Open a terminal tab — verify single cursor, no duplicate rendering
- Run `ls --color` or a colorful command — verify colors render correctly
- Type text — verify no input lag
- Scroll through output — verify smooth scrolling

**Step 3: Multi-tab check**

- Open 3+ tabs with `Ctrl+T`
- Switch between them rapidly — verify no rendering artifacts
- Close tabs — verify no errors in DevTools console

**Step 4: Confirm WebGL is active**

Open DevTools console and run:
```javascript
document.querySelector('.xterm canvas')?.getContext('webgl2') !== null
```
Expected: `true` (WebGL canvas exists)

Alternatively, check that the `.xterm` container has multiple canvas elements (WebGL addon creates its own canvas alongside the DOM).

**Step 5: Remote access check**

- Enable remote access via hamburger menu
- Connect from external browser
- Verify terminal renders correctly in remote browser

---

### Task 5: Run existing tests

**Step 1: Run full test suite**

Run: `pnpm test`
Expected: All existing tests pass (WebGL addon is a runtime concern — no tests should break from the import/type changes)

**Step 2: Commit if any test fixes were needed**

Only if tests revealed issues from the changes above.
