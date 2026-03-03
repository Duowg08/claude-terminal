# shadcn/ui + Tailwind CSS Migration Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace all hand-rolled CSS with shadcn/ui components + Tailwind CSS v4 in a single complete overhaul.

**Architecture:** Install Tailwind v4 via Vite plugin, manually set up shadcn (avoids CLI framework detection issues with Electron Forge), install 11 shadcn components, rewrite all 14 renderer components + web client to use Tailwind utilities and shadcn primitives, delete `index.css`.

**Tech Stack:** Tailwind CSS v4, @tailwindcss/vite, shadcn/ui (new-york style), Radix UI primitives, class-variance-authority, clsx, tailwind-merge

**Design doc:** `docs/plans/2026-03-02-shadcn-tailwind-migration-design.md`

---

### Task 1: Install Dependencies

**Files:**
- Modify: `package.json`

**Step 1: Install Tailwind CSS v4 + Vite plugin**

```bash
pnpm add tailwindcss @tailwindcss/vite
```

**Step 2: Install shadcn utility dependencies**

```bash
pnpm add class-variance-authority clsx tailwind-merge tw-animate-css
```

**Step 3: Install Radix UI primitives (used by shadcn components)**

```bash
pnpm add @radix-ui/react-dialog @radix-ui/react-dropdown-menu @radix-ui/react-popover @radix-ui/react-select @radix-ui/react-switch @radix-ui/react-radio-group @radix-ui/react-label @radix-ui/react-slot
```

**Step 4: Verify install**

Run: `pnpm install && pnpm list tailwindcss @tailwindcss/vite`
Expected: packages listed at correct versions

---

### Task 2: Configure Build Tooling

**Files:**
- Modify: `vite.renderer.config.mjs`
- Modify: `vite.web.config.mjs`
- Modify: `tsconfig.json`
- Modify: `vitest.config.ts`

**Step 1: Add Tailwind plugin + `@/` alias to renderer Vite config**

`vite.renderer.config.mjs` should become:

```js
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync('./package.json', 'utf-8'));

export default defineConfig({
  root: './src/renderer',
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve('src/renderer'),
    },
  },
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
});
```

**Step 2: Add Tailwind plugin + `@/` alias to web client Vite config**

`vite.web.config.mjs` should become:

```js
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';

export default defineConfig({
  root: './src/web-client',
  plugins: [react(), tailwindcss()],
  build: {
    outDir: '../../dist/web-client',
    emptyOutDir: true,
  },
  resolve: {
    alias: {
      '@': path.resolve('src/renderer'),
      '@shared': path.resolve('src/shared'),
    },
  },
});
```

**Step 3: Add `@/*` path alias to tsconfig.json**

Add to `compilerOptions.paths`:

```json
"@/*": ["src/renderer/*"]
```

So paths becomes:

```json
"paths": {
  "@shared/*": ["src/shared/*"],
  "@main/*": ["src/main/*"],
  "@/*": ["src/renderer/*"]
}
```

**Step 4: Add `@/` alias to vitest.config.ts**

Add to `resolve.alias`:

```js
'@': path.resolve(__dirname, 'src/renderer'),
```

**Step 5: Verify build starts**

