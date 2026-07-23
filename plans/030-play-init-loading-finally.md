# 030 — Always clear play init loading on failure

- **Status**: DONE
- **Commit**: 411e0c2
- **Severity**: HIGH
- **Category**: Bugs & correctness
- **Rule**: Beyond the scan (`no-loading-flag-reset-outside-finally` class)
- **Estimated scope**: 1 file (`src/app/play/page.tsx`), small

## Problem

`initAll` sets the full-page loading flag then runs a long async chain with no
outer `try/finally`:

```ts
// src/app/play/page.tsx:3167-3181 — current
const initAll = async () => {
  if (!currentSource && !currentId && !videoTitle && !searchTitle) {
    setPlaybackError('缺少必要参数', 'missing-params');
    setLoading(false);
    return;
  }
  setSourceSearchLoading(true);
  setLoading(true);
  // … many awaits (fetchSourcesData, preferBestSource, …)
  // success path only:
  readyTimer = setTimeout(() => {
    if (!cancelled) setLoading(false);
  }, 1000);
};
```

`sourceSearchLoading` already resets in an inner `finally` (`:3160-3163`). The
**page** `loading` flag does not: any throw after `setLoading(true)` leaves the
overlay stuck until the user hard-refreshes.

## Target

Wrap the body of `initAll` (after the missing-params early return) in
`try/catch/finally`:

```ts
// target
const initAll = async () => {
  if (!currentSource && !currentId && !videoTitle && !searchTitle) {
    setPlaybackError('缺少必要参数', 'missing-params');
    setLoading(false);
    return;
  }

  setSourceSearchLoading(true);
  setLoading(true);
  // … existing map resets / stage messages …

  try {
    // existing await chain unchanged
    // existing success path that schedules readyTimer
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') return;
    if (cancelled) return;
    setPlaybackError(
      err instanceof Error ? err.message : '初始化播放失败',
      'generic'
    );
  } finally {
    // Only force-clear when we did not schedule the success readyTimer,
    // OR always clear readyTimer on error paths inside catch before finally.
    // Simplest correct shape:
    // - on error / cancel: if (!cancelled) setLoading(false)
    // - on success: keep the existing 1s readyTimer clear
  }
};
```

Concrete rule for the executor:

- Preserve the success UX (1s “准备就绪” then `setLoading(false)`).
- On any thrown error after `setLoading(true)`, clear loading immediately (no
  stuck overlay) and surface `setPlaybackError` if not cancelled.
- On `cancelled` / `AbortError`, do not paint a user-visible error; still avoid
  leaving loading true for a live mount (cleanup already sets `cancelled`).

Suggested minimal finally:

```ts
let clearedByReadyTimer = false;
try {
  // … on success:
  readyTimer = setTimeout(() => {
    if (!cancelled) setLoading(false);
  }, 1000);
  clearedByReadyTimer = true;
} catch (err) {
  if (err instanceof Error && err.name === 'AbortError') return;
  if (!cancelled) {
    setPlaybackError(
      err instanceof Error ? err.message : '初始化播放失败',
      'generic'
    );
  }
} finally {
  if (!cancelled && !clearedByReadyTimer) {
    setLoading(false);
  }
}
```

## Repo conventions to follow

- Reuse existing `setPlaybackError(message, kind)` helper on this page.
- Do not invent a new toast system.

## Steps

1. Locate `initAll` at `src/app/play/page.tsx:3167`.
2. Add `try/catch/finally` with the `clearedByReadyTimer` flag as above.
3. Manually throw (temporary) after `setLoading(true)` in a local smoke if needed,
   then remove the throw — confirm overlay clears and error UI shows.
4. Re-read success path: prefer + history restore still reaches ready timer.

## Boundaries

- Do NOT redesign loading stages / messages.
- Do NOT merge plan 029 identity sync into this change unless already present.
- STOP if `initAll` already has an equivalent outer finally; report drift.

## Verification

- **Mechanical**: `pnpm typecheck`.
- **Behavior check**: Normal play still clears overlay ~1s after ready. Force a
  detail/search failure (invalid id) — overlay clears and error panel appears,
  not an infinite spinner.
- **Done when**: no path leaves `loading===true` after a settled init attempt
  on a live mount.
