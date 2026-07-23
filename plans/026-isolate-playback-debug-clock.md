# 026 — Isolate the playback debug clock from PlayPageClient

- **Status**: DONE
- **Commit**: 6e7374f
- **Severity**: MEDIUM
- **Category**: Performance
- **Rule**: Beyond the scan
- **Estimated scope**: 3 files, small

## Problem

`src/app/play/page.tsx:657` keeps a debug-only playhead in root React state.
`publishPlayTimeForUi` calls its setter once per playback second, so the full
`PlayPageClient` and its player, source, episode, detail, and recommendation
subtrees re-render even when the debug panel is disabled.

```ts
// src/app/play/page.tsx:656 — current
const [currentPlayTime, setCurrentPlayTime] = useState<number>(0);
const currentPlayTimeRef = useRef(0);

const publishPlayTimeForUi = (currentTime: number) => {
  currentPlayTimeRef.current = currentTime;
  const publishedSecond = Math.floor(currentTime);
  if (publishedSecond !== Math.floor(lastPublishedPlaySecondRef.current)) {
    lastPublishedPlaySecondRef.current = currentTime;
    setCurrentPlayTime(currentTime);
  }
};
```

The state is consumed only at `page.tsx:5196`, inside
`playbackDebugEnabled && ...`.

## Target

Keep the hot playhead exclusively in `currentPlayTimeRef`. Add
`src/components/player/PlaybackDebugPlayhead.tsx`; it mounts only with the debug
panel and samples the ref once per second.

```tsx
'use client';

import type { MutableRefObject } from 'react';
import { useEffect, useState } from 'react';

export default function PlaybackDebugPlayhead({
  currentTimeRef,
}: {
  currentTimeRef: MutableRefObject<number>;
}) {
  const [displayTime, setDisplayTime] = useState(currentTimeRef.current);

  useEffect(() => {
    setDisplayTime(currentTimeRef.current);
    const intervalId = window.setInterval(() => {
      setDisplayTime(currentTimeRef.current);
    }, 1000);
    return () => window.clearInterval(intervalId);
  }, [currentTimeRef]);

  return <>位置：{formatDebugPlaybackTime(displayTime)}</>;
}
```

Move the current module-scope `formatDebugPlaybackTime` helper into this
component (or a shared pure utility imported by both if another real consumer
exists). In `PlayPageClient`, target:

```ts
const publishPlayTimeForUi = (currentTime: number) => {
  currentPlayTimeRef.current = currentTime;
};

const resetPublishedPlayTime = () => {
  currentPlayTimeRef.current = 0;
};
```

```tsx
// debug panel target
<div>
  <PlaybackDebugPlayhead currentTimeRef={currentPlayTimeRef} />
</div>
```

Delete `currentPlayTime` state and `lastPublishedPlaySecondRef`; preserve every
other `timeupdate` side effect.

## Repo conventions to follow

- Keep player leaf UI under `src/components/player/`.
- Imitate fake-timer cleanup tests used by nearby timed player components.
- Preserve `currentPlayTimeRef` for recovery, save, ad-skip, and telemetry
  readers.

## Steps

1. Record a React DevTools Profiler baseline for 15 seconds of playback with
   debug disabled: PlayPageClient commit count and total render duration.
2. Add a focused fake-timer test for `PlaybackDebugPlayhead`: initial value,
   one-second update, and interval cleanup.
3. Add the leaf component exactly as above.
4. Remove root playhead state and publish only to the existing ref.
5. Render the new leaf only inside the existing debug panel.
6. Verify reset, source switch, resume, skip, and watch-progress paths still
   read the ref.

## Boundaries

- Do NOT remove or slow HLS recovery, watch-progress saves, ad-skip checks, or
  telemetry.
- Do NOT split the rest of `PlayPageClient` in this plan.
- Do NOT introduce a global store or new dependency.
- Debug display may update at one-second granularity; playback logic may not.
- STOP if code has drifted from commit `6e7374f`.

## Verification

- **Mechanical**:
  - `pnpm test --runInBand src/components/player/PlaybackDebugPlayhead.test.tsx src/app/play/page.test.tsx`
  - `pnpm typecheck`
  - `pnpm lint:strict` (separate unrelated baseline warnings)
  - `npx react-doctor@latest --scope changed` must not lower the score.
- **Behavior check**: React DevTools Profiler and “Highlight updates” during
  15 seconds of playback must show no once-per-second PlayPageClient commits
  when debug is disabled. Enabling debug updates only the small playhead leaf.
  Playback resume and skip behavior remain correct.
- **Done when**: parent commit count no longer tracks playback seconds and the
  debug clock remains accurate within one second.