Run: `pnpm start`
Expected: App launches (CSS will look the same since we haven't changed imports yet)

---

### Task 3: Create CSS Foundation + Utility

**Files:**
- Create: `src/renderer/globals.css`
- Create: `src/renderer/lib/utils.ts`
- Create: `components.json`
- Modify: `src/renderer/renderer.tsx` (line 3: change CSS import)
- Modify: `src/web-client/main.tsx` (line 10: change CSS import)

**Step 1: Create `components.json` at project root**

```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "new-york",
  "rsc": false,
  "tsx": true,
  "tailwind": {
    "config": "",
    "css": "src/renderer/globals.css",
    "baseColor": "neutral",
    "cssVariables": true,
    "prefix": ""
  },
  "iconLibrary": "lucide",
  "aliases": {
    "components": "@/components",
    "utils": "@/lib/utils",
    "ui": "@/components/ui",
    "lib": "@/lib",
    "hooks": "@/hooks"
  }
}
```

**Step 2: Create the `cn()` utility**

Create `src/renderer/lib/utils.ts`:

```ts
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

**Step 3: Create `globals.css` with theme tokens**

Create `src/renderer/globals.css`:

```css
@import "tailwindcss";
@import "tw-animate-css";

@custom-variant dark (&:is(.dark *));

@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-card: var(--card);
  --color-card-foreground: var(--card-foreground);
  --color-popover: var(--popover);
  --color-popover-foreground: var(--popover-foreground);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-secondary: var(--secondary);
  --color-secondary-foreground: var(--secondary-foreground);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);
  --color-accent: var(--accent);
  --color-accent-foreground: var(--accent-foreground);
  --color-destructive: var(--destructive);
  --color-destructive-foreground: var(--destructive-foreground);
  --color-border: var(--border);
  --color-input: var(--input);
  --color-ring: var(--ring);
  --color-success: var(--success);
  --color-success-foreground: var(--success-foreground);
  --color-warning: var(--warning);
  --color-warning-foreground: var(--warning-foreground);
  --color-attention: var(--attention);
  --radius-sm: calc(var(--radius) - 4px);
  --radius-md: calc(var(--radius) - 2px);
  --radius-lg: var(--radius);
  --radius-xl: calc(var(--radius) + 4px);
}

:root {
  --radius: 0.375rem;
  --background: #1e1e1e;
  --foreground: #d4d4d4;
  --card: #252526;
  --card-foreground: #d4d4d4;
  --popover: #252526;
  --popover-foreground: #d4d4d4;
  --primary: #007acc;
  --primary-foreground: #ffffff;
  --secondary: #3c3c3c;
  --secondary-foreground: #d4d4d4;
  --muted: #2a2d2e;
  --muted-foreground: #808080;
  --accent: #2a2d2e;
  --accent-foreground: #d4d4d4;
  --destructive: #f44747;
  --destructive-foreground: #ffffff;
  --border: #3c3c3c;
  --input: #3c3c3c;
  --ring: #007acc;
  --success: #6a9955;
  --success-foreground: #ffffff;
  --warning: #dcdcaa;
  --warning-foreground: #1e1e1e;
  --attention: #ce9178;

  /* Instance tint (set from React via JS) */
  --instance-hue: 0;
}

