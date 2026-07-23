# 036 — Check search response.ok before parsing results

- **Status**: DONE
- **Commit**: 411e0c2
- **Severity**: HIGH
- **Category**: Bugs & correctness
- **Rule**: react-doctor/no-fetch-response-used-without-status-check
- **Estimated scope**: 1 file (`src/app/search/page.tsx`), small

## Problem

Canonical (`no-fetch-response-used-without-status-check`): check `response.ok`
(or `status`) before `.json()` / treating the body as success. `fetch` resolves
on HTTP 4xx/5xx.

```ts
// src/app/search/page.tsx:188-205 — current
(async () => {
  try {
    setIsLoading(true);
    setResultCategory('all');
    const response = await fetch(
      `/api/search?q=${encodeURIComponent(query.trim())}`,
      { signal: controller.signal }
    );
    const data = await response.json();
    if (cancelled) return;
    setSearchResults(sortSearchResultsByRanking(query, data.results));
    setShowResults(true);
  } catch (error) {
    if ((error as Error).name === 'AbortError') return;
    if (!cancelled) setSearchResults([]);
  } finally {
    if (!cancelled) setIsLoading(false);
  }
})();
```

Abort/cancelled guards from plan 016 are already present. Missing status check
means error JSON becomes “empty results” (throw in ranking → catch → `[]`), so
users cannot tell failure from a true zero-hit query.

## Target

```ts
// target
const response = await fetch(
  `/api/search?q=${encodeURIComponent(query.trim())}`,
  { signal: controller.signal }
);
if (!response.ok) {
  throw new Error(`搜索失败 (${response.status})`);
}
const data = await response.json();
if (cancelled) return;
const results = Array.isArray(data?.results) ? data.results : [];
setSearchResults(sortSearchResultsByRanking(query, results));
setShowResults(true);
```

Optionally surface a small inline error string state if the page already has an
error UI slot; if not, empty results on hard failure is acceptable **only if**
you still avoid treating error payloads as ranked hits — prefer a visible error
when cheap:

```ts
// if the page has setError / similar, use it; otherwise keep [] but do not parse unchecked
```

Inspect the search page for an existing error banner before inventing new chrome.
If none exists, `setSearchResults([])` + `console.error` is OK for this plan;
do not build a new design system toast.

## Repo conventions to follow

- Keep AbortController + `cancelled` from plan 016.
- Keep `sortSearchResultsByRanking` and `addSearchHistory(query)` timing.

## Steps

1. After `fetch`, add `if (!response.ok) throw …`.
2. Guard `data.results` with `Array.isArray` before ranking.
3. Leave finally/abort behavior unchanged.
4. Add a focused test only if search page tests already mock `fetch`; otherwise
   manual 500 simulation is enough.

## Boundaries

- Do NOT change `/api/search` server contract.
- Do NOT redo AI search mode in this plan.
- STOP if `response.ok` already checked; report drift.

## Verification

- **Mechanical**: `npx react-doctor@latest --scope changed` clears this rule for
  the search effect; `pnpm typecheck`.
- **Behavior check**: Mock or force `/api/search` → 500 — UI does not show a
  fake “ranked” list from an error body; loading clears. Happy path still lists
  results for a known query.
- **Done when**: non-OK responses never flow into `sortSearchResultsByRanking`
  as success data.
