# 011 — Remove decorative MobileBottomNav translate/scale

- **Status**: DONE
- **Commit**: 0094879
- **Severity**: MEDIUM
- **Category**: Purpose & frequency
- **Estimated scope**: 1 file, small

## Problem

Primary mobile nav animates position/scale on every tab switch:

```tsx
/* src/components/MobileBottomNav.tsx:50-63 — current */
className={`relative flex h-16 w-full flex-col items-center justify-center gap-1 text-[11px] font-medium transition ${
  active ? '-translate-y-0.5' : 'hover:-translate-y-0.5'
}`}
...
className={`relative h-5 w-5 transition ${
  active
    ? 'scale-105 text-[rgb(var(--ui-accent))]'
    : 'text-[rgb(var(--ui-text-muted))] hover:text-[rgb(var(--ui-text))]'
}`}
```

Active state already has accent background chrome (`:54-56`). AUDIT: high-frequency navigation — remove or drastically reduce motion.

## Target

```tsx
className={`relative flex h-16 w-full flex-col items-center justify-center gap-1 text-[11px] font-medium transition-colors ${
  active ? '' : ''
}`}
...
className={`relative h-5 w-5 transition-colors ${
  active
    ? 'text-[rgb(var(--ui-accent))]'
    : 'text-[rgb(var(--ui-text-muted))] hover:text-[rgb(var(--ui-text))]'
}`}
```

Optional press feedback (allowed): `active:scale-[0.97] transition-transform duration-[160ms] ease-out` on the `Link` — no hover translate/scale.

## Repo conventions to follow

- Active pill background already communicates selection — keep it.
- Color transitions use `transition-colors` (plan 001 pattern).

## Steps

1. Remove `-translate-y-0.5` active/hover classes.
2. Remove `scale-105` on active icon.
3. Switch `transition` to `transition-colors` (and transform only if adding active press scale).
4. Do not change routing/`isNavigationItemActive`.

## Boundaries

- Do NOT restyle the active background chip geometry.
- Do NOT add bounce/spring.

## Verification

- **Mechanical**: `rg "translate-y|scale-105" src/components/MobileBottomNav.tsx` empty (except optional `active:scale-[0.97]`). `pnpm typecheck`.
- **Feel check**: tap through all five tabs — selection changes via color/chip only; no hop.
- **Done when**: no decorative translate/scale on bottom nav items.