@layer base {
  * {
    @apply border-border;
  }
  body {
    @apply bg-background text-foreground;
    font-family: 'Segoe UI', sans-serif;
    height: 100vh;
    overflow: hidden;
    margin: 0;
    padding: 0;
  }
}
```

**Step 4: Update renderer entry CSS import**

`src/renderer/renderer.tsx` line 3: change `import './index.css';` to `import './globals.css';`

**Step 5: Update web client CSS import**

`src/web-client/main.tsx` line 10: change `import '../renderer/index.css';` to `import '../renderer/globals.css';`

**Step 6: Verify app still launches (will look broken — that's expected since old classes are gone)**

Run: `pnpm start`
Expected: App launches, UI is unstyled (Tailwind is active but components still reference old CSS classes)

**Step 7: Commit**

```bash
git add -A
git commit -m "feat: add Tailwind CSS v4 + shadcn foundation (globals.css, cn utility, components.json)"
```

---

### Task 4: Install shadcn Components

**Files:**
- Create: `src/renderer/components/ui/button.tsx`
- Create: `src/renderer/components/ui/dialog.tsx`
- Create: `src/renderer/components/ui/dropdown-menu.tsx`
- Create: `src/renderer/components/ui/popover.tsx`
- Create: `src/renderer/components/ui/input.tsx`
- Create: `src/renderer/components/ui/select.tsx`
- Create: `src/renderer/components/ui/switch.tsx`
- Create: `src/renderer/components/ui/label.tsx`
- Create: `src/renderer/components/ui/table.tsx`
- Create: `src/renderer/components/ui/badge.tsx`
- Create: `src/renderer/components/ui/radio-group.tsx`

**Step 1: Install all 11 shadcn components**

```bash
pnpm dlx shadcn@latest add button dialog dropdown-menu popover input select switch label table badge radio-group -y
```

If the CLI fails due to framework detection, install manually by copying component source from the shadcn registry. The components.json aliases tell the CLI where to place files.

**Step 2: Verify component files were created**

Check that all 11 `.tsx` files exist in `src/renderer/components/ui/`.

**Step 3: Commit**

```bash
git add src/renderer/components/ui/
git commit -m "feat: install 11 shadcn/ui components (button, dialog, dropdown-menu, popover, input, select, switch, label, table, badge, radio-group)"
```

---

### Task 5: Migrate TabIndicator + StatusBar + UpdateButton

These are the simplest components (30-50 lines each, no shadcn components needed).

**Files:**
- Modify: `src/renderer/components/TabIndicator.tsx` (43 lines)
- Modify: `src/renderer/components/StatusBar.tsx` (49 lines)
- Modify: `src/renderer/components/UpdateButton.tsx` (30 lines)
- Modify: `tests/renderer/TabIndicator.test.tsx` (41 lines)

**Step 1: Rewrite TabIndicator.tsx**

Replace all CSS class references with Tailwind utilities:
- `"tab-indicator tab-indicator-spin"` → `"inline-flex items-center [&_svg]:size-3 text-warning animate-spin"`
- `"tab-indicator"` (idle) → `"inline-flex items-center [&_svg]:size-3 text-success"`
- `"tab-indicator tab-indicator-pulse"` → `"inline-flex items-center [&_svg]:size-3 text-attention animate-pulse"`
- `"tab-indicator"` (new) → `"inline-flex items-center [&_svg]:size-3"`
- `"tab-indicator"` (shell) → `"inline-flex items-center [&_svg]:size-3 text-[#569cd6]"`

Import `cn` from `@/lib/utils` for composing classes.

**Step 2: Update TabIndicator tests**

`tests/renderer/TabIndicator.test.tsx` — tests currently assert on CSS class names like `tab-indicator` and `tab-indicator-spin`. Update assertions to check for Tailwind classes:
- `toHaveClass('tab-indicator')` → check for `inline-flex` or check for the SVG element
- `toHaveClass('tab-indicator-spin')` → check for `animate-spin`
- `toHaveClass('tab-indicator-pulse')` → check for `animate-pulse`

**Step 3: Rewrite StatusBar.tsx**

Replace CSS classes with Tailwind:
- `"status-bar"` → `"flex gap-4 px-3 py-0.5 bg-[hsl(var(--instance-hue)_30%_18%)] text-muted-foreground text-xs min-h-[22px] items-center border-t border-border"`
- `"status-counts"` → `"flex gap-3 items-center"`
- `"status-count tab-status-${status}"` → `cn("inline-flex items-center gap-1", statusColorMap[status])`
- `"hook-status hook-${hookStatus.status}"` → `cn("text-xs", hookColorMap[hookStatus.status])`
- `"status-help"` → `"ml-auto"`

Define color maps:
```ts
const statusColorMap: Record<string, string> = {
  working: 'text-warning',
  requires_response: 'text-attention',
  idle: 'text-success',
};
const hookColorMap: Record<string, string> = {
  running: 'text-warning',
  done: 'text-[#4ec9b0]',
  failed: 'text-destructive',
};
```

**Step 4: Rewrite UpdateButton.tsx**

Replace:
- `"update-btn"` → `"text-[#569cd6] hover:text-[#79b8f8] p-1 flex items-center animate-pulse"`

**Step 5: Run tests**

Run: `pnpm run test`
Expected: All tests pass (TabIndicator tests updated, other tests unaffected)

**Step 6: Commit**

```bash
git add src/renderer/components/TabIndicator.tsx src/renderer/components/StatusBar.tsx src/renderer/components/UpdateButton.tsx tests/renderer/TabIndicator.test.tsx
git commit -m "feat: migrate TabIndicator, StatusBar, UpdateButton to Tailwind"
```

---

### Task 6: Migrate HamburgerMenu

**Files:**
- Modify: `src/renderer/components/HamburgerMenu.tsx` (46 lines)

**Step 1: Rewrite HamburgerMenu.tsx**

Replace hand-rolled dropdown with shadcn `DropdownMenu`:

```tsx
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Menu } from 'lucide-react';
import { Button } from '@/components/ui/button';
```

Structure:
```tsx
<DropdownMenu>
  <DropdownMenuTrigger asChild>
    <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-foreground">
      <Menu size={16} />
    </Button>
  </DropdownMenuTrigger>
  <DropdownMenuContent align="end" className="min-w-[200px]">
    <DropdownMenuItem onClick={onManageWorktrees}>
      <GitBranch size={14} /> Manage Worktrees
    </DropdownMenuItem>
    <DropdownMenuItem onClick={onManageHooks}>
      <Webhook size={14} /> Manage Hooks
    </DropdownMenuItem>
  </DropdownMenuContent>
