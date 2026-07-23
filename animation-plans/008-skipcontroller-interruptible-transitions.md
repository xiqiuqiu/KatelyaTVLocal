# 008 — Make SkipController toasts/drawers interruptible

- **Status**: DONE
- **Commit**: 0094879
- **Severity**: MEDIUM
- **Category**: Interruptibility
- **Estimated scope**: 1 file, medium

## Problem

Toasts and drawers enter via `@keyframes` and often exit by instant `hidden` / unmount — rapid toggle restarts from frame 0:

```tsx
/* src/components/SkipController.tsx:747 — current */
<div className='... animate-fade-in'>
```

```tsx
/* src/components/SkipController.tsx:1441 — current */
<div className='absolute inset-x-0 bottom-0 ... animate-slide-up'>
```

```css
/* :1876-1882 — current */
#skip-segments-panel:not(.hidden) {
  animation: slide-up 0.3s ease-out;
}
#skip-segments-panel {
  transition: all 0.3s ease-out;
}
```

AUDIT: rapidly reversible UI must use transitions/springs so mid-flight retargeting works; drawers use `cubic-bezier(0.32, 0.72, 0, 1)` (`--ease-drawer`).

## Target

1. Toast (countdown / skip notice): keep mounted while visible; drive with classes:

```css
.skip-toast {
  opacity: 0;
  transform: translateY(-8px);
  transition:
    opacity 180ms cubic-bezier(0.23, 1, 0.32, 1),
    transform 180ms cubic-bezier(0.23, 1, 0.32, 1);
}
.skip-toast[data-open='true'] {
  opacity: 1;
  transform: translateY(0);
}
```

2. Mobile drawer: stop using `classList.toggle('hidden')` as the only motion. Prefer React state `isPanelOpen` (if not already) or `data-open` + CSS:

```css
#skip-segments-panel {
  pointer-events: none;
  opacity: 0;
}
#skip-segments-panel[data-open='true'] {
  pointer-events: auto;
  opacity: 1;
}
#skip-segments-panel .skip-sheet {
  transform: translateY(100%);
  transition: transform 280ms cubic-bezier(0.32, 0.72, 0, 1);
}
#skip-segments-panel[data-open='true'] .skip-sheet {
  transform: translateY(0);
}
```

Close path must reverse the same transition (not instant `display: none` mid-way). After transitionend, then unmount/hide if needed.

3. Desktop panel (`:1644`): same opacity/transform transition pattern; delete `animate-fade-in`.

4. Remove obsolete `@keyframes fade-in` / `slide-up` when unused. Never `transition: all`.

## Repo conventions to follow

- Prefer React state already used elsewhere in the file (`isDesktopPanelOpen`) over imperative `classList` when touching the mobile panel.
- Duration budget: toasts 125–200ms; drawers 200–500ms (280ms target).

## Steps

1. Inventory every `animate-fade-in` / `animate-slide-up` usage in `SkipController.tsx`.
2. Convert toasts to transition + `data-open` (or conditional class) with exit delay before unmount (~180ms).
3. Convert mobile sheet + desktop panel similarly; fix close handlers to animate out.
4. Delete dead keyframes; replace `transition: all` in the jsx style block.
5. Coordinate with plan 007 so bounce/pulse cleanup is not reintroduced.

## Boundaries

- Do NOT change skip timing math or segment CRUD.
- Do NOT add gesture drag-to-dismiss unless already present — out of scope.
- Do NOT add new dependencies.

## Verification

- **Mechanical**: `rg "animate-fade-in|animate-slide-up|@keyframes fade-in|@keyframes slide-up" src/components/SkipController.tsx` empty. `pnpm typecheck`.
- **Feel check**: spam open/close skip panel — motion continues from current position, never pops from `translateY(100%)`. Toast show/hide feels interruptible. DevTools 10% playback: transitions, not one-shot keyframes.
- **Done when**: no enter-only keyframes on toast/drawer; close animates.
