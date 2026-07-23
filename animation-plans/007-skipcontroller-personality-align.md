# 007 — Align SkipController motion personality with the app

- **Status**: TODO
- **Commit**: 0094879
- **Severity**: HIGH
- **Category**: Cohesion & tokens
- **Estimated scope**: 1 file (`SkipController.tsx`), medium

## Problem

SkipController uses playful blue→purple gradients, infinite pulse scaling, and bounce-in from `scale(0.8)` — mismatched with the crisp glass/`--ui-accent` system:

```tsx
/* src/components/SkipController.tsx:1404 — current */
className='w-12 h-12 bg-gradient-to-r from-blue-500 to-purple-500 ... transition-all duration-200 hover:scale-105 active:scale-95 animate-pulse'
```

```css
/* src/components/SkipController.tsx:1820-1856 — current */
@keyframes bounce-in {
  0% { transform: scale(0.8); opacity: 0; }
  50% { transform: scale(1.05); }
  100% { transform: scale(1); opacity: 1; }
}
@keyframes pulse {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.1); }
}
.animate-bounce-in { animation: bounce-in 0.4s ease-out; }
.animate-pulse { animation: pulse 2s infinite; }
```

AUDIT: never `scale(0)`-like pops from ≤0.9 without need; personality must match product; infinite pulse on a control is decorative noise.

## Target

- FAB / primary actions: solid `bg-[rgb(var(--ui-accent))]` (or success/critical for semantic buttons), no blue-purple gradient.
- Remove `animate-pulse` from FABs (`:1404`, `:1619` and any twins).
- Replace `animate-bounce-in` badge with opacity-only fade or static badge. If a micro-enter is kept: `opacity 0→1` + `scale(0.96→1)` over **150ms** `cubic-bezier(0.23, 1, 0.32, 1)` — never start below `0.9`.
- Press feedback: `active:scale-[0.97]` with `transition-transform duration-[160ms] ease-out` (AUDIT press recipe). Remove `hover:scale-105` or gate it in plan 009.
- Delete unused `@keyframes bounce-in` / local `pulse` once classes are gone. Keep toast/drawer keyframe migration for plan 008 — but if you touch those classes, do not leave bounce/pulse behind.

## Repo conventions to follow

- Accent tokens live in `src/styles/ui-theme.css` (`--ui-accent`, `--ui-critical`, `--ui-success`).
- Prefer matching play-page control chrome over unique SkipController skin.

## Steps

1. Replace gradient FABs/buttons (`from-blue-500 to-purple-500`, green/gray gradient CTAs if they clash) with theme solid colors. Keep destructive red for delete.
2. Remove `animate-pulse` and `animate-bounce-in` classNames.
3. Trim the `<style jsx>` block: delete bounce-in/pulse keyframes and classes if unused (`rg` inside file).
4. Normalize `active:scale-95` → `active:scale-[0.97]`; hover scale ≤ none or gated later.
5. Leave open/close mechanism for plan 008 unless a class rename is required.

## Boundaries

- Do NOT change skip-segment business logic, storage, or countdown behavior.
- Do NOT redesign the whole panel layout — color + motion personality only.
- Do NOT add Framer Motion.

## Verification

- **Mechanical**: `rg "from-blue-500 to-purple-500|animate-bounce-in|animate-pulse" src/components/SkipController.tsx` is empty (Tailwind `animate-pulse` utility must not remain on FABs; if a class name collision with Tailwind's animate-pulse exists, ensure the jsx pulse override is removed and FABs do not use `animate-pulse`).
- **Feel check**: open play page skip FAB — no throbbing scale loop; badge does not bounce; colors match accent system.
- **Done when**: no playful pulse/bounce/purple gradients on SkipController chrome.