</DropdownMenu>
```

This eliminates the `useClickOutside` hook usage — Radix DropdownMenu handles outside clicks, focus trapping, and keyboard navigation automatically.

**Step 2: Verify manually**

Run: `pnpm start`
Expected: Hamburger menu opens/closes, items are clickable, Escape closes

**Step 3: Commit**

```bash
git add src/renderer/components/HamburgerMenu.tsx
git commit -m "feat: migrate HamburgerMenu to shadcn DropdownMenu"
```

---

### Task 7: Migrate Simple Dialogs (WorktreeCloseDialog, WorktreeNameDialog)

**Files:**
- Modify: `src/renderer/components/WorktreeCloseDialog.tsx` (51 lines)
- Modify: `src/renderer/components/WorktreeNameDialog.tsx` (72 lines)

**Step 1: Rewrite WorktreeCloseDialog.tsx**

Replace hand-rolled dialog with shadcn `Dialog`:

```tsx
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
```

The parent component (App.tsx) controls open/closed state. Use `Dialog` with `open` prop.

- `"dialog-overlay"` + `"dialog"` → `<Dialog open={true}><DialogContent>`
- `"dialog-text"` → `<DialogDescription>`
- `"dialog-actions"` → `<DialogFooter>`
- `"dialog-btn-danger"` → `<Button variant="destructive">`
- Regular button → `<Button variant="secondary">`

**Step 2: Rewrite WorktreeNameDialog.tsx**

Same pattern. Additionally:
- `"validation-error"` → `<p className="text-xs text-destructive mt-1">`
- `"branch-info"` → `<p className="text-xs text-muted-foreground mt-2">`
- Input → shadcn `<Input>`

```tsx
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
```

**Step 3: Verify manually**

Run: `pnpm start` → create a worktree tab → verify dialog renders → close tab → verify close dialog renders

**Step 4: Commit**

```bash
git add src/renderer/components/WorktreeCloseDialog.tsx src/renderer/components/WorktreeNameDialog.tsx
git commit -m "feat: migrate WorktreeCloseDialog and WorktreeNameDialog to shadcn Dialog"
```

---

### Task 8: Migrate StartupDialog

**Files:**
- Modify: `src/renderer/components/StartupDialog.tsx` (128 lines)

**Step 1: Rewrite StartupDialog.tsx**

Replace with shadcn components:
- Outer dialog → `<Dialog open={true}><DialogContent className="max-w-[480px]">`
- `"startup-header"` → `<DialogHeader className="text-center">`
- `"section-label"` → `<Label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">`
- `"recent-dirs"` / `"recent-dirs li"` → styled `<ul>` / `<li>` with Tailwind (listbox role preserved)
- `"browse-btn"` → `<Button variant="outline" size="sm">`
- `"permission-section"` + radio buttons → shadcn `<RadioGroup>` + `<RadioGroupItem>`
- `"start-btn-primary"` → `<Button className="w-full">`
- `"remove-dir-btn"` → `<Button variant="ghost" size="icon" className="opacity-0 group-hover:opacity-100">`

Add `group` class to list items so remove button shows on hover.

**Step 2: Verify manually**

Run: `pnpm start`
Expected: Startup dialog appears with directory list, browse button, permission radio buttons, start button

**Step 3: Commit**

