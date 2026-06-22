import { getHlsAdSkipDecision, getHlsAdSkipWindowKey } from '@/lib/hls-ad-skip';
import {
  getAutoRecoveryResumeTime,
  getNextRecoverySourceCandidate,
  shouldIgnoreSourceChangeTimeout,
} from '@/lib/playback-source-switch';
import type { SourceStatusKind } from '@/lib/types';

import type {
  PlaybackSessionEffect,
  PlaybackSessionEvent,
  PlaybackSessionResult,
  PlaybackSessionState,
  VideoSnapshot,
} from './types';

const DEFAULT_MANUAL_SEEK_GRACE_MS = 4000;

export function createInitialPlaybackSessionState(
  input: Partial<PlaybackSessionState> = {}
): PlaybackSessionState {
  return {
    sources: [],
    currentSourceKey: null,
    currentEpisodeIndex: 0,
    sourceStatuses: new Map(),
    sourceScores: new Map(),
    measuredVideoInfo: new Map(),
    recoveredSourceKeys: new Set(),
    adSkipWindows: [],
    lastAdSkipWindowKey: null,
    pendingResumeTime: null,
    playbackIntent: 'playing',
    lastUserSeekAtMs: null,
    sourceChangeInFlight: false,
    currentSourceChangeAttemptId: 0,
    sourceChangeSourceKey: null,
    manualSeekGraceMs: DEFAULT_MANUAL_SEEK_GRACE_MS,
    ...input,
  };
}

function getSourceKey(source: { source: string; id: string }) {
  return `${source.source}-${source.id}`;
}

function shouldRespectManualSeekGrace(
  state: PlaybackSessionState,
  nowMs: number
) {
  return (
    state.lastUserSeekAtMs !== null &&
    nowMs - state.lastUserSeekAtMs >= 0 &&
    nowMs - state.lastUserSeekAtMs < state.manualSeekGraceMs
  );
}

function createRecoverySwitchEffect(
  state: PlaybackSessionState,
  snapshot: VideoSnapshot,
  reason: 'auto-recovery' | 'source-timeout'
): { state: PlaybackSessionState; effect: PlaybackSessionEffect } | null {
  const candidate = getNextRecoverySourceCandidate({
    candidates: state.sources,
    currentSourceKey: state.currentSourceKey,
    recoveredSourceKeys: state.recoveredSourceKeys,
    currentEpisodeIndex: state.currentEpisodeIndex,
    getSourceKey,
    getStatusKind: (source): SourceStatusKind | null | undefined =>
      state.sourceStatuses.get(getSourceKey(source))?.kind,
    getCandidateScore: (source) =>
      state.sourceScores.get(getSourceKey(source))?.score,
  });

  if (!candidate) {
    return null;
  }

  const sourceKey = getSourceKey(candidate);
  const resumeTime = getAutoRecoveryResumeTime(snapshot.currentTime);
  const nextRecoveredSourceKeys = new Set(state.recoveredSourceKeys);
  if (state.currentSourceKey) {
    nextRecoveredSourceKeys.add(state.currentSourceKey);
  }
  nextRecoveredSourceKeys.add(sourceKey);

  return {
    state: {
      ...state,
      recoveredSourceKeys: nextRecoveredSourceKeys,
      pendingResumeTime: resumeTime,
    },
    effect: {
      type: 'switchSource',
      sourceKey,
      source: candidate,
      episodeIndex: state.currentEpisodeIndex,
      resumeTime,
      reason,
    },
  };
}

function maybeRecoverFromSnapshot(
  state: PlaybackSessionState,
  snapshot: VideoSnapshot,
  nowMs: number,
  reason: 'auto-recovery' | 'source-timeout'
): PlaybackSessionResult {
  if (state.playbackIntent === 'paused') {
    return { state, effects: [] };
  }

  if (shouldRespectManualSeekGrace(state, nowMs)) {
    return { state, effects: [] };
  }

  const recovery = createRecoverySwitchEffect(state, snapshot, reason);
  if (!recovery) {
    return { state, effects: [] };
  }

  return {
    state: recovery.state,
    effects: [recovery.effect],
  };
}

