# 002 — Fix global `prefers-reduced-motion` nuke

- **Status**: TODO
- **Commit**: 0094879
- **Severity**: HIGH
- **Category**: Accessibility
- **Estimated scope**: 1–2 CSS files

## Problem

Reduced motion currently deletes almost all feedback:

```css
/* src/app/globals.css:566-573 — current */
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```

`ui-theme.css` already uses a gentler, targeted pattern:

```css
/* src/styles/ui-theme.css:339-344 — current exemplar */
@media (prefers-reduced-motion: reduce) {
  .ui-breathing-canvas::before,
  .ui-reveal,
  .ui-poster-grid > * {
    animation: none;
  }
}
```

AUDIT: reduced motion means fewer/gentler animations, **not zero** — keep opacity/color transitions that aid comprehension; drop position/scale movement.

## Target

1. In `globals.css`, **remove** `transition-duration: 0.01ms !important` from the universal `*` rule so authored color/opacity transitions still run.
2. Keep short-circuiting **animations** for decorative/infinite motion (logo, particles, reveal, pulse). Expand the `ui-theme.css` block to:

```css
@media (prefers-reduced-motion: reduce) {
  .ui-breathing-canvas::before,
  .ui-reveal,
  .ui-poster-grid > * {
    animation: none !important;
  }

  .ui-poster-grid > *,
  .ui-reveal {
    opacity: 1;
    transform: none;
  }
}
```

3. In `globals.css` reduced-motion block, explicitly disable continuous logo/particle keyframes (classes: `.katelya-logo`, `.main-katelya-logo`, `.logo-background-glow`, and any particle-float helpers present in that file) with `animation: none !important`, without zeroing all transitions.
4. Loading spinners: disabling `animate-spin` is acceptable if busy text remains ("正在打开" / "加载中").

## Repo conventions to follow

- Prefer extending `src/styles/ui-theme.css:339-344` over inventing a third policy.
- Do not introduce Framer `useReducedMotion` — the app does not use framer-motion in `src/`.

## Steps

1. Edit `src/app/globals.css` reduced-motion: delete universal `transition-duration: 0.01ms !important`.
2. Add explicit `animation: none` for decorative logo/particle classes in that same media query (keep `animation-duration: 0.01ms` on `*` as a backstop for unlisted keyframes **or** replace with explicit lists — prefer explicit lists for clarity).
3. Align `ui-theme.css` reduced-motion with Target step 2.
4. Do not change non-motion CSS.

## Boundaries

- Do NOT implement hover pointer gating (plan 009) except where required to stop transform under reduced motion.
- Do NOT delete `.ui-poster-grid` enter rules entirely (plan 005) — only reduced-motion overrides.
- Do NOT add dependencies.

## Verification

- **Mechanical**: confirm globals.css no longer sets universal `transition-duration: 0.01ms`. `pnpm typecheck`.
- **Feel check**: DevTools → Rendering → `prefers-reduced-motion: reduce`. Home → search → open card: logo/particles/stagger gone; focus rings and color hovers still visible; loading copy still readable.
- **Done when**: movement/ambient loops stop; comprehension feedback remains.
