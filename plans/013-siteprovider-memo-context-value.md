# 013 — Memoize SiteProvider context value

- **Status**: TODO
- **Commit**: ea3113d
- **Severity**: MEDIUM
- **Category**: Performance
- **Rule**: react-doctor/jsx-no-constructed-context-values
- **Estimated scope**: 1 file, tiny

## Problem

```tsx
// src/components/SiteProvider.tsx:23-26 — current
return (
  <SiteContext.Provider value={{ siteName, announcement }}>
    {children}
  </SiteContext.Provider>
);
```

Inline object identity changes every provider render → all `useSite()` consumers redraw.

## Target

Canonical: wrap value in `useMemo`.

```tsx
'use client';
import { createContext, ReactNode, useContext, useMemo } from 'react';
// ...
export function SiteProvider({ children, siteName, announcement }: ...) {
  const value = useMemo(
    () => ({ siteName, announcement }),
    [siteName, announcement]
  );
  return (
    <SiteContext.Provider value={value}>{children}</SiteContext.Provider>
  );
}
```

## Repo conventions to follow

- File already `'use client'`; keep it.
- Consumers: TopSearchBar, MobileHeader, home, login — no API change.

## Steps

1. Import `useMemo`.
2. Memoize `value` with `[siteName, announcement]`.
3. No consumer changes.

## Boundaries

- Do NOT add extra context splits in this plan.
- Do NOT memoize children.

## Verification

- **Mechanical**: `jsx-no-constructed-context-values` clear; typecheck.
- **Behavior check**: React DevTools Highlight Updates — changing unrelated ThemeProvider state should not cascade siteName consumers if SiteProvider props unchanged. Site name still renders in header.
- **Done when**: diagnostic clear, header still shows siteName.