```bash
git add src/renderer/components/StartupDialog.tsx
git commit -m "feat: migrate StartupDialog to shadcn Dialog + RadioGroup"
```

---

### Task 9: Migrate WorktreeManagerDialog

**Files:**
- Modify: `src/renderer/components/WorktreeManagerDialog.tsx` (138 lines)

**Step 1: Rewrite WorktreeManagerDialog.tsx**

Replace with shadcn components:
- Outer → `<Dialog open={true}><DialogContent className="min-w-[540px] max-w-[680px]">`
- `"wt-empty"` → `<p className="text-muted-foreground text-sm py-4">`
- `"wt-table"` → shadcn `<Table>`, `<TableHeader>`, `<TableRow>`, `<TableHead>`, `<TableBody>`, `<TableCell>`
- `"wt-badge wt-badge-clean"` → `<Badge variant="outline" className="bg-[#1e3a1e] text-success border-0">clean</Badge>`
- `"wt-badge wt-badge-dirty"` → `<Badge variant="outline" className="bg-[#3a3a1e] text-warning border-0">dirty</Badge>`
- `"wt-open-dot"` → `<span className="inline-block size-2 rounded-full bg-success" />`
- Action buttons → `<Button variant="ghost" size="icon">` with hover color classes
- `"wt-confirm"` inline confirm → Tailwind flex with `<Button variant="destructive" size="sm">` and `<Button variant="outline" size="sm">`

**Step 2: Verify manually**

Run: `pnpm start` → open worktree manager → verify table renders, badges show, action buttons work, delete confirm works

**Step 3: Commit**

```bash
git add src/renderer/components/WorktreeManagerDialog.tsx
git commit -m "feat: migrate WorktreeManagerDialog to shadcn Dialog + Table + Badge"
```

---

### Task 10: Migrate HookManagerDialog

This is the most complex component (267 lines, 25+ CSS classes).

**Files:**
- Modify: `src/renderer/components/HookManagerDialog.tsx` (267 lines)

**Step 1: Rewrite HookManagerDialog.tsx**

Replace with shadcn components:
- Outer → `<Dialog open={true}><DialogContent className="w-[700px] max-w-[90vw] max-h-[80vh] flex flex-col">`
- Layout stays as flex with two panels
- Left panel (hook list):
  - `"hook-list-item"` → `<button className={cn("flex items-center justify-between px-2 py-1.5 rounded text-xs cursor-pointer hover:bg-muted", active && "bg-secondary")}>`
  - `"hook-badge"` → `<Badge variant="secondary" className="text-[10px] px-1">`
  - `"hook-toggle"` → shadcn `<Switch>` (replaces custom CSS toggle entirely)
  - `"hook-add-btn"` → `<Button size="sm">`
- Right panel (editor):
  - `"hook-field"` → `<div className="flex flex-col gap-1">`
  - `"hook-field label"` → `<Label>`
  - `"hook-field input"` → `<Input>`
  - `"hook-field select"` → shadcn `<Select>` + `<SelectTrigger>` + `<SelectContent>` + `<SelectItem>`
  - Command rows: Tailwind flex with `<Input>` for path/command, `<Button variant="ghost" size="icon">` for add/remove
  - `"hook-delete-hook-btn"` → `<Button variant="outline" className="text-destructive border-destructive hover:bg-destructive/10">`
  - `"hook-save-btn"` → `<Button variant="default" className="bg-success hover:bg-success/90">`
- Empty state → `<div className="flex flex-col items-center justify-center flex-1 text-muted-foreground gap-2">`

**Step 2: Verify manually**

Run: `pnpm start` → open hook manager → verify list renders, selection works, toggle works, select dropdown works, commands editable, save works

**Step 3: Commit**

```bash
git add src/renderer/components/HookManagerDialog.tsx
git commit -m "feat: migrate HookManagerDialog to shadcn Dialog + Switch + Select + Input"
```

---

### Task 11: Migrate Tab + TabBar

**Files:**
- Modify: `src/renderer/components/Tab.tsx` (149 lines)
- Modify: `src/renderer/components/TabBar.tsx` (168 lines)

**Step 1: Rewrite Tab.tsx**

