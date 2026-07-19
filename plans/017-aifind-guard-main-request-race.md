# 017 — Guard AiFindPanel main request with activeRunRef

- **Status**: TODO
- **Commit**: ea3113d
- **Severity**: HIGH
- **Category**: Bugs & correctness
- **Rule**: Beyond the scan (async-race)
- **Estimated scope**: 1 file (`AiFindPanel.tsx`), small

## Problem

`handleSubmit` sets `activeRunRef.current = runId` at `:441`, but the success path at `:533` (`setResult`, persist, `setLoading(false)`) does **not** check `activeRunRef.current === runId`. Group fetches later do check (`:296`, `:345`). A slow first submit can clobber a newer run.

```ts
// src/components/AiFindPanel.tsx:533-556 — current (excerpt)
setResult(nextResult);
// ... persist ...
setLoading(false);
```

## Target

Mirror group-guard pattern already in the same file:

```ts
if (activeRunRef.current !== runId) return;
setResult(nextResult);
// ... persist only if still active ...
if (activeRunRef.current === runId) {
  setLoading(false);
  setStartedAt(null);
}
```

Also guard `finally` / interval clear the same way so an old run cannot clear the new run’s loading spinner. Abort the fetch with `AbortController` tied to runId if practical.

## Repo conventions to follow

- Reuse `activeRunRef` / `createAiFindRequestId`.
- Extend `src/components/AiFindPanel.test.tsx` with a double-submit race if tests already mock fetch.

## Steps

1. After every `await` in `handleSubmit`, bail if `activeRunRef.current !== runId`.
2. Ensure `finally` does not `setLoading(false)` for stale runs.
3. Clear `intervalId` only for the owning run.
4. Add test: resolve first fetch after second — UI shows second result only.

## Boundaries

- Do NOT change `/api/ai/find` payload schema.
- Prefer landing before/without large #014 split conflicts.

## Verification

- **Mechanical**: AiFindPanel tests; typecheck.
- **Behavior check**: Submit query A, quickly submit B — panel shows B; loading settles once.
- **Done when**: stale success path is a no-op.
