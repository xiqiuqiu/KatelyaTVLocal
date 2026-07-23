# 003 — Drive capsule indicators with transform, not left/width

- **Status**: TODO
- **Commit**: 0094879
- **Severity**: HIGH
- **Category**: Performance
- **Estimated scope**: 2 files, medium

## Problem

Sliding pill indicators animate layout properties:

```tsx
/* src/components/CapsuleSwitch.tsx:74-81 — current */
{indicatorStyle.width > 0 && (
  <div
    className='absolute bottom-1 top-1 rounded-full bg-[rgb(var(--ui-text))] shadow-ui-soft transition-all duration-300 ease-out'
    style={{
      left: `${indicatorStyle.left}px`,
      width: `${indicatorStyle.width}px`,
    }}
  />
)}
```

```tsx
/* src/components/DoubanSelector.tsx:223-230 — current */
<div
  className='absolute bottom-0.5 top-0.5 rounded-full bg-[rgb(var(--ui-text))] shadow-ui-soft transition-all duration-300 ease-out sm:bottom-1 sm:top-1'
  style={{
    left: `${indicatorStyle.left}px`,
    width: `${indicatorStyle.width}px`,
  }}
/>
```

AUDIT: animate `transform` and `opacity` only — `left`/`width` trigger layout.

## Target

Keep measuring `offsetLeft` / `offsetWidth`. Render the indicator as:

```tsx
<div
  className="absolute bottom-1 top-1 left-0 rounded-full bg-[rgb(var(--ui-text))] shadow-ui-soft transition-transform duration-300 ease-out"
  style={{
    width: `${indicatorStyle.width}px`,
    transform: `translateX(${indicatorStyle.left}px)`,
  }}
/>
```

Preferred: **instant width**, animated `translateX` only (duration 240ms if using `--ui-motion-slow`, else 300ms). Strong ease-out when writing raw CSS: `cubic-bezier(0.23, 1, 0.32, 1)`.

Only if unequal label widths look broken in feel-check, also transition width — document that fallback; still never use `transition-all`.

## Repo conventions to follow

- Both components share the same `indicatorStyle` measurement pattern — keep the `useEffect` measurement loop.
- Exemplar: `CapsuleSwitch.tsx` `updateIndicatorPosition`.

## Steps

1. Update `CapsuleSwitch.tsx` indicator to `left-0` + `translateX(left)` + `transition-transform`.
2. Mirror in `DoubanSelector.tsx` (~225). Grep `indicatorStyle` in that file for any second pill row and apply the same pattern.
3. Option buttons: `transition-colors duration-200` (not `transition-all`).
4. Add `active:scale-[0.97]` only if you are also touching those buttons for press feedback — otherwise leave press feedback to a follow-up; this plan's scope is the indicator.

## Boundaries

- Do NOT restyle active text colors or option APIs.
- Do NOT add Framer Motion.
- If measurement code drifted since 0094879, STOP and report.

## Verification

- **Mechanical**: `pnpm typecheck`. Indicator style no longer transitions `left`.
- **Feel check**: spam-toggle CapsuleSwitch and Douban pills — thumb chases smoothly; Animations panel at 10% shows transform tween, not left.
- **Done when**: both indicators use `translateX`; no `transition-all` on them.
