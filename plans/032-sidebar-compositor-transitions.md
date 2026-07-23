# 032 — Stop animating sidebar width/padding (use compositor props)

- **Status**: DONE
- **Commit**: 411e0c2
- **Severity**: HIGH
- **Category**: Performance
- **Rule**: react-doctor/no-tailwind-layout-transition
- **Estimated scope**: 2 files (`AppShell.tsx`, `Sidebar.tsx`), small

## Problem

Canonical (`no-tailwind-layout-transition`): animate `transform` and `opacity`
(compositor), not layout properties like `width` / `padding`.

```ts
// src/components/ui/AppShell.tsx:60 — current
<div className='hidden md:block transition-[width,transform,opacity] duration-300 ease-out'>
```

```ts
// src/components/ui/AppShell.tsx:68-69 — current
<main
  className={`min-w-0 transition-[padding] duration-300 ${desktopOffsetClass}`}
>
```

```ts
// src/components/Sidebar.tsx:183 — current
className={`… transition-[width,transform,opacity] duration-motionBase ease-easeOutStrong ${
  isCollapsed ? 'w-20' : 'w-64'
}`}
```

Toggling the global chrome sidebar forces layout on every frame of the
transition (width + main padding).

## Target

1. **Sidebar aside**: keep instant width class swap (`w-20` / `w-64`) **or**
   animate only non-layout props. Preferred minimal fix that clears the rule and
   removes jank:

```ts
// Sidebar.tsx — target
className={`… transition-[transform,opacity] duration-motionBase ease-easeOutStrong ${
  isCollapsed ? 'w-20' : 'w-64'
}`}
```

Label truncation already animates `max-width`/`opacity` on the text span
(`:164`) — leave that, or narrow it to `transition-opacity` only if the scanner
flags it.

2. **AppShell wrapper**: drop the useless width transition on the outer div
   (width is owned by Sidebar):

```ts
// AppShell.tsx:60 — target
<div className='hidden md:block'>
```

3. **main padding**: remove padding transition; offset still switches via
   `desktopOffsetClass` (`md:pl-20` / `md:pl-64`):

```ts
// AppShell.tsx — target
<main className={`min-w-0 ${desktopOffsetClass}`}>
```

If product insists on motion, use a transform-based overlay sidebar (slide with
`translate-x`) instead of width — out of scope unless you can do it without
changing hit targets / collapsed rail behavior. Default: snap width, no layout
transition.

## Repo conventions to follow

- Keep `data-collapsed` / `data-testid='desktop-sidebar'` used by
  `src/components/__tests__/app-shell.test.tsx`.
- Preserve collapsed localStorage behavior in `Sidebar` / `AppShell`.

## Steps

1. Edit `Sidebar.tsx` transition class as above.
2. Edit `AppShell.tsx` wrapper + `main` classes as above.
3. Update any class-string assertions in `app-shell.test.tsx` if they pin the
   old `transition-[width…]` / `transition-[padding]` tokens.
4. Toggle sidebar on desktop: content reflows without multi-frame width tween.

## Boundaries

- Do NOT redesign the information architecture of the sidebar.
- Do NOT change mobile nav.
- STOP if a design token already replaced these transitions; report drift.

## Verification

- **Mechanical**: `npx react-doctor@latest --scope changed` clears
  `no-tailwind-layout-transition` for these sites; `pnpm test -- app-shell`.
- **Behavior check**: Desktop toggle collapsed ↔ expanded — icons/labels still
  correct; no long layout thrash. Prefer Chrome Performance: no continuous
  Layout during the old 300ms window.
- **Done when**: layout properties are not in `transition-[…]` on these nodes.
