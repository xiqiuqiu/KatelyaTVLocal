# 013 — Add UserMenu enter/exit motion from the trigger

- **Status**: DONE
- **Commit**: 0094879
- **Severity**: LOW (missed opportunity)
- **Category**: Missed opportunities
- **Estimated scope**: 1 file, medium

## Problem

User menu mounts/unmounts with no spatial explanation:

```tsx
/* src/components/UserMenu.tsx:225 — current panel */
<div className='fixed right-4 top-16 z-[1001] w-72 ...'>
```

Open path uses `{isOpen && createPortal(...)}` (see ~417). Instant appearance feels disconnected from the avatar trigger.

## Target

Keep portal + overlay. Animate panel with CSS transitions (not enter-only keyframes):

```tsx
<div
  data-open={isOpen ? 'true' : 'false'}
  className="fixed right-4 top-16 z-[1001] w-72 origin-top-right ... transition-[opacity,transform] duration-180 ease-out data-[open=true]:opacity-100 data-[open=true]:scale-100 data-[open=false]:pointer-events-none data-[open=false]:opacity-0 data-[open=false]:scale-[0.96]"
>
```

Exact values:

- Duration: **180ms** (`--ui-motion-base`)
- Ease: `cubic-bezier(0.23, 1, 0.32, 1)`
- Scale floor: **0.96** (never ≤0.9)
- `transform-origin: top right` (trigger-anchored)

Implementation pattern: delay unmount ~180ms after `isOpen` becomes false (`requestAnimationFrame` + timeout, or keep mounted while `isMounted` state is true). Overlay can fade opacity 120–180ms.

## Repo conventions to follow

- Headless patterns elsewhere use class toggles; stay CSS-transition based (no new dependency).
- Match glass panel styling already on the menu — motion only.

## Steps

1. Introduce `isMounted` / exit timeout so close animates before unmount.
2. Apply origin-top-right opacity+scale transition with values above.
3. Ensure Esc/overlay click still closes and waits for exit.
4. Under `prefers-reduced-motion: reduce`, skip scale (opacity only) — align with plan 002.

## Boundaries

- Do NOT redesign menu contents or auth actions.
- Do NOT use Framer Motion.
- Do NOT animate the fullscreen dismiss overlay with blur.

## Verification

- **Mechanical**: `pnpm typecheck`.
- **Feel check**: open/close avatar menu — panel scales from top-right; spam toggle does not flash from scale 0. DevTools 10%: transition retargets. Reduced-motion: opacity only.
- **Done when**: open and close both animate ≤180ms from top-right origin.
