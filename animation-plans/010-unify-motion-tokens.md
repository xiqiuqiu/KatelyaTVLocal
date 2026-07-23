# 010 — Unify motion tokens and enter curves

- **Status**: TODO
- **Commit**: 0094879
- **Severity**: MEDIUM
- **Category**: Cohesion & tokens
- **Estimated scope**: 3–4 files (`ui-theme.css`, `tailwind.config.ts`, `globals.css`, maybe one component), medium

## Problem

Duration tokens exist but are unused; three enter systems disagree:

```css
/* src/styles/ui-theme.css:27-29 — current (unused) */
--ui-motion-fast: 120ms;
--ui-motion-base: 180ms;
--ui-motion-slow: 240ms;
```

```ts
/* tailwind.config.ts:89-91 — current */
'fade-in': 'fadeIn 0.3s ease-in-out',
'slide-up': 'slideUp 0.3s ease-in-out',
'slide-down': 'slideDown 0.3s ease-in-out',
```

```css
/* src/app/globals.css:27-39 — current */
@keyframes fadeInUp { from { opacity: 0; transform: translateY(30px); } ... }
.fade-in-up { animation: fadeInUp 0.6s ease-out forwards; }
```

AUDIT enter easing: ease-out with strong curve `cubic-bezier(0.23, 1, 0.32, 1)`; UI ≤300ms.

## Target

In `ui-theme.css` `:root` add:

```css
--ease-out: cubic-bezier(0.23, 1, 0.32, 1);
--ease-in-out: cubic-bezier(0.77, 0, 0.175, 1);
--ease-drawer: cubic-bezier(0.32, 0.72, 0, 1);
/* keep existing --ui-motion-fast/base/slow */
```

Wire Tailwind (minimal):

```ts
// tailwind.config.ts theme.extend.transitionTimingFunction
easeOutStrong: 'cubic-bezier(0.23, 1, 0.32, 1)',
easeInOutStrong: 'cubic-bezier(0.77, 0, 0.175, 1)',
easeDrawer: 'cubic-bezier(0.32, 0.72, 0, 1)',
// theme.extend.transitionDuration
motionFast: '120ms',
motionBase: '180ms',
motionSlow: '240ms',
```

Update animations to enter with ease-out, ≤240ms:

```ts
'fade-in': 'fadeIn 180ms cubic-bezier(0.23, 1, 0.32, 1)',
'slide-up': 'slideUp 220ms cubic-bezier(0.23, 1, 0.32, 1)',
'slide-down': 'slideDown 220ms cubic-bezier(0.23, 1, 0.32, 1)',
```

`slideUp` keyframe distance: keep ~10px (already). `fadeInUp` / `.fade-in-up`: either delete if unused (`rg "fade-in-up"`), or shorten to 220ms / translateY(8px) / `var(--ease-out)`.

Document in a one-line comment above tokens: prefer `duration-motionBase ease-easeOutStrong` for new UI.

## Repo conventions to follow

- Tokens live in `src/styles/ui-theme.css` — extend there first, mirror into Tailwind second.
- Plan 005 owns `.ui-reveal` duration; keep it on `--ui-motion-slow` / 220–240ms after this lands.

## Steps

1. Add ease CSS variables beside `--ui-motion-*`.
2. Extend `tailwind.config.ts` durations + timing functions; fix fade/slide animation strings to ease-out ≤240ms.
3. Grep `fade-in-up` / `animate-fade-in` / `animate-slide-up` (Tailwind) usage; update or remove dead globals.
4. Optionally migrate 2–3 already-touched call sites from plans 001/003 to `duration-motionBase ease-easeOutStrong` as exemplars — do not boil the ocean.

## Boundaries

- Do NOT rewrite SkipController local keyframes here (plans 007/008).
- Do NOT add Framer Motion usage just because the dependency exists.
- Do NOT change non-motion Tailwind theme keys.

## Verification

- **Mechanical**: `rg "--ui-motion-" src` shows usage beyond `:root` OR Tailwind `motionBase` appears in at least one component. `pnpm typecheck`.
- **Feel check**: any remaining `animate-slide-up` / page fade feels quick ease-out, not slow ease-in-out.
- **Done when**: shared ease+duration tokens exist and Tailwind enter animations use ease-out ≤240ms; unused 0.6s fadeInUp removed or shortened.
