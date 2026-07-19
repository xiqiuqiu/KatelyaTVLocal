# 006 — Keep SkipController countdown state updater pure

- **Status**: TODO
- **Commit**: ea3113d
- **Severity**: HIGH
- **Category**: Bugs & correctness
- **Rule**: react-doctor/no-impure-state-updater
- **Estimated scope**: 1 file (`SkipController.tsx`), small

## Problem

```ts
// src/components/SkipController.tsx:216-234 — current (excerpt)
countdownIntervalRef.current = setInterval(() => {
  setCountdownSeconds((prev) => {
    if (isCountdownPausedRef.current) return prev;
    if (prev <= 1) {
      countdownIntervalRef.current && clearInterval(countdownIntervalRef.current);
      countdownIntervalRef.current = null;
      setShowCountdown(false);
      if (targetTime && artPlayerRef.current) {
        artPlayerRef.current.currentTime = targetTime;
      } else if (onNextEpisode) {
        onNextEpisode();
      }
      return 0;
    }
    return prev - 1;
  });
}, 1000);
```

The updater performs `clearInterval`, seek, and `onNextEpisode()`. React may invoke updaters more than once → double skip / double next-episode.

## Target

Canonical (`no-impure-state-updater`): updater returns only the next number. Move timers, seek, and navigation to the interval callback / event path outside `setState`.

```ts
// target sketch
countdownIntervalRef.current = setInterval(() => {
  if (isCountdownPausedRef.current) return;

  setCountdownSeconds((prev) => {
    if (prev <= 1) return 0;
    return prev - 1;
  });

  // read upcoming value via functional pattern or a ref mirror of seconds
  // when seconds hit 0:
  //   clearInterval(...); setShowCountdown(false); seek or onNextEpisode();
}, 1000);
```

Practical approach: keep `countdownSecondsRef` mirrored from state; in the interval, decrement the ref, `setCountdownSeconds(ref)`, and when `ref <= 0` run side effects **outside** `setState`.

## Repo conventions to follow

- Preserve existing pause-via-ref behavior (`isCountdownPausedRef`).
- Keep user-visible countdown copy and next-episode timing.

## Steps

1. Introduce or reuse a ref mirroring countdown seconds.
2. Rewrite the interval body so `setCountdownSeconds` only returns a number.
3. Perform `clearInterval`, `setShowCountdown`, seek, `onNextEpisode` only in the interval callback after deciding `next <= 0`.
4. Confirm Strict Mode double-mount does not fire two next-episode navigations (manual or test).

## Boundaries

- Do NOT redesign the skip UX.
- Do NOT change skip config persistence APIs.
- STOP if countdown was rewritten to a different mechanism; adapt only if the impure updater remains.

## Verification

- **Mechanical**: `no-impure-state-updater` clear at SkipController; typecheck; existing SkipController tests if any.
- **Behavior check**: Play a title with ending skip countdown — reaches 0 once, seeks or advances one episode only.
- **Done when**: diagnostic clear, single navigation on countdown end.