export function reducePlaybackSession(
  state: PlaybackSessionState,
  event: PlaybackSessionEvent
): PlaybackSessionResult {
  switch (event.type) {
    case 'sources.loaded':
      return {
        state: {
          ...state,
          sources: event.sources,
          currentSourceKey: event.currentSourceKey,
          currentEpisodeIndex: event.currentEpisodeIndex,
          sourceStatuses: event.sourceStatuses || new Map(),
          sourceScores: event.sourceScores || new Map(),
          measuredVideoInfo: event.measuredVideoInfo || new Map(),
          recoveredSourceKeys: event.recoveredSourceKeys || new Set(),
        },
        effects: [],
      };

    case 'user.play':
      return { state: { ...state, playbackIntent: 'playing' }, effects: [] };

    case 'user.pause':
      return { state: { ...state, playbackIntent: 'paused' }, effects: [] };

    case 'user.seekStarted':
      return {
        state: { ...state, lastUserSeekAtMs: event.nowMs },
        effects: [],
      };

    case 'adSkipWindows.loaded':
      return {
        state: {
          ...state,
          adSkipWindows: event.windows,
          lastAdSkipWindowKey: null,
        },
        effects: [],
      };

    case 'progressSave.requested':
      return {
        state,
        effects: [{ type: 'saveProgress', reason: event.reason }],
      };

    case 'sourceChange.started':
      return {
        state: {
          ...state,
          sourceChangeInFlight: true,
          currentSourceChangeAttemptId: event.attemptId,
          sourceChangeSourceKey: event.sourceKey,
        },
        effects: [],
      };

    case 'sourceChange.completed':
      if (event.attemptId !== state.currentSourceChangeAttemptId) {
        return { state, effects: [] };
      }

      return {
        state: {
          ...state,
          sourceChangeInFlight: false,
          sourceChangeSourceKey: null,
        },
        effects: [],
      };

    case 'recovery.switchFailed': {
      const recoveredSourceKeys = new Set(state.recoveredSourceKeys);
      recoveredSourceKeys.delete(event.sourceKey);
      return {
        state: {
          ...state,
          recoveredSourceKeys,
        },
        effects: [],
      };
    }

    case 'video.timeupdate': {
      const decision = getHlsAdSkipDecision({
        currentTimeSeconds: event.snapshot.currentTime,
        windows: state.adSkipWindows,
        lastSkippedWindowKey: state.lastAdSkipWindowKey,
        lastUserSeekAtMs: state.lastUserSeekAtMs,
        nowMs: event.nowMs,
      });

      if (!decision.shouldSkip || decision.targetTimeSeconds == null) {
        return { state, effects: [] };
      }

      const windowKey = decision.window
        ? getHlsAdSkipWindowKey(decision.window)
        : decision.windowKey;
      if (!windowKey) {
        return { state, effects: [] };
      }

      return {
        state: {
          ...state,
          lastAdSkipWindowKey: windowKey,
        },
        effects: [
          {
            type: 'skipAdWindow',
            targetTime: decision.targetTimeSeconds,
            windowKey,
            reason: 'hls-ad-window',
            platform: event.platform || 'hlsjs',
          },
        ],
      };
    }

    case 'video.waiting':
    case 'video.stalled':
    case 'video.error':
      return maybeRecoverFromSnapshot(
        state,
        event.snapshot,
        event.nowMs,
        'auto-recovery'
      );

    case 'timer.sourceChangeTimeout':
      if (
        shouldIgnoreSourceChangeTimeout({
          attemptId: event.attemptId,
          currentAttemptId: state.currentSourceChangeAttemptId,
          isVideoLoading: state.sourceChangeInFlight,
          timeoutSourceKey: event.sourceKey,
          currentSourceKey: state.sourceChangeSourceKey,
        })
      ) {
        return { state, effects: [] };
      }

      return maybeRecoverFromSnapshot(
        {
          ...state,
          sourceChangeInFlight: false,
          sourceChangeSourceKey: null,
        },
        event.snapshot,
        event.nowMs,
        'source-timeout'
      );
  }
}
