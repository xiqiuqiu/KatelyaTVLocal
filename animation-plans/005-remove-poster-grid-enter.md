# 005 — Remove decorative PosterGrid enter; shorten page reveal

- **Status**: TODO
- **Commit**: 0094879
- **Severity**: HIGH
- **Category**: Purpose & frequency / Easing & duration
- **Estimated scope**: 1 CSS file (+ optional AppShell class), small

## Problem

High-traffic grids re-run a 480ms staggered entrance on every mount; page shell uses 520ms:

```css
/* src/styles/ui-theme.css:214-220 — current */
.ui-reveal {
  animation: ui-content-enter 520ms ease-out both;
}

.ui-poster-grid > * {
  animation: ui-content-enter 480ms ease-out both;
  animation-delay: min(calc(var(--ui-item-index, 0) * 34ms), 260ms);
}
```

Used via `PosterGrid` (`ui-poster-grid`) and `AppShell` (`ui-reveal`). AUDIT: decorative list-item motion on constantly hit surfaces should be removed; UI animations stay under 300ms.

## Target

```css
/* target — src/styles/ui-theme.css */
.ui-reveal {
  animation: ui-content-enter 220ms cubic-bezier(0.23, 1, 0.32, 1) both;
}

.ui-poster-grid > * {
  animation: none;
}

/* keep nth-child --ui-item-index rules only if another feature needs them;
   otherwise delete the --ui-item-index blocks (lines ~223-241) as dead CSS */
```

Keyframe can stay for `.ui-reveal`:

```css
@keyframes ui-content-enter {
  from {
    opacity: 0;
    transform: translateY(8px); /* reduce 12px → 8px for snappier UI enter */
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
```

Update reduced-motion block accordingly (still `animation: none` on `.ui-reveal`).

## Repo conventions to follow

- Motion durations should align with `--ui-motion-slow: 240ms` (plan 010). 220–240ms is in budget.
- Do not add stagger back onto `ScrollableRow`.

## Steps

1. Set `.ui-poster-grid > * { animation: none; }` and remove delay / item-index rules if unused elsewhere (`rg "ui-item-index" src`).
2. Shorten `.ui-reveal` to 220ms (or `var(--ui-motion-slow)`) with `cubic-bezier(0.23, 1, 0.32, 1)`.
3. Optionally reduce keyframe translate from 12px to 8px.
4. Leave `PosterGrid.tsx` markup unchanged unless a class becomes unused.

## Boundaries

- Do NOT add new list entrances elsewhere.
- Do NOT change grid breakpoints / gaps.
- Plans 015/016 may add short opacity fades for search/AI — those are separate and must stay ≤200ms, not revive 480ms stagger.

## Verification

- **Mechanical**: `rg "ui-content-enter" src/styles/ui-theme.css` shows only `.ui-reveal` using it. `pnpm typecheck`.
- **Feel check**: load home and search — posters appear instantly (no cascade). Navigate between pages — shell reveal feels quick (<300ms), not floaty.
- **Done when**: poster children do not animate; `.ui-reveal` ≤240ms.
