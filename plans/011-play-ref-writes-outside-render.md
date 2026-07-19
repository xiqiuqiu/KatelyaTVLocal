# 011 — Move play-page ref assignments out of render

- **Status**: TODO
- **Commit**: ea3113d
- **Severity**: MEDIUM
- **Category**: Bugs & correctness
- **Rule**: react-doctor/no-ref-current-in-render
- **Estimated scope**: 1 file regions in `play/page.tsx`, small

## Problem

```ts
// src/app/play/page.tsx:1253-1254 — current
handleMarkAdSkipRef.current = handleMarkAdSkip;
handleUndoAdSkipRef.current = handleUndoAdSkip;

// :2621-2622
const updateVideoUrlRef = useRef(updateVideoUrl);
updateVideoUrlRef.current = updateVideoUrl;
```

Render-phase ref mutation can leak under concurrent replay. Canonical rule: move ref writes into an event handler or effect (lazy null-guard init remains OK).

## Target

```ts
// target
const handleMarkAdSkipRef = useRef(handleMarkAdSkip);
const handleUndoAdSkipRef = useRef(handleUndoAdSkip);
useEffect(() => {
  handleMarkAdSkipRef.current = handleMarkAdSkip;
  handleUndoAdSkipRef.current = handleUndoAdSkip;
});

const updateVideoUrlRef = useRef(updateVideoUrl);
useEffect(() => {
  updateVideoUrlRef.current = updateVideoUrl;
});
```

If the repo already uses a `useEffectEvent` polyfill/pattern, prefer that for event handlers — otherwise layout-less `useEffect` sync is fine.

## Repo conventions to follow

- Keep the “latest callback via ref” semantics used throughout play page.
- Avoid adding `eslint-disable` for this rule.

## Steps

1. Find all render-time `*Ref.current =` assignments flagged on play page (1253–1254, 2622, and any siblings).
2. Convert each to effect sync (or effect-event).
3. Confirm no hook-order violations.

## Boundaries

- Do NOT change handler logic bodies.
- Do NOT “fix” by deleting the refs.
- Coordinate with #005 if sharing save refs.

## Verification

- **Mechanical**: `no-ref-current-in-render` errors clear on play page; typecheck.
- **Behavior check**: Mark/undo ad-skip still works; episode change still updates URL via `updateVideoUrl`.
- **Done when**: diagnostics clear, behaviors unchanged.
