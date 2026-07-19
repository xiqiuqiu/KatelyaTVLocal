# 004 — Abort play page init fetch and clear loading timeout

- **Status**: TODO
- **Commit**: ea3113d
- **Severity**: HIGH
- **Category**: Bugs & correctness
- **Rule**: react-doctor/effect-needs-cleanup (+ no-fetch-in-effect race)
- **Estimated scope**: 1 file (`src/app/play/page.tsx`), medium

## Problem

`src/app/play/page.tsx:3936` mounts `useEffect` that runs `initAll()` with `fetch` and ends with an uncleaned `setTimeout` at `:4202`. Deps are `[]` (`:4208`). Leaving the page or remounting can still call `setDetail` / `setLoading` / etc.

```ts
// src/app/play/page.tsx:4202-4208 — current
setTimeout(() => {
  setLoading(false);
}, 1000);
};

initAll();
}, []);
```

## Target

Canonical (`effect-needs-cleanup`): capture timer id and `clearTimeout` in the effect cleanup. Pair with a `cancelled` / `AbortController` flag so async completions do not write state after teardown. Exemplar: `src/components/PlayRecommendations.tsx:53-77`.

```ts
// target shape inside the effect
let cancelled = false;
let readyTimer: ReturnType<typeof setTimeout> | null = null;
const controller = new AbortController();

// pass controller.signal into fetch(... , { signal })
// before every setState: if (cancelled) return;
// replace bare setTimeout with:
readyTimer = setTimeout(() => {
  if (!cancelled) setLoading(false);
}, 1000);

return () => {
  cancelled = true;
  controller.abort();
  if (readyTimer) clearTimeout(readyTimer);
};
```

Keep mount-once behavior if product requires it, but cleanup + abort are mandatory. Prefer reading latest title/source from refs already on the page rather than blindly expanding `[]` into a thrashing dep list.

## Repo conventions to follow

- Follow `PlayRecommendations` cancelled pattern.
- Do not introduce React Query solely for this fix.
- Preserve existing recovery / history restore logic inside `initAll`.

## Steps

1. At the init `useEffect` (~3936), introduce `cancelled`, optional `AbortController`, and `readyTimer`.
2. Thread `signal` into `/api/detail` and `/api/search` fetches in that effect; ignore `AbortError`.
3. Guard all `set*` calls after awaits with `if (cancelled) return`.
4. Replace the bare `setTimeout` at 4202 with a tracked timer cleared in `return () => { ... }`.
5. Add or extend a play-page test if one already covers init; otherwise a minimal unit around a extracted helper is acceptable — do not invent a giant page test harness.

## Boundaries

- Do NOT rewrite the whole player in this plan (#007).
- Do NOT change ArtPlayer setup effect (#018/#005) except if shared abort helpers are reused.
- STOP if init effect was already refactored away; report drift.

## Verification

- **Mechanical**: `effect-needs-cleanup` / related fetch-race diagnostics clear for this effect; `pnpm typecheck`.
- **Behavior check**: Open `/play?...`, navigate away within 500ms — no React state-update-on-unmounted warnings; returning still loads. Normal play still reaches ready and clears loading overlay.
- **Done when**: cleanup returns, abort works, play smoke OK.
