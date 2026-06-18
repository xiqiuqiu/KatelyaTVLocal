# Playback Session Refactor PRD

Date: 2026-06-18

## Problem

Playback orchestration currently concentrates in `src/app/play/page.tsx`. The page coordinates video element events, user intent, source switching, HLS/native policy, recovery, progress saving, debug evidence, and ad skip behavior. Several policy modules already exist, but the play page remains the main interface for the active viewing attempt.

This makes playback behavior hard to verify through one stable module seam. It also makes iOS native HLS behavior fragile, because automatic ad skipping and ordinary video seeking can look like the same page-level operation.

## Goal

Introduce a command-driven Playback Session module that receives playback, user, source, and timer events, then returns state updates and effects for a React/video adapter to execute.

The first implementation goal is not to redesign playback policy. It is to preserve current behavior while moving automatic recovery source switching behind a deeper module interface.

## Non-Goals

- Do not redesign source ranking, D1 scoring, current-source pinning, or probe budgets.
- Do not move source discovery or detail loading into Playback Session.
- Do not let Playback Session hold or mutate the video element directly.
- Do not rewrite the entire play page in one pass.
- Do not merge automatic ad skipping with ordinary seek behavior.

## Confirmed Design Decisions

- Playback Session is a pure TypeScript state machine.
- React and video adapters execute effects returned by the state machine.
- Playback Session owns session-local source state, including current source identity, current episode index, source statuses, source scores, measured video info, attempted recovery source keys, and pending resume time.
- Source Discovery remains responsible for finding available sources and details.
- The first migration slice is automatic recovery source switching.
- Ad Skip Window usage will later enter the same effect model through a dedicated `skipAdWindow` effect.

## Proposed Module Shape

```text
src/lib/playback-session/
  types.ts
  reducer.ts
  effects.ts
  create-session.ts
  playback-session.test.ts

src/app/play/usePlaybackSession.ts
  React adapter for executing effects and bridging page state
```

## Core Interface Sketch

```ts
type PlaybackSessionEvent =
  | { type: 'sources.loaded'; payload: SourcesLoadedPayload }
  | { type: 'user.play' }
  | { type: 'user.pause' }
  | { type: 'user.seekStarted'; nowMs: number }
  | { type: 'sourceChange.started'; attemptId: number; sourceKey: string }
  | { type: 'sourceChange.completed'; attemptId: number; sourceKey: string }
  | { type: 'video.waiting'; snapshot: VideoSnapshot }
  | { type: 'video.stalled'; snapshot: VideoSnapshot }
  | { type: 'video.error'; snapshot: VideoSnapshot; errorCode?: number }
  | { type: 'timer.sourceChangeTimeout'; attemptId: number; sourceKey: string };

type PlaybackSessionEffect =
  | { type: 'setVideoUrl'; url: string; policy: HlsPlaybackPolicyResult }
  | {
      type: 'switchSource';
      sourceKey: string;
      source: SearchResult;
      episodeIndex: number;
      resumeTime: number | null;
      reason: 'auto-recovery' | 'user-selected' | 'source-timeout';
    }
  | { type: 'seek'; time: number }
  | {
      type: 'skipAdWindow';
      targetTime: number;
      windowKey: string;
      reason: 'hls-ad-window';
      platform: 'apple-native' | 'hlsjs';
    }
  | { type: 'saveProgress'; reason: PlayRecordSaveReason }
  | { type: 'emitDebugEvent'; event: PlaybackDebugEvent };
```

## Phase 1: Golden Tests and Skeleton

Create `src/lib/playback-session` with types, reducer skeleton, and golden behavior tests for existing automatic recovery decisions.

Acceptance criteria:

- Tests cover switching to the highest scored unrecovered playable source.
- Tests cover no switch while user paused.
- Tests cover no switch during manual seek grace.
- Tests cover no switch to a source without the current episode.
- Tests cover no switch to an already recovered source.
- Tests cover stale source change timeout attempts being ignored.
- Existing tests continue to pass for source selection, playback source switching, progressive source probe, HLS recovery, native video recovery, and play page behavior.

## Phase 2: Move Automatic Recovery Source Switching

Move automatic recovery source switching decisions from the play page into Playback Session. Keep existing source scoring, current-source pinning, D1 ranking behavior, and probe budgets unchanged.

Acceptance criteria:

- Given the same sources, statuses, scores, current source key, episode index, and recovered source keys, Playback Session chooses the same recovery target as the previous page logic.
- The React adapter executes `switchSource`, `emitDebugEvent`, and `saveProgress` effects.
- User pause, user seek, manual source changes, and stale timeouts continue to block unwanted automatic recovery.

## Phase 3: Move Ad Skip Window Usage

Keep HLS playlist analysis in `hls-ad-filter` and `hls-ad-skip`. Playback Session only consumes Ad Skip Windows and returns a dedicated `skipAdWindow` effect.

Acceptance criteria:

- Automatic ad skip is distinguishable from ordinary seek in tests and debug evidence.
- Manual seek grace still prevents automatic ad skip.
- iOS native HLS behavior remains direct playback and does not reintroduce proxy playlist playback as the main path.

## Phase 4: Move Progress Save Decisions

Route progress-save decisions through Playback Session effects while preserving `play-record-save-policy`.

Acceptance criteria:

- Progress save behavior remains unchanged for heartbeat, pause, source switch, route exit, and canplay recovery scenarios.
- Page adapter executes `saveProgress` effects without duplicating decision logic.

## Phase 5: Slim Play Page Adapter

Remove duplicated refs, timers, and decision branches from `src/app/play/page.tsx` once equivalent behavior is covered by Playback Session tests.

Acceptance criteria:

- The page is primarily a rendering and effect-execution adapter.
- Playback decision logic is covered through `src/lib/playback-session/playback-session.test.ts`.
- Browser validation covers normal playback, automatic recovery source switching, manual pause, manual seek, and iOS/native HLS ad skip behavior where available.

## Verification Plan

Run targeted tests after each phase:

```text
pnpm exec jest src/lib/playback-session/playback-session.test.ts
pnpm exec jest src/lib/source-selection.test.ts
pnpm exec jest src/lib/playback-source-switch.test.ts
pnpm exec jest src/lib/progressive-source-probe.test.ts
pnpm exec jest src/lib/hls-recovery.test.ts
pnpm exec jest src/lib/native-video-recovery.test.ts
pnpm exec jest src/app/play/page.test.tsx
pnpm typecheck
```

For later implementation phases, also perform browser validation on the real playback page for current-source pinning, recovery switching, pause protection, seek protection, and debug evidence.
