# 031 — Store castStatus in a ref (stop PlayPage re-renders)

- **Status**: DONE
- **Commit**: 411e0c2
- **Severity**: HIGH
- **Category**: Performance
- **Rule**: react-doctor/rerender-state-only-in-handlers
- **Estimated scope**: 1 file (`src/app/play/page.tsx`), small

## Problem

```ts
// src/app/play/page.tsx:666 — current
const [castStatus, setCastStatus] = useState<CastStatus>('idle');
```

Canonical fix (`rerender-state-only-in-handlers` /
https://www.react.doctor/prompts/rules/react-doctor/rerender-state-only-in-handlers.md):

> Replace useState with useRef(initial) and mutate via ref.current = newValue.
> The component no longer re-renders on every update…

Evidence this value is not render-reachable: JSX never reads `castStatus`. The
Artplayer control builds a one-shot `tooltip` string from the closed-over value
at setup (`:4803-4807`) and then updates the DOM through
`updateCastControlElement` (`:2914`, `:4817-4844`). Yet click handlers still call
`setCastStatus('connecting')` / `setCastStatus(result.status)` (`:4816`, `:4840`),
forcing a full `PlayPageClient` re-render on every cast attempt.

## Target

```ts
// target
const castStatusRef = useRef<CastStatus>('idle');

// in click handler
castStatusRef.current = 'connecting';
updateCastControlElement(castControlElement, 'connecting', '正在连接投屏');
// …
castStatusRef.current = result.status;
updateCastControlElement(
  castControlElement,
  result.status,
  result.status === 'connected' ? '已投屏' : '投屏'
);
```

For the initial `tooltip` at control registration time, read
`castStatusRef.current` (or hard-code `'投屏'` since setup runs at idle).

Remove all `setCastStatus` / `useState<CastStatus>` usages.

## Repo conventions to follow

- Same pattern as other play-page instance values (`videoUrlRef`,
  `originalVideoUrlRef`).
- Keep `updateCastControlElement` as the sole UI writer.

## Steps

1. Replace `useState<CastStatus>('idle')` with `useRef<CastStatus>('idle')`.
2. Swap both `setCastStatus(...)` call sites to `castStatusRef.current = ...`.
3. Update tooltip expression to use `castStatusRef.current` or static idle copy.
4. Grep the file for `castStatus` / `setCastStatus` — zero state leftovers.

## Boundaries

- Do NOT change `requestCastPlayback` / cast library behavior.
- Do NOT add React state for cast UI elsewhere.
- STOP if cast status is now rendered in JSX (diagnostic would be a false
  positive then); report drift.

## Verification

- **Mechanical**: `npx react-doctor@latest --scope changed` clears
  `rerender-state-only-in-handlers` for this site; `pnpm typecheck`.
- **Behavior check**: React DevTools “Highlight updates” — clicking cast no
  longer flashes the whole play tree. Tooltip / control still cycles
  connecting → connected/idle via DOM updates; notice messages still show.
- **Done when**: cast clicks do not re-render `PlayPageClient`; cast UX intact.
