# 001 — Replace high-traffic `transition-all` with explicit properties

- **Status**: DONE
- **Commit**: 0094879
- **Severity**: HIGH
- **Category**: Performance
- **Estimated scope**: ~12 files, small mechanical class edits

## Problem

`transition-all` animates unintended properties (z-index, border-color, box-shadow, background) off the compositor. On high-traffic browse/play UI this causes paint work and sluggish hover/toggle feel.

Primary exemplars at `0094879`:

```tsx
/* src/components/VideoCard.tsx:351 — current */
className={`group relative w-full transition-all duration-300 ease-in-out hover:z-[500] ${
  isSmall ? 'origin-top-left scale-75' : ''
}`}
```

```tsx
/* src/components/CapsuleSwitch.tsx:76 — current */
className='absolute bottom-1 top-1 rounded-full bg-[rgb(var(--ui-text))] shadow-ui-soft transition-all duration-300 ease-out'
```

```tsx
/* src/components/ui/CardActions.tsx:14 — current */
className={`absolute bottom-3 right-3 z-20 flex items-center gap-2 opacity-0 translate-y-2 transition-all duration-300 ease-in-out group-hover:translate-y-0 group-hover:opacity-100 ${className}`.trim()}
```

Also present: `DoubanSelector.tsx:225,242`, `Sidebar.tsx:175`, `AppShell.tsx:60`, `EpisodeSelector.tsx:1031,1047`, `EpisodeSelectorEpisodes.tsx:137,160,193`, `EpisodeSelectorSources.tsx:145`, `PlayerLoadingOverlay.tsx:13`, `InitialLoadingOverlay.tsx:69,86`, `play/page.tsx:5373`, `search/page.tsx:491`, `login/page.tsx:329,394,471`, and many `SkipController.tsx` controls.

## Target

Never use `transition-all` on interactive UI. Use property-scoped transitions:

- Opacity/transform: `transition-[opacity,transform] duration-200 ease-out`
- Colors only: `transition-colors duration-200`
- Sidebar shell width/transform/opacity: `transition-[width,transform,opacity] duration-300 ease-out`
- When a custom curve is required in CSS: `cubic-bezier(0.23, 1, 0.32, 1)` (strong ease-out)

Do **not** change visual end-states in this plan (hover lifts / reveals are plan 006 / 011). Progress-bar `width` transition is plan 004; capsule `left`/`width` is plan 003 — here only stop using `all`.

## Repo conventions to follow

- Duration tokens already exist in `src/styles/ui-theme.css:27-29` (`--ui-motion-fast: 120ms`, `--ui-motion-base: 180ms`, `--ui-motion-slow: 240ms`). Prefer them if plan 010 wired Tailwind; otherwise keep existing `duration-200` / `duration-300`.
- Exemplar of property-scoped transition: `src/components/VideoCard.tsx:387` (`transition-opacity duration-300`).

## Steps

1. Grep `transition-all` under `src/` and replace every hit with the narrowest property list matching what that element actually animates.
2. `VideoCard.tsx:351` — remove `transition-all`; do not tween `z-index`. Keep `hover:z-[500]` as an instant class if still needed after plan 006.
3. Capsule / Douban indicators — if plan 003 not landed: `transition-[left,width] duration-300 ease-out`; if 003 landed: `transition-transform duration-300 ease-out`.
4. `Sidebar.tsx:175` / `AppShell.tsx:60` — `transition-[width,transform,opacity] duration-300 ease-out`.
5. `SkipController.tsx` — replace `transition-all` with explicit props; do not remove `animate-pulse` / gradients (plan 007).
6. Re-grep until `src/` has zero `transition-all` on UI (comments only if unavoidable).

## Boundaries

- Do NOT remove hover lifts, play-button reveals, or CardActions slide (plan 006).
- Do NOT rewrite indicator measurement (plan 003) or progress `scaleX` (plan 004).
- Do NOT rewrite reduced-motion (plan 002).
- Do NOT add dependencies.
- If a cited line drifted since 0094879, STOP and report.

## Verification

- **Mechanical**: `rg "transition-all" src --glob '*.{ts,tsx,css}'` is empty (or comment-only). `pnpm typecheck` passes.
- **Feel check**: hover a home VideoCard, toggle CapsuleSwitch, collapse Sidebar — motion same or snappier. Animations panel at 10%: z-index is not tweened.
- **Done when**: no interactive `transition-all`; high-traffic toggles still work.
