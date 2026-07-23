# 004 — Animate progress bars with `scaleX`, not `width`

- **Status**: DONE
- **Commit**: 0094879
- **Severity**: HIGH
- **Category**: Performance
- **Estimated scope**: 2 files, small

## Problem

Progress fills animate layout width with long durations:

```tsx
/* src/components/VideoCard.tsx:483-488 — current */
<div className='mt-2 h-1.5 w-full overflow-hidden rounded-full bg-white/10'>
  <div
    className='h-full rounded-full bg-[rgb(var(--ui-accent))] transition-all duration-500 ease-out'
    style={{ width: `${progress}%` }}
  />
</div>
```

```tsx
/* src/components/player/InitialLoadingOverlay.tsx:84-88 — current */
<div className='h-2 overflow-hidden rounded-full bg-white/5'>
  <div
    className='h-full rounded-full bg-[linear-gradient(90deg,rgba(var(--ui-accent),0.72),rgba(var(--ui-accent-warm),0.92))] transition-all duration-700 ease-out'
    style={{ width: `${progressMap[stage]}%` }}
  />
</div>
```

AUDIT: animate transform/opacity only; UI durations stay under 300ms (500ms/700ms violate the budget).

## Target

```tsx
<div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
  <div
    className="h-full w-full origin-left rounded-full bg-[rgb(var(--ui-accent))] transition-transform duration-200 ease-out"
    style={{ transform: `scaleX(${Math.min(Math.max(progress, 0), 100) / 100})` }}
  />
</div>
```

Same pattern for `InitialLoadingOverlay` with `progressMap[stage]`, duration **200ms** (or `var(--ui-motion-base)` = 180ms). Ease-out curve if raw CSS: `cubic-bezier(0.23, 1, 0.32, 1)`.

Ensure parent has `overflow-hidden`. Use `origin-left` / `transform-origin: left center`.

## Repo conventions to follow

- Keep accent / gradient colors unchanged.
- Prefer Tailwind `origin-left` + `transition-transform`.

## Steps

1. Convert `VideoCard.tsx` progress fill to full-width + `scaleX(progress/100)` + `transition-transform duration-200 ease-out`.
2. Convert `InitialLoadingOverlay.tsx` the same way; drop `duration-700`.
3. Guard progress to `[0, 100]` before dividing.
4. Remove any leftover `transition-all` on those nodes.

## Boundaries

- Do NOT change when progress is computed or which stages map to which percentages.
- Do NOT restyle the track beyond what's required for `scaleX`.
- Do NOT touch other VideoCard hover motion (plan 006).

## Verification

- **Mechanical**: `pnpm typecheck`. No `style={{ width: ... }}` on these two fills.
- **Feel check**: Continue Watching cards show a crisp fill; play initial loading bar advances in ≤200ms steps without layout jitter. Animations panel: only `transform`.
- **Done when**: both bars use `scaleX`; durations ≤200ms.