All Tailwind utilities, no shadcn components (custom drag-drop behavior):

- Tab container: `cn("flex items-center gap-1.5 px-3 py-1.5 cursor-pointer border-r border-border text-[13px] select-none", isActive && "bg-[hsl(var(--instance-hue)_45%_30%)] outline outline-1 outline-[#c9d1d9] font-semibold", !isActive && "hover:bg-[hsl(var(--instance-hue)_20%_24%)]", isDragOver && "border-l-2 border-l-primary")`
- `"tab-rename-input"` → `<Input className="h-6 w-[120px] text-[13px]" />`
- Tab name + number: Tailwind text utilities
- `"tab-worktree"` → `<span className="text-[10px] text-muted-foreground truncate">`
- Chevron dropdown → shadcn `<DropdownMenu>`:
  ```tsx
  <DropdownMenu>
    <DropdownMenuTrigger asChild>
      <button className="text-muted-foreground hover:text-foreground text-xs px-0.5">
        <ChevronDown size={12} />
      </button>
    </DropdownMenuTrigger>
    <DropdownMenuContent>
      <DropdownMenuItem>PowerShell</DropdownMenuItem>
      <DropdownMenuItem>WSL</DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
  ```
- Close button: `<button className="text-muted-foreground hover:text-foreground text-base px-0.5">`

**Step 2: Rewrite TabBar.tsx**

- `"tab-bar"` → `cn("flex bg-[hsl(var(--instance-hue)_30%_18%)] border-b border-border min-h-[36px] items-center px-1 [-webkit-app-region:drag]", isDragging && "[-webkit-app-region:no-drag]")`
- New tab button + dropdown → shadcn `<DropdownMenu>`:
  ```tsx
  <DropdownMenu>
    <DropdownMenuTrigger asChild>
      <button className="text-muted-foreground hover:text-foreground text-xl px-3 py-1 [-webkit-app-region:no-drag]">+</button>
    </DropdownMenuTrigger>
    <DropdownMenuContent>
      <DropdownMenuItem onClick={onNewClaudeTab}>
        Claude Tab <span className="ml-auto text-[11px] text-muted-foreground">Ctrl+T</span>
      </DropdownMenuItem>
      ...
    </DropdownMenuContent>
  </DropdownMenu>
  ```
  This replaces the hand-rolled dropdown + `useClickOutside`.
- `"tab-bar-right"` → `<div className="flex items-center ml-auto [-webkit-app-region:no-drag]">`
- `"new-tab-separator"` → `<DropdownMenuSeparator />`

**Step 3: Verify manually**

Run: `pnpm start` → verify tabs render, click to switch, drag to reorder, new tab dropdown works, chevron dropdown on shell tabs works, rename on F2/double-click works

**Step 4: Commit**

```bash
git add src/renderer/components/Tab.tsx src/renderer/components/TabBar.tsx
git commit -m "feat: migrate Tab and TabBar to Tailwind + shadcn DropdownMenu"
```

---

### Task 12: Migrate RemoteAccessButton

**Files:**
- Modify: `src/renderer/components/RemoteAccessButton.tsx` (167 lines)

**Step 1: Rewrite RemoteAccessButton.tsx**

Replace dropdown with shadcn `<Popover>` (complex content, not a simple menu):

```tsx
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
```

- Trigger: `<PopoverTrigger asChild><Button variant="ghost" size="icon" className={cn(statusClasses)}>` (replaces `useClickOutside`)
- Content: `<PopoverContent align="end" className="w-[260px] p-3">`
- `"remote-access-header"` → `<h3 className="text-sm font-semibold">`
- `"remote-access-desc"` → `<p className="text-xs text-muted-foreground">`
- `"remote-access-action"` → `<Button className="w-full mt-2">`
- `"remote-access-action remote-deactivate"` → `<Button variant="secondary" className="w-full mt-2">`
- Progress bar: `<div className="h-1 bg-secondary rounded mt-1.5 overflow-hidden"><div className="h-full bg-primary rounded transition-[width]" style={{ width: ... }} /></div>`
- `"remote-access-status"` → `<div className="text-xs text-success mb-2">`
- Copy fields: Tailwind flex rows with `<Button variant="outline" size="sm">` for copy
- `"remote-access-error"` → `<p className="text-xs text-destructive mb-2">`

