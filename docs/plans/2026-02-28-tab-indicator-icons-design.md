# Tab Status Indicator Icons — Design

## Problem

The current tab status indicators use Unicode characters (`●`, `◉`, `◈`, `○`) which look dated and don't clearly communicate meaning. The `new` status shows a blue dot that adds no value.

## Decision

Replace Unicode indicators with Lucide React icons and CSS animations.

## Icon Mapping

| Status | Before | After | Animation | Color |
|--------|--------|-------|-----------|-------|
| `new` | `●` blue | *(none)* | — | — |
| `working` | `◉` yellow | `Loader2` | Smooth spin (1s, linear, infinite) | Yellow (#dcdcaa) |
| `idle` | `○` green | `CheckCircle2` | Static | Green (#6a9955) |
| `requires_response` | `◈` orange | `MessageCircle` | Pulse (opacity 0.4→1, 1.5s, ease-in-out) | Orange (#ce9178) |

## Changes

### 1. Install dependency
- `npm install lucide-react`

### 2. New component: `src/renderer/components/TabIndicator.tsx`
- Takes `status: TabStatus` prop
- Returns the appropriate Lucide icon (size 12) or `null` for `new`
- Icons use `currentColor` so color is controlled by parent CSS

### 3. Update `src/renderer/components/Tab.tsx`
- Replace `import { STATUS_INDICATORS }` with `import TabIndicator`
- Replace `<span className="tab-indicator">{STATUS_INDICATORS[tab.status]}</span>` with `<TabIndicator status={tab.status} />`

### 4. Update `src/renderer/components/StatusBar.tsx`
- Same replacement as Tab.tsx
- Keep the text label next to the icon

### 5. Update `src/renderer/index.css`
- Replace `.tab-indicator` font-size rule with icon sizing (width/height 12px)
- Add `@keyframes spin` for working state
- Add `@keyframes pulse` for requires_response state
- Keep existing color rules (they work with Lucide's `currentColor`)

### 6. Clean up `src/shared/types.ts`
- Remove `STATUS_INDICATORS` constant (no longer used)

## What stays the same
- `TabStatus` type and all status values
- Status update flow from main process hooks
- `window-title.ts` uses text labels, not icons — unaffected
- Tab bar layout and sizing
