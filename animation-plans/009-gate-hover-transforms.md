# 009 — Gate hover transforms behind fine pointers

- **Status**: TODO
- **Commit**: 0094879
- **Severity**: MEDIUM
- **Category**: Accessibility
- **Estimated scope**: ~6 files + small CSS utility, small–medium

## Problem

Transform hovers are ungated; touch taps can stick false hover scales:

```tsx
/* exemplars at 0094879 */
/* VideoCard.tsx:339 */ hover:scale-[1.06]
/* search/page.tsx:491 */ hover:scale-105
/* TopSearchBar.tsx:88 */ hover:scale-105
/* ScrollableRow.tsx:122,139 */ hover:scale-[1.06]
/* login/page.tsx:471 */ hover:-translate-y-0.5
/* MobileBottomNav / Sidebar also use hover:-translate-y-0.5 — coordinate with 011/014 */
```

Full-repo: no `(hover: hover) and (pointer: fine)` usage.

AUDIT requires:

```css
@media (hover: hover) and (pointer: fine) {
  .element:hover { transform: scale(1.05); }
}
```

## Target

Add a shared utility in `src/styles/ui-theme.css`:

```css
@media (hover: hover) and (pointer: fine) {
  .ui-hover-lift:hover {
    transform: translateY(-2px);
  }
  .ui-hover-scale-sm:hover {
    transform: scale(1.03);
  }
  .ui-hover-scale-md:hover {
    transform: scale(1.05);
  }
}

@media (prefers-reduced-motion: reduce) {
  .ui-hover-lift:hover,
  .ui-hover-scale-sm:hover,
  .ui-hover-scale-md:hover {
    transform: none;
  }
}
```

Replace Tailwind `hover:scale-*` / `hover:-translate-y-*` motion utilities on the exemplars with these classes (plus `transition-transform duration-150 ease`). Prefer **removing** scale hover entirely on VideoCard actions if plan 006 already did — then only gate remaining instances.

Cap scales at 1.03–1.05. Do not invent glow.

## Repo conventions to follow

- Put shared motion utilities next to other `.ui-*` rules in `ui-theme.css`.
- Keep focus-visible rings as the accessible affordance on touch.

## Steps

1. Add the CSS utilities above to `ui-theme.css`.
2. Grep `hover:scale` and `hover:-translate-y` under `src/`.
3. For each hit: either delete (if plan 006/011 already removed the affordance) or swap to `ui-hover-scale-sm` / `ui-hover-lift` + `transition-transform duration-150 ease`.
4. Ensure `active:scale-[0.97]` press feedback remains available on touch (not inside the hover media query).

## Boundaries

- Do NOT reintroduce card translate lift removed by plan 006.
- Do NOT gate non-transform hovers (colors/underlines) — those may stay.
- Do NOT add JS hover detection.

## Verification

- **Mechanical**: `rg "hover:scale|hover:-translate-y" src --glob '*.{ts,tsx}'` should be empty or only intentional non-transform cases. `pnpm typecheck`.
- **Feel check**: on a phone/emulator, tap search FAB / scroll row buttons — no stuck scaled state. On desktop trackpad, hover scale still works.
- **Done when**: transform hovers only run under fine-pointer hover; reduced-motion kills them.
