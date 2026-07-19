# 007 — Split PlayPageClient and add play error boundary

- **Status**: TODO
- **Commit**: ea3113d
- **Severity**: HIGH
- **Category**: Maintainability & architecture
- **Rule**: react-doctor/no-giant-component + Beyond the scan
- **Estimated scope**: many files under `src/app/play/` + `src/components/player/`, large

## Problem

`PlayPageClient` in `src/app/play/page.tsx:419` spans ~6400 lines. The repo has **zero** `error.tsx` / ErrorBoundary — a render throw on `/play` whitescreens with no recovery.

## Target

Canonical (`no-giant-component`): pull sections into their own components. Beyond-scan: add `src/app/play/error.tsx` (App Router) so play failures show a retry UI.

Suggested extraction order (behavior-preserving moves only):

1. `src/app/play/error.tsx` — default Next error UI with “重试” calling `reset()`.
2. Extract pure presentational chunks already partially started (`PlayerHeader`, `PlayerSidebar`, overlays) — move remaining JSX islands out of `page.tsx`.
3. Extract player lifecycle (`setupPlayer` / dispose / event wiring) into `src/components/player/` or `src/lib/playback-*` modules **without** changing session event contracts.

Do not require finishing the entire 6400→300 split in one PR — ship: (a) `error.tsx`, (b) at least one meaningful extraction (≥1 cohesive module, e.g. native recovery listeners OR favorite/effects block), (c) page still compiles and play smoke works.

## Repo conventions to follow

- Follow existing `src/components/player/*` naming.
- Keep `'use client'` only where hooks require it.
- Prefer moving code over rewriting algorithms.

## Steps

1. Add `src/app/play/error.tsx` with Chinese copy consistent with the app.
2. Choose one vertical slice (recommend: favorite + beforeunload effects block, or loading overlays) and move it to a named module/component.
3. Re-export wiring from `PlayPageClient` with identical props/refs.
4. Run play-focused tests / smoke.
5. Optionally file follow-up TODOs for further slices — do not block on full decomposition.

## Boundaries

- Do NOT change playback session event types unless required for the move.
- Do NOT combine Next major upgrade (#002) into this PR.
- STOP if `page.tsx` structure already diverged heavily; re-scope extractions slice.

## Verification

- **Mechanical**: typecheck/lint/tests; React Doctor `no-giant-component` may still warn (acceptable if line count still high) — **must** have `error.tsx` present.
- **Behavior check**: Force a throw in a child temporarily — error UI appears with retry. Normal playback of one episode still works after extraction.
- **Done when**: error boundary exists; at least one slice extracted; play smoke green.
