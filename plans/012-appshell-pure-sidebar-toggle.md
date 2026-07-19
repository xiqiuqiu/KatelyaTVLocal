# 012 — Keep AppShell sidebar toggle state updater pure

- **Status**: TODO
- **Commit**: ea3113d
- **Severity**: MEDIUM
- **Category**: Bugs & correctness
- **Rule**: react-doctor/no-impure-state-updater
- **Estimated scope**: 1 file (`AppShell.tsx`), tiny

## Problem

```ts
// src/components/ui/AppShell.tsx:46-54 — current
const handleToggleSidebar = () => {
  setIsSidebarCollapsed((current) => {
    const next = !current;
    if (typeof window !== 'undefined') {
      window.__sidebarCollapsed = next;
      window.localStorage.setItem('sidebarCollapsed', JSON.stringify(next));
    }
    return next;
  });
};
```

Updater writes `window` / `localStorage`. Double-invocation toggles twice and persists the wrong value.

## Target

Canonical: compute next state, persist outside updater, then setState.

```ts
// target
const handleToggleSidebar = () => {
  setIsSidebarCollapsed((current) => {
    const next = !current;
    return next;
  });
};
```

Better — read current via functional update **or** from state in event (event handler may use `isSidebarCollapsed` directly):

```ts
const handleToggleSidebar = () => {
  const next = !isSidebarCollapsed;
  window.__sidebarCollapsed = next;
  window.localStorage.setItem('sidebarCollapsed', JSON.stringify(next));
  setIsSidebarCollapsed(next);
};
```

## Repo conventions to follow

- Match Sidebar’s storage key `sidebarCollapsed`.
- Keep `src/components/__tests__/app-shell.test.tsx` green; update if it asserts updater behavior.

## Steps

1. Move storage writes out of the updater in `AppShell.tsx`.
2. Ensure initial mount effect that reads localStorage remains unchanged.
3. Update tests if needed.

## Boundaries

- Do NOT change TopSearchBar props API.
- Do NOT alter mobile nav.

## Verification

- **Mechanical**: diagnostic clear; app-shell tests; typecheck.
- **Behavior check**: Toggle sidebar twice — collapsed state and `localStorage` match UI.
- **Done when**: pure updater / external persist, tests pass.
