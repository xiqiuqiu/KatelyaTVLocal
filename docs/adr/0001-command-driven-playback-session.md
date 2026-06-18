# ADR 0001: Use a command-driven Playback Session module

## Status

Accepted

## Context

Playback orchestration currently lives mostly in the play page. The page coordinates user actions, browser video events, source changes, HLS/native playback differences, recovery decisions, progress saving, ad skip decisions, and debug evidence.

Several policy modules already exist, including source selection, HLS playback policy, playback source switching, HLS recovery, native video recovery, play record saving, and HLS ad skip decisions. These modules are useful, but the play page still acts as the main interface for the active playback attempt. This keeps refs, timers, media element operations, and recovery decisions coupled in one place.

iOS native HLS behavior exposed this weakness. Some logic existed to decide when to skip an ad window, while the page also directly manipulated the video element. That made automatic ad skipping hard to distinguish from ordinary seeking, source recovery, or user navigation.

## Decision

Introduce a command-driven Playback Session module for playback orchestration.

The Playback Session module will be a pure TypeScript state machine. It receives playback, user, source, and timer events, then returns updated session state plus effects for an adapter to execute.

The React play page, or a thin React adapter near it, will execute effects such as setting the video URL, seeking, switching source, saving progress, emitting debug evidence, stopping media loading, or playing the video. The Playback Session module will not hold or mutate the video element directly.

The module owns source state inside the active playback attempt, including current source identity, current episode index, source statuses, source scores, measured video information, attempted recovery source keys, and pending resume time. It does not own source discovery or detail loading.

The first migration slice is automatic recovery source switching. It should preserve existing source scoring, source ordering, current-source pinning, D1 ranking behavior, and probe budgets.

Ad Skip Window decisions are modeled separately from ordinary seeking. Automatic ad skipping should return a dedicated effect so adapters and debug evidence can distinguish it from user seek, resume seek, or source-switch resume.

## Consequences

Playback decisions become testable through one session interface rather than through a large React page and browser media element side effects.

The page remains responsible for rendering and effect execution during the first migration. This avoids a large rewrite and lets the new module grow by replacing one vertical slice at a time.

Adapters must translate session effects into DOM, React state, fetch, storage, and debug side effects. That adapter code remains necessary, but it should not contain playback decision logic.

Golden behavior tests should lock the current automatic recovery behavior before moving it behind the Playback Session interface.
