# 015 — Fix admin hydration branch on typeof window

- **Status**: TODO
- **Commit**: ea3113d
- **Severity**: LOW
- **Category**: Bugs & correctness
- **Rule**: react-doctor/no-hydration-branch-on-browser-global
- **Estimated scope**: 1 file (`admin/page.tsx`), small

## Problem

```ts
// src/app/admin/page.tsx:215-220 — current
const isD1Storage =
  typeof window !== 'undefined' &&
  (window as any).RUNTIME_CONFIG?.STORAGE_TYPE === 'd1';
const isUpstashStorage =
  typeof window !== 'undefined' &&
  (window as any).RUNTIME_CONFIG?.STORAGE_TYPE === 'upstash';
```

Similar hits around `:1701`. Server vs client first paint can disagree (hydration mismatch). Also `rendering-hydration-mismatch-time` at `:911` if still present.

## Target

Canonical: render the same initial output on server and client, then switch after mount — or `useSyncExternalStore` with a stable server snapshot.

```ts
// target sketch
function useRuntimeStorageType(): string | null {
  return useSyncExternalStore(
    () => () => {},
    () => window.RUNTIME_CONFIG?.STORAGE_TYPE ?? null,
    () => null // server snapshot
  );
}
const storageType = useRuntimeStorageType();
const isD1Storage = storageType === 'd1';
const isUpstashStorage = storageType === 'upstash';
```

Alternatively: read storage type from a server-passed prop / existing config API already loaded in admin, avoiding `window` during render entirely.

## Repo conventions to follow

- Admin page is client-heavy; prefer `useSyncExternalStore` or config-from-state already fetched.
- Avoid suppressing the rule.

## Steps

1. Locate all `typeof window` render branches flagged in admin page.
2. Replace with `useSyncExternalStore` or post-mount state (`useEffect` + `useState` defaulting to false/null for both trees).
3. Fix Date.now-in-JSX hydration hit at `:911` if still present (format in effect or useStable clock).
4. Nested `DraggableRow` definition at `:1370` — move to module scope in the same pass if touched.

## Boundaries

- Do NOT redesign admin UX.
- Do NOT change D1/Upstash API routes.

## Verification

- **Mechanical**: hydration-branch errors clear; typecheck.
- **Behavior check**: Load `/admin` hard-refresh — no hydration warnings in console; storage-specific panels still appear for d1/upstash.
- **Done when**: diagnostics clear, admin usable.
