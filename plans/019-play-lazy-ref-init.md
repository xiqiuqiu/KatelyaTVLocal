# 019 — Lazy-init expensive play-page useRef factories

- **Status**: TODO
- **Commit**: ea3113d
- **Severity**: HIGH
- **Category**: Performance
- **Rule**: react-doctor/rerender-lazy-ref-init
- **Estimated scope**: 1 file (`play/page.tsx`), small

## Problem

```ts
// src/app/play/page.tsx:479-483 — current
const playbackAttemptReporterRef = useRef<PlaybackAttemptReporter>(
  createPlaybackAttemptReporter({
    enhancedReportingEnabled: isPlaybackAttemptEnhancedReportingEnabled(),
  })
);

// :634-641
const playbackSessionStateRef = useRef<PlaybackSessionState>(
  createInitialPlaybackSessionState({
    badPoints:
      typeof window !== 'undefined'
        ? readPersistedPlaybackBadPoints(window.sessionStorage)
        : [],
  })
);
```

`useRef(factory())` runs `factory` every render and discards the result after the first.

## Target

Canonical (`rerender-lazy-ref-init`):

```ts
const playbackAttemptReporterRef = useRef<PlaybackAttemptReporter | null>(null);
if (playbackAttemptReporterRef.current === null) {
  playbackAttemptReporterRef.current = createPlaybackAttemptReporter({
    enhancedReportingEnabled: isPlaybackAttemptEnhancedReportingEnabled(),
  });
}

const playbackSessionStateRef = useRef<PlaybackSessionState | null>(null);
if (playbackSessionStateRef.current === null) {
  playbackSessionStateRef.current = createInitialPlaybackSessionState({
    badPoints:
      typeof window !== 'undefined'
        ? readPersistedPlaybackBadPoints(window.sessionStorage)
        : [],
  });
}
```

Then use non-null assertions or local consts after init. Scan the same file for other `useRef(someCall(...))` hits and fix them in the same pass.

## Repo conventions to follow

- Null-guarded lazy init is explicitly allowed by the rule (unlike arbitrary render ref writes).
- Keep session badPoints persistence semantics.

## Steps

1. Fix reporter + session state refs as above.
2. Grep play page for `useRef([A-Za-z].*\(` call/new initializers; fix remaining.
3. Adjust TypeScript types if refs become `| null`.

## Boundaries

- Do NOT change reporter public methods.
- Do NOT move session reducer logic.

## Verification

- **Mechanical**: `rerender-lazy-ref-init` clear on play page; typecheck.
- **Behavior check**: Play still initializes session; attempt reporting still fires on a forced failure if previously observable.
- **Done when**: factories run once per mount.