**Step 2: Verify manually**

Run: `pnpm start` → click cloud icon → verify popover renders in each state (inactive, connecting, active, error)

**Step 3: Commit**

```bash
git add src/renderer/components/RemoteAccessButton.tsx
git commit -m "feat: migrate RemoteAccessButton to shadcn Popover"
```

---

### Task 13: Migrate Terminal Component

**Files:**
- Modify: `src/renderer/components/Terminal.tsx` (306 lines)

**Step 1: Minimal Terminal.tsx changes**

Terminal has only 1 CSS class (`"terminal-container"`) and 1 inline style. Replace:

- `className="terminal-container"` → `className="absolute inset-0"`
- Keep the inline `style={{ display: isVisible ? 'block' : 'none' }}` (this is dynamic and fine as-is)
- Keep the `@xterm/xterm/css/xterm.css` import (vendor CSS, not ours)

**Step 2: Commit**

```bash
git add src/renderer/components/Terminal.tsx
git commit -m "feat: migrate Terminal container to Tailwind"
```

---

### Task 14: Migrate App.tsx

**Files:**
- Modify: `src/renderer/App.tsx` (426 lines)

**Step 1: Rewrite CSS class references in App.tsx**

Only 7 class references to replace:

- `"app"` → `"flex flex-col h-screen border border-[hsl(var(--instance-hue)_40%_25%)]"`
- `"terminal-area"` → `"flex-1 relative overflow-hidden"`
- Alert dialog (lines 414-418): Replace hand-rolled dialog with shadcn `Dialog`:
  ```tsx
  <Dialog open={!!alertMessage} onOpenChange={() => setAlertMessage(null)}>
    <DialogContent>
      <DialogHeader><DialogTitle>Error</DialogTitle></DialogHeader>
      <DialogDescription>{alertMessage}</DialogDescription>
      <DialogFooter>
        <Button autoFocus onClick={() => setAlertMessage(null)}>OK</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
  ```

Add imports:
```tsx
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
```

**Step 2: Verify manually**

Run: `pnpm start`
Expected: Full app renders with all components styled correctly

**Step 3: Commit**

```bash
git add src/renderer/App.tsx
git commit -m "feat: migrate App.tsx to Tailwind + shadcn Dialog"
```

---

### Task 15: Migrate Web Client

**Files:**
- Modify: `src/web-client/main.tsx` (426 lines)
- Modify: `src/web-client/web-client.css` (50 lines)

**Step 1: Rewrite web client CSS class references in main.tsx**

The web client has 3 screens that use old CSS classes: TokenScreen, RemoteApp, DisconnectedScreen.

TokenScreen:
- `"app"` → `"flex flex-col h-dvh"`
- `"dialog-overlay"` + `"dialog startup-dialog"` → shadcn `<Dialog>` with `<DialogContent>`
- `"startup-header"` → `<DialogHeader className="text-center">`
- `"section-label"` → `<Label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">`
- `"validation-error"` → `<p className="text-xs text-destructive mt-1">`
- `"dialog-actions"` → `<DialogFooter>`
- `"start-btn-primary"` → `<Button className="w-full">`
- Replace inline styles with Tailwind classes

RemoteApp:
- `"app"` → `"flex flex-col h-dvh"`
- `"terminal-area"` → `"flex-1 relative overflow-auto [-webkit-overflow-scrolling:touch]"` (web client overrides)
- Alert dialog → shadcn `<Dialog>` (same as App.tsx)

DisconnectedScreen:
- Same pattern as TokenScreen

**Step 2: Rewrite web-client.css**

Convert overrides to Tailwind. Since the web client's components now use Tailwind classes, the overrides need a different approach. Create a minimal `web-client.css`:

```css
/* Web client overrides — applied via Tailwind on the elements directly.
   Only keep overrides that can't be expressed in JSX. */

/* Terminal container in web client: relative positioning, natural size */
.web-terminal-area .absolute {
  position: relative;
  inset: auto;
  width: max-content;
  min-width: 100%;
  height: max-content;
  min-height: 100%;
}
```

