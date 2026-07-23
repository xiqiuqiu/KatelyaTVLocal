# 006 — Strip VideoCard high-frequency hover motion stack

- **Status**: DONE
- **Commit**: 0094879
- **Severity**: HIGH
- **Category**: Purpose & frequency
- **Estimated scope**: 3 files, small–medium

## Problem

Every browse/search hover pays for stacked decorative motion:

```tsx
/* src/components/ui/Surface.tsx:13 — current */
raised: 'ui-glass transition duration-300 hover:-translate-y-1 hover:border-[rgb(var(--ui-accent)/0.34)] hover:shadow-ui-strong',
```

```tsx
/* src/components/VideoCard.tsx:351-398 — current (excerpt) */
className={`group relative w-full transition-all duration-300 ease-in-out hover:z-[500] ...`}
...
className={`... transition-opacity duration-300 group-hover:opacity-100 ...`}
className={`... transition-all duration-300 ease-in-out ${
  showOpeningState ? 'opacity-100' : 'opacity-0 delay-75 group-hover:opacity-100'
}`}
```

```tsx
/* src/components/ui/CardActions.tsx:14 — current */
className={`... opacity-0 translate-y-2 transition-all duration-300 ease-in-out group-hover:translate-y-0 group-hover:opacity-100 ...`}
```

AUDIT: tens-of-times/day hover decoration should be removed or drastically reduced.

## Target

1. `Surface` `raised`: remove `hover:-translate-y-1`. Keep border/shadow hover if desired, with `transition-[border-color,box-shadow] duration-200 ease` (hover color change → CSS `ease`).
2. `VideoCard` play overlay: remove `delay-75`. Prefer instant opacity on hover: `transition-opacity duration-150 ease` (or show play icon at reduced resting opacity without motion). Opening/loading state (`showOpeningState`) may still fade in at 150–200ms ease-out.
3. `CardActions`: remove `translate-y-2` / `group-hover:translate-y-0`. Use opacity only:

```tsx
className={`absolute bottom-3 right-3 z-20 flex items-center gap-2 opacity-0 transition-opacity duration-150 ease group-hover:opacity-100 ${className}`.trim()}
```

On touch devices without hover, actions must remain reachable — if they are hover-only today, add `max-md:opacity-100` (or existing mobile pattern if one exists) so favorites stay tappable. Check current mobile behavior before changing; if mobile already uses a different path, keep it.

4. Icon buttons may keep a subtle press: `active:scale-[0.97] transition-transform duration-[160ms] ease-out`. Remove or gate `hover:scale-[1.06]` (plan 009 owns hover media gating — here reduce scale hover to none or `1.03` max).

## Repo conventions to follow

- Cards use `Surface variant='raised'` — change the shared variant carefully; grep other `variant='raised'` usages and ensure landing pages that need lift are not unintentionally flattened without review. If non-card raised surfaces need lift, add a new variant `raisedInteractive` rather than keeping card lift.
- Exemplar restrained control: focus rings already use `focus-visible:ring-*` on VideoCard buttons.

## Steps

1. Grep `variant='raised'` / `variant=\"raised\"`. If VideoCard is the dominant consumer, remove translate from `raised`. If admin/other surfaces need lift, split variants.
2. Edit `CardActions.tsx` as in Target.
3. Edit VideoCard play overlay: drop delay; shorten opacity transition to 150ms; remove `transition-all` on overlay/icon.
4. Soften/remove icon `hover:scale-[1.06]` on the card action buttons.

## Boundaries

- Do NOT change favorite/delete handlers or card routing.
- Do NOT restyle badge chips.
- Do NOT reintroduce list stagger (plan 005).

## Verification

- **Mechanical**: `pnpm typecheck`. CardActions has no `translate-y`.
- **Feel check**: scrub mouse across a row of posters — no bouncing cards, actions appear quickly without slide, play icon does not lag. Touch phone: heart still tappable.
- **Done when**: no card translate-on-hover; CardActions opacity-only ≤150ms; no hover delay on play icon.
