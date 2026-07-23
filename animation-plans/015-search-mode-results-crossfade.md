# 015 — Crossfade search mode and skeleton→results

- **Status**: DONE
- **Commit**: 0094879
- **Severity**: LOW (missed opportunity)
- **Category**: Missed opportunities
- **Estimated scope**: 1 file (`search/page.tsx`), medium

## Problem

Search page hard-cuts between AI panel, skeletons, and results:

```tsx
/* src/app/search/page.tsx:299-318 — current */
{searchMode === 'ai' ? (
  <AiFindPanel initialQuery={searchQuery} />
) : isLoading ? (
  <section>...</PosterGrid skeletons...</section>
) : showResults ? (
  <section>...results...</section>
) : ...}
```

AUDIT missed opportunity: brief transition prevents jarring state change; optional `blur(2px)` mask during crossfade.

## Target

Wrap the mode/result body in a single container that keys on `searchMode + viewState` and fades:

- Duration: **180–200ms**
- Ease: `cubic-bezier(0.23, 1, 0.32, 1)`
- Properties: `opacity` (optional `filter: blur(2px)` only mid-crossfade, never >2px)
- Do **not** revive PosterGrid 480ms stagger (plan 005)

Minimal approach without new libraries:

```tsx
<div
  key={`${searchMode}-${isLoading ? 'loading' : 'ready'}`}
  className="ui-search-view transition-opacity duration-200 ease-out"
>
  ...current branch...
</div>
```

With CSS:

```css
@keyframes ui-search-swap {
  from { opacity: 0; }
  to { opacity: 1; }
}
.ui-search-view {
  animation: ui-search-swap 180ms cubic-bezier(0.23, 1, 0.32, 1);
}
```

Prefer transition + `@starting-style` if browser support matrix allows; keyframe once-on-mount is acceptable here because mode switches are occasional (not toast spam). Still avoid animating layout.

AI ↔ normal toggle should fade the body; the mode switch control itself stays instant.

## Repo conventions to follow

- Stay in `search/page.tsx` + maybe a tiny rule in `ui-theme.css`.
- No Framer Motion.

## Steps

1. Identify the conditional block starting ~299.
2. Add keyed wrapper + 180ms opacity enter for branch changes.
3. Ensure skeleton→results triggers the fade (key must change when `isLoading` flips).
4. Reduced-motion: disable animation (plan 002 / `animation: none` on `.ui-search-view`).

## Boundaries

- Do NOT alter search fetch logic, aggregation, or AiFindPanel internals (plan 016 covers group-level enter).
- Do NOT add blur >2px.
- Do NOT block clicks for the duration of the fade.

## Verification

- **Mechanical**: `pnpm typecheck`.
- **Feel check**: toggle 普通/AI; run a search — skeleton soft-swaps to results; no double-exposed layout thrash. Reduced-motion: instant swap.
- **Done when**: mode and loading→results changes use ≤200ms opacity enter.
