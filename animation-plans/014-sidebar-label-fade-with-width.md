# 014 — Fade Sidebar labels in sync with width collapse

- **Status**: TODO
- **Commit**: 0094879
- **Severity**: LOW (missed opportunity)
- **Category**: Missed opportunities
- **Estimated scope**: 1 file, small–medium

## Problem

Sidebar width transitions, but labels hard-cut via conditional render:

```tsx
/* src/components/Sidebar.tsx:175-176 — current */
className={`... transition-all duration-300 ${
  isCollapsed ? 'w-20' : 'w-64'
}`}
```

```tsx
/* src/components/Sidebar.tsx:163 — current */
{!isCollapsed && <span className='truncate'>{item.label}</span>}
```

Shell moves while text pops away — spatial tear.

## Target

1. Replace `transition-all` with `transition-[width,transform,opacity] duration-300` using ease `cubic-bezier(0.23, 1, 0.32, 1)` or Tailwind after plan 010 (`duration-300 ease-easeOutStrong`). Drawer-like width morph may use `cubic-bezier(0.32, 0.72, 0, 1)`.
2. Keep labels mounted; hide with CSS:

```tsx
<span
  className={`truncate transition-opacity duration-200 ease-out ${
    isCollapsed ? 'pointer-events-none w-0 opacity-0' : 'opacity-100'
  }`}
>
  {item.label}
</span>
```

Or `max-w-0`/`max-w-[9rem]` with `overflow-hidden` + opacity — pick one approach and keep icon layout stable (`justify-center` when collapsed already exists).

3. Collapse toggle button position (`left-3` vs centered) should use `transition-[left,transform] duration-300` if it jumps.

## Repo conventions to follow

- `data-collapsed={isCollapsed}` already on aside — can drive CSS if cleaner.
- Do not break `SidebarContext` API.

## Steps

1. Stop conditional-unmounting nav labels; animate opacity/width.
2. Scope sidebar transition properties (no `all`).
3. Feel-check collapsed icon-only alignment still centered.
4. Reduced-motion: opacity snap ok; width may shorten to 0ms via plan 002 policy.

## Boundaries

- Do NOT change nav item set or routes.
- Do NOT animate mobile drawer here unless the same component owns it with the same bug — desktop aside only if mobile is separate.

## Verification

- **Mechanical**: `pnpm typecheck`. Label span no longer solely behind `{!isCollapsed && ...}` unmount (unless exit-delay pattern).
- **Feel check**: collapse/expand — labels fade while width moves; no instant text pop. Spam toggle remains stable.
- **Done when**: label visibility tracks width transition.
