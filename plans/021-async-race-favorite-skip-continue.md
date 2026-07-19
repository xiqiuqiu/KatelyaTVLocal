# 021 — Cancel stale async writes for favorites, skip config, continue watching

- **Status**: TODO
- **Commit**: ea3113d
- **Severity**: MEDIUM
- **Category**: Bugs & correctness
- **Rule**: Beyond the scan (async-race)
- **Estimated scope**: 3–4 files, medium

## Problem

Confirmed stale-write races:

1. `src/app/play/page.tsx:4712` — `isFavorited` then `setFavorited` without generation token on source/id change.
2. `src/components/VideoCard.tsx:155` — same favorite status fetch.
3. `src/components/SkipController.tsx:151` — `loadSkipConfig` applies config after source/id change.
4. `src/components/ContinueWatching.tsx:43` — `getRecentPlayRecords` can `setPlayRecords` after unmount (cleanup only unsubscribes events).

## Target

Apply the cancelled/generation pattern from `PlayRecommendations.tsx:53-77` everywhere:

```ts
useEffect(() => {
  let cancelled = false;
  (async () => {
    const fav = await isFavorited(source, id);
    if (cancelled) return;
    setFavorited(fav);
  })();
  return () => {
    cancelled = true;
  };
}, [source, id]);
```

Same for `loadSkipConfig` and ContinueWatching’s initial fetch (`cancelled` in addition to unsubscribe).

## Repo conventions to follow

- Keep `subscribeToDataUpdates` listeners.
- VideoCard: depend on `actualSource` / `actualId` as today.

## Steps

1. Fix play page favorite effect (~4712).
2. Fix VideoCard favorite effect (~152).
3. Fix SkipController `loadSkipConfig` callers / effect to ignore stale resolutions (compare source+id or cancelled flag).
4. Fix ContinueWatching initial fetch with `cancelled`.
5. Add/adjust tests where mocks exist (`video-card-actions`, continue-watching-actions).

## Boundaries

- Do NOT change storage key formats.
- Do NOT merge with #018 timeupdate work.

## Verification

- **Mechanical**: focused component tests; typecheck.
- **Behavior check**: Rapidly switch sources on play — favorite heart matches current source. Switch titles while skip config loads — segments match new title. Navigate away from home during continue-watching load — no console unmounted warnings.
- **Done when**: all four sites guard stale async.
