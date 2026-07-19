# 005 — Stop depending on artPlayerRef.current in effect deps

- **Status**: TODO
- **Commit**: ea3113d
- **Severity**: HIGH
- **Category**: Bugs & correctness
- **Rule**: react-doctor/no-mutable-in-deps / exhaustive-deps
- **Estimated scope**: 1 file region in `src/app/play/page.tsx`, small–medium

## Problem

```ts
// src/app/play/page.tsx:4688-4696 — current
window.addEventListener('beforeunload', handleBeforeUnload);
document.addEventListener('visibilitychange', handleVisibilityChange);

return () => {
  window.removeEventListener('beforeunload', handleBeforeUnload);
  document.removeEventListener('visibilitychange', handleVisibilityChange);
};
}, [currentEpisodeIndex, detail, artPlayerRef.current]);
```

Changing `artPlayerRef.current` does not re-render, so when the player is created later, this effect may never re-bind. Progress-save-on-hide can silently miss.

## Target

Canonical (`exhaustive-deps` / mutable-in-deps): do not put `ref.current` in the dependency array. Depend on a reactive “player ready” signal, or register listeners once and read the player only via refs inside the handlers.

```ts
// preferred target — mount-stable listeners, read refs inside
useEffect(() => {
  const handleBeforeUnload = () => {
    requestSaveCurrentPlayProgressRef.current?.();
  };
  const handleVisibilityChange = () => {
    if (document.visibilityState === 'hidden') {
      requestSaveCurrentPlayProgressRef.current?.();
    }
  };
  window.addEventListener('beforeunload', handleBeforeUnload);
  document.addEventListener('visibilitychange', handleVisibilityChange);
  return () => {
    window.removeEventListener('beforeunload', handleBeforeUnload);
    document.removeEventListener('visibilitychange', handleVisibilityChange);
  };
}, []);
```

If `requestSaveCurrentPlayProgress` is not already mirrored into a ref, add `requestSaveCurrentPlayProgressRef` updated in an effect (same pattern as `updateVideoUrlRef` at `:2621`).

## Repo conventions to follow

- Match existing `*Ref.current =` latest-callback patterns already on the play page (after #011 moves them to effects if that plan lands first — either order is fine if behavior matches).
- Keep save semantics identical (still save on hide / unload).

## Steps

1. Read the full `handleBeforeUnload` / `handleVisibilityChange` bodies above `:4688`.
2. Remove `artPlayerRef.current` from the dependency array.
3. Stabilize handlers via refs so episode/detail changes do not require rebinding, OR depend only on reactive primitives that truly should rebind.
4. Ensure cleanup removes the same function references.

## Boundaries

- Do NOT change save payload shape.
- Do NOT remove beforeunload entirely.
- STOP if this effect was deleted; report drift.

## Verification

- **Mechanical**: `no-mutable-in-deps` / exhaustive-deps on this line clear; typecheck.
- **Behavior check**: Start playback, switch tab to hidden — play progress still persists (localStorage or network per storage mode). Reload mid-play still triggers save path.
- **Done when**: listeners active after player create; diagnostics clear.
