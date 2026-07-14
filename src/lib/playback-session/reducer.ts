import { getHlsAdSkipDecision, getHlsAdSkipWindowKey } from '@/lib/hls-ad-skip';
import {
  getAutoRecoveryResumePlan,
  getNextRecoverySourceCandidate,
  shouldIgnoreSourceChangeTimeout,
} from '@/lib/playback-source-switch';
import { rememberPlaybackBadPoint } from '@/lib/playback-stuck-escape';
import type { SourceStatusKind } from '@/lib/types';

import { allowsAutomaticEffect } from './intent';
import type {
  PlaybackSessionEffect,
  PlaybackSessionEvent,
  PlaybackSessionResult,
  PlaybackSessionState,
  VideoSnapshot,
} from './types';

const DEFAULT_MANUAL_SEEK_GRACE_MS = 4000;
const DEFAULT_SEEK_SETTLED_SHORT_GUARD_MS = 4000;
const DEFAULT_SEEK_SETTLED_LONG_GUARD_MS = 10_000;
const DEFAULT_SOURCE_SWITCH_SETTLE_MS = 2000;

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
    badPoints: [],
    adSkipWindows: [],
    lastAdSkipWindowKey: null,
    adSkipInFlightWindowKey: null,
    pendingResumeTime: null,
    playbackIntent: 'playing',
    resumeIntentAfterSeek: null,
    lastUserSeekAtMs: null,
    seekSettledAtMs: null,
    seekSettledShortGuardMs: DEFAULT_SEEK_SETTLED_SHORT_GUARD_MS,
    seekSettledLongGuardMs: DEFAULT_SEEK_SETTLED_LONG_GUARD_MS,
    sourceChangeInFlight: false,
    currentSourceChangeAttemptId: 0,
    sourceChangeSourceKey: null,
    sourceSwitchSettledUntilMs: null,
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
  return !allowsAutomaticEffect(state, 'auto-source-switch', nowMs);
}

function createRecoverySwitchEffect(
  state: PlaybackSessionState,
  snapshot: VideoSnapshot,
  reason: 'auto-recovery' | 'source-timeout',
  nowMs: number
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
  const escape = getAutoRecoveryResumePlan({
    currentPlayTime: snapshot.currentTime,
    badPoints: state.badPoints,
    sourceKey: state.currentSourceKey,
    mode: 'cross-source',
  });
  const resumeTime = escape.resumeTime;
  const badPoints =
    escape.recordBadPointAt != null
      ? rememberPlaybackBadPoint(state.badPoints, {
          sourceKey: state.currentSourceKey,
          timeSeconds: escape.recordBadPointAt,
          nowMs,
        })
      : state.badPoints;
  const nextRecoveredSourceKeys = new Set(state.recoveredSourceKeys);
  if (state.currentSourceKey) {
    nextRecoveredSourceKeys.add(state.currentSourceKey);
  }
  nextRecoveredSourceKeys.add(sourceKey);

  return {
    state: {
      ...state,
      badPoints,
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
  if (!allowsAutomaticEffect(state, 'auto-source-switch', nowMs)) {
    return { state, effects: [] };
  }

  if (shouldRespectManualSeekGrace(state, nowMs)) {
    return { state, effects: [] };
  }

  const recovery = createRecoverySwitchEffect(state, snapshot, reason, nowMs);
  if (!recovery) {
    return { state, effects: [] };
  }

  return {
    state: recovery.state,
    effects: [recovery.effect],
  };
}

function cancelInFlightAdSkip(
  state: PlaybackSessionState,
  reason: 'user-paused' | 'seeking' | 'user-switch'
): PlaybackSessionResult {
  const windowKey = state.adSkipInFlightWindowKey;
  if (!windowKey) {
    return { state, effects: [] };
  }

  return {
    state: {
      ...state,
      adSkipInFlightWindowKey: null,
    },
    effects: [
      {
        type: 'cancelAdSkip',
        windowKey,
        reason,
      },
    ],
  };
}

function withIntentTransition(
  state: PlaybackSessionState,
  nextState: PlaybackSessionState,
  cancelReason: 'user-paused' | 'seeking' | 'user-switch' | null
): PlaybackSessionResult {
  if (!cancelReason) {
    return { state: nextState, effects: [] };
  }

  const cancelled = cancelInFlightAdSkip(state, cancelReason);
  return {
    state: {
      ...nextState,
      adSkipInFlightWindowKey: cancelled.state.adSkipInFlightWindowKey,
    },
    effects: cancelled.effects,
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
      return withIntentTransition(
        state,
        {
          ...state,
          playbackIntent: 'playing',
          resumeIntentAfterSeek: null,
          seekSettledAtMs: null,
          sourceSwitchSettledUntilMs: null,
        },
        null
      );

    case 'user.pause':
      return withIntentTransition(
        state,
        {
          ...state,
          playbackIntent: 'user-paused',
          resumeIntentAfterSeek: null,
          seekSettledAtMs: null,
          sourceSwitchSettledUntilMs: null,
        },
        'user-paused'
      );

    case 'user.seekStarted':
      return withIntentTransition(
        state,
        {
          ...state,
          playbackIntent: 'seeking',
          resumeIntentAfterSeek:
            state.playbackIntent === 'user-paused' ||
            state.resumeIntentAfterSeek === 'user-paused'
              ? 'user-paused'
              : 'playing',
          lastUserSeekAtMs: event.nowMs,
          seekSettledAtMs: null,
        },
        'seeking'
      );

    case 'user.seekSettled': {
      const resumeIntent =
        state.resumeIntentAfterSeek === 'user-paused'
          ? 'user-paused'
          : 'seek-settled';
      return {
        state: {
          ...state,
          playbackIntent: resumeIntent,
          resumeIntentAfterSeek: null,
          lastUserSeekAtMs: event.nowMs,
          seekSettledAtMs:
            resumeIntent === 'seek-settled' ? event.nowMs : null,
        },
        effects: [],
      };
    }

    case 'user.switchSource':
      return withIntentTransition(
        state,
        {
          ...state,
          playbackIntent: 'playing',
          resumeIntentAfterSeek: null,
          currentSourceKey: event.sourceKey,
          seekSettledAtMs: null,
          sourceSwitchSettledUntilMs:
            event.nowMs + DEFAULT_SOURCE_SWITCH_SETTLE_MS,
        },
        'user-switch'
      );

    case 'user.switchEpisode':
      return withIntentTransition(
        state,
        {
          ...state,
          playbackIntent: 'playing',
          resumeIntentAfterSeek: null,
          currentEpisodeIndex: event.episodeIndex,
          seekSettledAtMs: null,
          recoveredSourceKeys: new Set(),
          sourceSwitchSettledUntilMs:
            event.nowMs + DEFAULT_SOURCE_SWITCH_SETTLE_MS,
        },
        'user-switch'
      );

    case 'adSkipWindows.loaded':
      return {
        state: {
          ...state,
          adSkipWindows: event.windows,
          lastAdSkipWindowKey: null,
          adSkipInFlightWindowKey: null,
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
      if (!allowsAutomaticEffect(state, 'ad-skip', event.nowMs)) {
        return { state, effects: [] };
      }

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
          adSkipInFlightWindowKey: windowKey,
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
