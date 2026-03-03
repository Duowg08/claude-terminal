# shadcn/ui + Tailwind CSS Migration Design

## Goal

Replace the hand-rolled CSS (`index.css`, 420 lines) with shadcn/ui components + Tailwind CSS v4. Full overhaul in one pass — no incremental halfway state.

**Motivations:**
- Theme switching support (dark/light/custom via CSS variables)
- Accessible UI primitives (focus trapping, keyboard nav, ARIA) for dialogs, dropdowns, toggles
- Modern component library for future UI work

## Build Setup

**Tailwind v4** uses its Vite plugin directly (no PostCSS config):

```js
// vite.renderer.config.mjs
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  root: './src/renderer',
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve('src/renderer'),
    },
  },
});
```

- Add `@/*` path alias to `tsconfig.json` and both `vite.renderer.config.mjs` and `vite.web.config.mjs`
- Web client config gets the same Tailwind plugin for consistent theming
- No impact on main process or preload — Tailwind is renderer-only
- shadcn CLI workaround: create `components.json` pointing at `src/renderer/components/ui/`

## CSS Architecture

**Delete `index.css` entirely.** Replace with:

```
src/renderer/
  globals.css          <- @import "tailwindcss"; theme variables, base resets
  components/ui/       <- shadcn components (Button, Dialog, DropdownMenu, etc.)
```

**Theme tokens in `globals.css`:**

```css
@import "tailwindcss";

@theme {
  --color-background: #1e1e1e;
  --color-foreground: #d4d4d4;
  --color-card: #252526;
  --color-border: #3c3c3c;
  --color-primary: #007acc;
  --color-primary-foreground: #ffffff;
  --color-destructive: #f44747;
  --color-muted: #808080;
  --color-accent: #2a2d2e;
  --color-success: #6a9955;
  --color-warning: #dcdcaa;
  --color-attention: #ce9178;
  --radius-sm: 0.25rem;
  --radius-md: 0.375rem;
  --radius-lg: 0.5rem;
}
```

**Instance hue tinting** stays as a CSS variable set from React, referenced via Tailwind arbitrary values: `bg-[hsl(var(--instance-hue)_30%_18%)]`.

No light theme initially — just the dark palette. Light theme is a future addition (add a `.light` scope with overridden variables).

## Component Mapping

### shadcn components to install (11 total)

| shadcn component | Replaces | Used by |
|---|---|---|
| `Button` | `.dialog button`, `.start-btn`, `.browse-btn`, `.new-tab-btn`, `.tab-close`, `.wt-action-btn`, `.hook-add-btn` | All dialogs, tab bar, worktree manager, hook manager |
| `Dialog` | `.dialog-overlay` + `.dialog` | StartupDialog, WorktreeNameDialog, WorktreeCloseDialog, WorktreeManagerDialog, HookManagerDialog |
| `DropdownMenu` | `.hamburger-dropdown`, `.new-tab-dropdown`, `.tab-chevron-dropdown` | HamburgerMenu, TabBar (new tab menu), Tab (chevron) |
| `Popover` | `.remote-access-dropdown` | RemoteAccessButton |
| `Input` | `.dialog input`, `.tab-rename-input`, `.hook-field input` | All forms, inline tab rename |
| `Select` | `.hook-field select` | HookManagerDialog (event type picker) |
| `Switch` | `.hook-toggle` + `.hook-toggle-slider` | HookManagerDialog (enable/disable) |
| `Label` | `.section-label`, `.hook-field label` | Form labels |
| `Table` | `.wt-table` | WorktreeManagerDialog |
| `Badge` | `.wt-badge-clean`, `.wt-badge-dirty` | WorktreeManagerDialog |
| `RadioGroup` | `.radio-option` | StartupDialog (permission mode) |

### NOT using shadcn — Tailwind utilities only

| Element | Why | Approach |
|---|---|---|
| Tab bar | Custom drag-drop reordering, no standard component fits | Tailwind + native HTML drag-drop (same logic, restyled) |
| Individual tabs | Custom content (indicators, rename mode, drag events) | Tailwind utilities for layout, icons, animations |
| Tab status indicators | Just lucide icons with CSS animations | Lucide icons + Tailwind animate classes |
| Status bar | Simple layout with defined areas | Tailwind with left/right slots |
| Terminal container | Just a positioned div for xterm.js | Positioned div |
| Cloudflared progress | One-off install UI, seen once | Tailwind width-transition div |

## Migration Strategy

Full overhaul — every component gets rewritten in one pass:
- JSX structure stays the same (same component tree, same props, same state logic)
- All styling moves from CSS class names to Tailwind utility classes
- Hand-rolled UI primitives replaced with shadcn equivalents
- `index.css` deleted entirely, replaced by `globals.css` (theme tokens only)

## Dependencies Added

- `tailwindcss` + `@tailwindcss/vite` (Tailwind v4)
- `class-variance-authority` (shadcn component variants)
- `clsx` + `tailwind-merge` (className composition via `cn()` utility)
- `@radix-ui/react-dialog`, `@radix-ui/react-dropdown-menu`, `@radix-ui/react-popover`, `@radix-ui/react-select`, `@radix-ui/react-switch`, `@radix-ui/react-radio-group`, `@radix-ui/react-label` (Radix primitives used by shadcn)

## Bundle Impact

- Tailwind CSS: ~3-10 KB gzipped (purged)
- shadcn component JS (11 components): ~20-40 KB gzipped
- Total: +30-60 KB gzipped
