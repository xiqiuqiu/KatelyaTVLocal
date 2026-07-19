# 018 — Stop per-tick setState from video timeupdate

- **Status**: TODO
- **Commit**: ea3113d
- **Severity**: HIGH
- **Category**: Performance
- **Rule**: Beyond the scan (hot-path-high-frequency-setstate)
- **Estimated scope**: `play/page.tsx` + `SkipController.tsx` consumers, medium

## Problem

```ts
// src/app/play/page.tsx:5673-5675 — current
artPlayerRef.current.on('video:timeupdate', () => {
  const currentTime = artPlayerRef.current.currentTime || 0;
  setCurrentPlayTime(currentTime);
```

`currentPlayTime` feeds SkipController effects → the ~6400-line play tree re-renders on media ticks.

## Target

Keep high-frequency time on a ref; only publish React state when UI needs it (throttled), or drive SkipController from the player ref / rAF.

```ts
// target sketch
currentPlayTimeRef.current = currentTime;
// throttle UI state e.g. 250ms, or only when second changes:
if (Math.floor(currentTime) !== Math.floor(lastPublishedSecondRef.current)) {
  lastPublishedSecondRef.current = currentTime;
  setCurrentPlayTime(currentTime);
}
```

Better long-term: SkipController reads `artPlayerRef.current.currentTime` inside its own player event subscription instead of receiving `currentTime` props every tick — reduce prop churn.

Preserve `markPlaybackHealthy` / probe scheduling side effects inside the timeupdate handler (those are fine without setState).

## Repo conventions to follow

- Do not break skip segment detection accuracy beyond ~1s.
- Prefer minimal SkipController API change; if prop stays, throttle parent updates.

## Steps

1. Inventory consumers of `currentPlayTime` state in play page + SkipController.
2. Introduce `currentPlayTimeRef` always updated on timeupdate.
3. Throttle or second-quantize `setCurrentPlayTime` for display; point skip logic at ref or internal subscription.
4. Profile with React DevTools: timeupdate should not flash the whole page every frame.

## Boundaries

- Do NOT remove skip functionality.
- Do NOT combine with full #007 rewrite — keep diff focused on time propagation.

## Verification

- **Mechanical**: typecheck; play tests if any.
- **Behavior check**: Profiler on `/play` during playback — PlayPageClient update rate drops sharply; opening/ending auto-skip still fires.
- **Done when**: Profiler confirms fewer renders; skip still works.
