# 016 — Abort in-flight search when query changes

- **Status**: TODO
- **Commit**: ea3113d
- **Severity**: HIGH
- **Category**: Bugs & correctness
- **Rule**: Beyond the scan (async-race) / react-doctor/no-fetch-in-effect
- **Estimated scope**: 1 file (`search/page.tsx`), small

## Problem

```ts
// src/app/search/page.tsx:178-205 — current
useEffect(() => {
  const query = searchParams.get('q');
  if (query) {
    fetchSearchResults(query);
    addSearchHistory(query);
  } else {
    setShowResults(false);
  }
}, [searchParams]);

const fetchSearchResults = async (query: string) => {
  try {
    setIsLoading(true);
    // fetch without signal / generation token
    setSearchResults(sortSearchResultsByRanking(query, data.results));
  } finally {
    setIsLoading(false);
  }
};
```

Fast query changes: older responses can overwrite newer results; `finally` clears loading for the wrong generation.

## Target

Use AbortController + request generation (exemplar `PlayRecommendations.tsx:53-77`):

```ts
useEffect(() => {
  const query = searchParams.get('q');
  if (!query) {
    setShowResults(false);
    return;
  }
  const controller = new AbortController();
  let cancelled = false;
  (async () => {
    try {
      setIsLoading(true);
      const response = await fetch(`/api/search?q=${encodeURIComponent(query.trim())}`, {
        signal: controller.signal,
      });
      const data = await response.json();
      if (cancelled) return;
      setSearchResults(sortSearchResultsByRanking(query, data.results));
      setShowResults(true);
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
      if (!cancelled) setSearchResults([]);
    } finally {
      if (!cancelled) setIsLoading(false);
    }
  })();
  addSearchHistory(query);
  return () => {
    cancelled = true;
    controller.abort();
  };
}, [searchParams]);
```

## Repo conventions to follow

- Keep ranking helper `sortSearchResultsByRanking`.
- Preserve search history side effect timing (still on query change).

## Steps

1. Inline or refactor `fetchSearchResults` to accept `AbortSignal` + cancelled guard.
2. Abort on effect cleanup / `searchParams` change.
3. Only the latest generation may `setIsLoading(false)` / `setSearchResults`.
4. Add a focused test if search page tests exist; otherwise skip heavy RTL harness.

## Boundaries

- Do NOT redesign AI vs normal mode beyond not breaking `searchMode`.
- Do NOT change `/api/search` server contract.

## Verification

- **Mechanical**: typecheck; manual race: type quickly through two queries — UI shows the last query’s results.
- **Behavior check**: `/search?q=a` then immediately `q=b` — no flash of a’s results after b paints; loading ends correctly.
- **Done when**: stale responses ignored.
