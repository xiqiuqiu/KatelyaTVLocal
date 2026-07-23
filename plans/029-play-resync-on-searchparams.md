# 029 — Resync play page when URL identity changes

- **Status**: DONE
- **Commit**: 411e0c2
- **Severity**: HIGH
- **Category**: Bugs & correctness
- **Rule**: react-doctor/exhaustive-deps (+ soft-navigation stale state)
- **Estimated scope**: 1 file (`src/app/play/page.tsx`), medium

## Problem

`PlayPageClient` seeds source/id/title from `useSearchParams()` only in the
initial `useState` call, and the main init effect depends on `[]`:

```ts
// src/app/play/page.tsx:396-407 — current
const [videoTitle, setVideoTitle] = useState(searchParams.get('title') || '');
const [videoYear, setVideoYear] = useState(searchParams.get('year') || '');
const [currentSource, setCurrentSource] = useState(
  searchParams.get('source') || ''
);
const [currentId, setCurrentId] = useState(searchParams.get('id') || '');
const [searchTitle] = useState(searchParams.get('stitle') || '');
const [searchType] = useState(searchParams.get('stype') || '');
```

```ts
// src/app/play/page.tsx:3396 — current
}, []);
```

`VideoCard` navigates with `<Link href="/play?...">`. Soft-navigating from one
title to another on `/play` keeps the client mounted, so users can keep watching
the previous video while the URL already points at the next one.

Canonical note (`react-doctor/exhaustive-deps`): do **not** blindly dump every
closure value into deps. Fix the product bug by reacting to URL *identity*
(`source`+`id`, or search entry `stitle`/`title` when source/id empty), not by
expanding the whole init closure.

Also apply `rerender-lazy-state-init` while touching these lines:

```ts
// target lazy init shape
const [videoTitle, setVideoTitle] = useState(
  () => searchParams.get('title') || ''
);
```

## Target

1. Derive a stable identity string from the current Next `searchParams`:

```ts
const playIdentityKey = [
  searchParams.get('source') || '',
  searchParams.get('id') || '',
  searchParams.get('stitle') || '',
  searchParams.get('title') || '',
  searchParams.get('stype') || '',
  searchParams.get('prefer') || '',
].join('\0');
```

2. Keep a ref of the last applied identity. When `playIdentityKey` changes
   (Link soft-nav), reset the relevant URL-derived state from `searchParams`
   and re-run the existing init path (same `initAll` / effect body already used
   on mount), including aborting the previous in-flight init (`cancelled` +
   `AbortController` already present around `:3389-3395`).

Recommended shape (do not remount the whole page with `key=` — initAll’s
`window.history.replaceState` canonicalize of source/id/title must not thrash):

```ts
// target — identity effect OR fold identity into the existing init effect deps
useEffect(() => {
  let cancelled = false;
  let readyTimer: ReturnType<typeof setTimeout> | null = null;
  const controller = new AbortController();

  // read source/id/title/stitle/stype/prefer FROM searchParams here (not stale state)
  // setCurrentSource / setCurrentId / setVideoTitle / … from those values
  // then run the existing initAll body

  return () => {
    cancelled = true;
    controller.abort();
    if (readyTimer) clearTimeout(readyTimer);
  };
}, [playIdentityKey]);
```

If folding into the existing mount effect: change `[]` to `[playIdentityKey]`
and at the top of the effect, sync URL → state from `searchParams` before
`initAll`. Preserve abort/cleanup already added by plan 004.

## Repo conventions to follow

- Keep abort/`cancelled` pattern already in this effect (plan 004 DONE).
- Prefer reading latest values via existing `*Ref` mirrors for handlers; do not
  strip those.
- Exemplar for cancelled fetch: `src/components/PlayRecommendations.tsx`.

## Steps

1. Introduce `playIdentityKey` derived from `searchParams` as above.
2. Convert the six URL `useState(searchParams.get(...))` calls to lazy
   `useState(() => …)` initializers.
3. Change the init effect dependency from `[]` to `[playIdentityKey]` (or split
   a thin sync+reinit effect). On each run, seed state from current
   `searchParams` before fetching.
4. Confirm `window.history.replaceState` canonicalize inside `initAll` does
   **not** change `playIdentityKey` in a way that loops (source+id stable after
   prefer resolution is OK; if prefer flips source/id once, one re-run is
   acceptable — guard with a ref if a double-fetch loop appears).
5. Smoke: from Continue Watching open title A, then click title B card without
   full reload — B loads.

## Boundaries

- Do NOT `key={...}` remount the entire `PlayPageClient` unless you also stop
  using raw `history.replaceState` for canonicalize (risk of init loops).
- Do NOT rewrite ArtPlayer setup in this plan.
- Do NOT expand deps to every handler/ref mirror used inside init.
- STOP if a newer identity-sync already exists; report drift.

## Verification

- **Mechanical**: `pnpm typecheck`; play-focused tests if present.
- **Behavior check**: On `/play?source=A&id=1`, click a card to
  `/play?source=B&id=2` — player re-inits to B (title/poster/episodes match B).
  Prefer-enabled first entry still settles on one source without infinite reload.
- **Done when**: soft-nav identity changes reload playback; no init loop.