Most overrides move into the JSX as conditional Tailwind classes (e.g., the web client passes different className to `terminal-area` div).

**Step 3: Verify web client build**

Run: `pnpm run build:web`
Expected: Builds without errors

**Step 4: Commit**

```bash
git add src/web-client/main.tsx src/web-client/web-client.css
git commit -m "feat: migrate web client to Tailwind + shadcn"
```

---

### Task 16: Delete index.css + Cleanup

**Files:**
- Delete: `src/renderer/index.css`
- Modify: `src/renderer/index.html` (line 7: update inline body style)

**Step 1: Delete the old CSS file**

```bash
rm src/renderer/index.css
```

**Step 2: Update index.html body background**

Line 7: Change inline style to use theme variable:
```html
<body style="background: var(--background) url('/icon-original.png') repeat; background-size: 64px 64px;">
```

**Step 3: Remove unused `useClickOutside` hook if no longer imported**

Check if any component still uses `src/renderer/hooks/useClickOutside.ts`. After migration:
- HamburgerMenu → uses shadcn DropdownMenu (no useClickOutside)
- RemoteAccessButton → uses shadcn Popover (no useClickOutside)
- TabBar → uses shadcn DropdownMenu (no useClickOutside)
- Tab → uses shadcn DropdownMenu (no useClickOutside)

If no component imports it, delete `src/renderer/hooks/useClickOutside.ts`.

**Step 4: Verify no references to old CSS class names remain**

```bash
grep -r "className=\"tab-bar\|className=\"dialog-overlay\|className=\"hook-\|className=\"wt-\|className=\"remote-access\|className=\"status-bar\|className=\"hamburger\|className=\"new-tab\|className=\"startup\|className=\"section-label\|className=\"browse-btn\|className=\"start-btn" src/renderer/ src/web-client/
```

Expected: No matches.

**Step 5: Commit**

```bash
git add -A
git commit -m "chore: delete index.css, remove useClickOutside hook, clean up old CSS references"
```

---

### Task 17: Run Tests + Verify Build

**Files:** None (verification only)

**Step 1: Run all tests**

```bash
pnpm run test
```

Expected: All tests pass. The only renderer test (TabIndicator) was updated in Task 5. Main process tests are unaffected.

**Step 2: Verify dev mode**

```bash
pnpm start
```

Walk through every UI surface:
- Startup dialog (directory list, browse, permission radios, start button)
- Tab bar (create tabs, switch, reorder via drag, rename via F2)
- New tab dropdown (Claude tab, worktree, PowerShell, WSL)
- Tab chevron dropdown on shell tabs
- Hamburger menu (worktree manager, hook manager)
- Worktree manager dialog (table, badges, action buttons, delete confirm)
- Hook manager dialog (list, toggle, editor, select, commands, save)
- Remote access popover (activate flow)
- Status bar (counts, hook status)
- Close tab → close dialog (clean vs dirty)
- Instance hue tinting (open second window — should tint differently)

**Step 3: Verify web client builds**

```bash
pnpm run build:web
```

Expected: Builds without errors.

**Step 4: Verify production build**

```bash
pnpm run make
```

Expected: Builds without errors.

**Step 5: Final commit (if any fixups needed)**

```bash
git add -A
git commit -m "fix: post-migration fixes from verification"
```

---

### Task 18: Update Documentation

**Files:**
- Modify: `AGENTS.md` (Tech Stack section, CSS references)
- Modify: `docs/development.md` (if it exists — add Tailwind/shadcn dev notes)

**Step 1: Update AGENTS.md**

- Tech Stack: add `shadcn/ui (new-york) + Tailwind CSS v4`
- Key Architecture Decisions: add note about shadcn + Tailwind replacing hand-rolled CSS
- Common Patterns: add `cn()` utility pattern, shadcn component imports from `@/components/ui/*`

**Step 2: Commit**

```bash
git add AGENTS.md docs/
git commit -m "docs: update AGENTS.md and docs for shadcn + Tailwind migration"
```
