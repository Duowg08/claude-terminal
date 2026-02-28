# Tab Indicator Icons Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace Unicode tab status indicators with Lucide React icons and CSS animations.

**Architecture:** New `TabIndicator` component maps `TabStatus` to Lucide icons. CSS keyframes handle spin and pulse animations. Existing color scheme preserved via `currentColor`.

**Tech Stack:** lucide-react, React, CSS animations, Vitest + @testing-library/react

---

### Task 1: Install lucide-react

**Files:**
- Modify: `package.json`

**Step 1: Install the dependency**

Run: `npm install lucide-react`

**Step 2: Verify installation**

Run: `npm ls lucide-react`
Expected: `lucide-react@x.x.x` appears in tree

**Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "deps: add lucide-react for tab status icons"
```

---

### Task 2: Create TabIndicator component with tests

**Files:**
- Create: `src/renderer/components/TabIndicator.tsx`
- Create: `tests/renderer/TabIndicator.test.tsx`

**Step 1: Write the tests**

```tsx
// tests/renderer/TabIndicator.test.tsx
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import TabIndicator from '../../src/renderer/components/TabIndicator';

describe('TabIndicator', () => {
  it('renders nothing for new status', () => {
    const { container } = render(<TabIndicator status="new" />);
    expect(container.innerHTML).toBe('');
  });

  it('renders a spinning icon for working status', () => {
    const { container } = render(<TabIndicator status="working" />);
    const svg = container.querySelector('svg');
    expect(svg).toBeTruthy();
    expect(container.firstElementChild).toHaveClass('tab-indicator', 'tab-indicator-spin');
  });

  it('renders a static icon for idle status', () => {
    const { container } = render(<TabIndicator status="idle" />);
    const svg = container.querySelector('svg');
    expect(svg).toBeTruthy();
    expect(container.firstElementChild).toHaveClass('tab-indicator');
    expect(container.firstElementChild).not.toHaveClass('tab-indicator-spin');
  });

  it('renders a pulsing icon for requires_response status', () => {
    const { container } = render(<TabIndicator status="requires_response" />);
    const svg = container.querySelector('svg');
    expect(svg).toBeTruthy();
    expect(container.firstElementChild).toHaveClass('tab-indicator', 'tab-indicator-pulse');
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/renderer/TabIndicator.test.tsx`
Expected: FAIL — module not found

**Step 3: Write the TabIndicator component**

```tsx
// src/renderer/components/TabIndicator.tsx
import { Loader2, CheckCircle2, MessageCircle } from 'lucide-react';
import type { TabStatus } from '../../shared/types';

const ICON_SIZE = 12;

interface TabIndicatorProps {
  status: TabStatus;
}

export default function TabIndicator({ status }: TabIndicatorProps) {
  switch (status) {
    case 'working':
      return (
        <span className="tab-indicator tab-indicator-spin">
          <Loader2 size={ICON_SIZE} />
        </span>
      );
    case 'idle':
      return (
        <span className="tab-indicator">
          <CheckCircle2 size={ICON_SIZE} />
        </span>
      );
    case 'requires_response':
      return (
        <span className="tab-indicator tab-indicator-pulse">
          <MessageCircle size={ICON_SIZE} />
        </span>
      );
    default:
      return null;
  }
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/renderer/TabIndicator.test.tsx`
Expected: 4 tests PASS

**Step 5: Commit**

```bash
git add src/renderer/components/TabIndicator.tsx tests/renderer/TabIndicator.test.tsx
git commit -m "feat: add TabIndicator component with Lucide icons"
```

---

### Task 3: Wire TabIndicator into Tab and StatusBar

**Files:**
- Modify: `src/renderer/components/Tab.tsx:3,74`
- Modify: `src/renderer/components/StatusBar.tsx:2,15`

**Step 1: Update Tab.tsx**

Replace:
```tsx
import { STATUS_INDICATORS } from '../../shared/types';
```
With:
```tsx
import TabIndicator from './TabIndicator';
```

Replace:
```tsx
<span className="tab-indicator">{STATUS_INDICATORS[tab.status]}</span>
```
With:
```tsx
<TabIndicator status={tab.status} />
```

**Step 2: Update StatusBar.tsx**

Replace:
```tsx
import { STATUS_INDICATORS } from '../../shared/types';
```
With:
```tsx
import TabIndicator from './TabIndicator';
```

Replace:
```tsx
{STATUS_INDICATORS[tab.status]} {tab.status}
```
With:
```tsx
<TabIndicator status={tab.status} /> {tab.status}
```

**Step 3: Run full test suite**

Run: `npx vitest run`
Expected: All tests pass

**Step 4: Commit**

```bash
git add src/renderer/components/Tab.tsx src/renderer/components/StatusBar.tsx
git commit -m "feat: use TabIndicator in Tab and StatusBar components"
```

---

### Task 4: Update CSS — animations and icon styling

**Files:**
- Modify: `src/renderer/index.css:32-36`

**Step 1: Replace indicator CSS rules**

Find lines 32-36:
```css
.tab-indicator { font-size: 10px; }
.tab-status-working .tab-indicator { color: #dcdcaa; }
.tab-status-requires_response .tab-indicator { color: #ce9178; }
.tab-status-idle .tab-indicator { color: #6a9955; }
.tab-status-new .tab-indicator { color: #569cd6; }
```

Replace with:
```css
.tab-indicator { display: inline-flex; align-items: center; }
.tab-indicator svg { width: 12px; height: 12px; }
.tab-status-working .tab-indicator { color: #dcdcaa; }
.tab-status-requires_response .tab-indicator { color: #ce9178; }
.tab-status-idle .tab-indicator { color: #6a9955; }

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
.tab-indicator-spin svg { animation: spin 1s linear infinite; }

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}
.tab-indicator-pulse svg { animation: pulse 1.5s ease-in-out infinite; }
```

**Step 2: Verify visually**

Run: `npm start`
- Open app, check new tab has no indicator
- Trigger a working state — should see spinning loader icon in yellow
- Let it go idle — should see green checkmark, static
- Trigger requires_response — should see orange pulsing message icon

**Step 3: Commit**

```bash
git add src/renderer/index.css
git commit -m "style: add spin and pulse animations for tab indicators"
```

---

### Task 5: Remove STATUS_INDICATORS dead code

**Files:**
- Modify: `src/shared/types.ts:36-41`

**Step 1: Verify no remaining references**

Run: `grep -r "STATUS_INDICATORS" src/`
Expected: No matches (only docs/ references remain, which is fine)

**Step 2: Remove the constant from types.ts**

Delete lines 36-41:
```typescript
export const STATUS_INDICATORS: Record<TabStatus, string> = {
  new: '●',
  working: '◉',
  requires_response: '◈',
  idle: '○',
};
```

**Step 3: Run full test suite**

Run: `npx vitest run`
Expected: All tests pass

**Step 4: Commit**

```bash
git add src/shared/types.ts
git commit -m "cleanup: remove unused STATUS_INDICATORS unicode constant"
```
