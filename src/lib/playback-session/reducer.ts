import { getHlsAdSkipDecision, getHlsAdSkipWindowKey } from '@/lib/hls-ad-skip';
import {
  getAutoRecoveryResumePlan,
  shouldIgnoreSourceChangeTimeout,
} from '@/lib/playback-source-switch';
import { rememberPlaybackBadPoint } from '@/lib/playback-stuck-escape';
import { selectRecoveryCandidate } from '@/lib/source-availability/index';
import type { SourceSelectionScore } from '@/lib/source-selection';
import type { SearchResult } from '@/lib/types';

import { allowsAutomaticEffect } from './intent';
import {
  advanceRecoveryLadder,
  cancelRecoveryEpisode,
  clearStallEpisode,
  isRecoveryInFlightBlockingAdSkip,
  isResumePendingBlockingAdSkip,
  loadBadPointsForScope,
  persistBadPointsForScope,
  shouldEvaluateR3AfterLadder,
} from './recovery';
import type {
  PlaybackSessionEffect,
  PlaybackSessionEvent,
  PlaybackSessionResult,
  PlaybackSessionSourceScore,
  PlaybackSessionState,
  RecoveryRuntimeEvidence,
  VideoSnapshot,
} from './types';

const DEFAULT_MANUAL_SEEK_GRACE_MS = 4000;
const DEFAULT_SEEK_SETTLED_SHORT_GUARD_MS = 4000;
const DEFAULT_SEEK_SETTLED_LONG_GUARD_MS = 10_000;
const DEFAULT_SOURCE_SWITCH_SETTLE_MS = 2000;

export function createInitialPlaybackSessionState(
  input: Partial<PlaybackSessionState> = {}
): PlaybackSessionState {
  const recoveryResumeTime =
    input.recoveryResumeTime ?? input.pendingResumeTime ?? null;
  return {
    sources: [],
    currentSourceKey: null,
    currentEpisodeIndex: 0,
    contentKey: null,
    sourceStatuses: new Map(),
    sourceScores: new Map(),
    measuredVideoInfo: new Map(),
    recoveredSourceKeys: new Set(),
    badPoints: [],
    badPointsByScope: new Map(),
    adSkipWindows: [],
    lastAdSkipWindowKey: null,
    adSkipInFlightWindowKey: null,
    recoveryStage: 'idle',
    stallEpisodeActive: false,
    r0EnteredAtMs: null,
    r1AttemptCount: 0,
    r2AttemptCount: 0,
    recoveryInFlight: null,
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
    recoveryResumeTime,
    pendingResumeTime: recoveryResumeTime,
  };
}

function getSourceKey(source: { source: string; id: string }) {
  return `${source.source}-${source.id}`;
}

function toSelectionScores(
  sources: SearchResult[],
  sourceScores: Map<string, PlaybackSessionSourceScore>
): Map<string, SourceSelectionScore> {
  const scores = new Map<string, SourceSelectionScore>();
  sources.forEach((source, originalIndex) => {
    const sourceKey = getSourceKey(source);
    const score = sourceScores.get(sourceKey);
    if (!score) {
      return;
    }
    scores.set(sourceKey, {
      sourceKey,
      score: score.score,
      reason: '',
      source,
      originalIndex,
    });
  });
  return scores;
}

function setRecoveryResumeTime(
  state: PlaybackSessionState,
  resumeTime: number | null
): PlaybackSessionState {
  return {
    ...state,
    recoveryResumeTime: resumeTime,
    pendingResumeTime: resumeTime,
  };
}

function createRecoverySwitchEffect(
  state: PlaybackSessionState,
  snapshot: VideoSnapshot,
  reason: 'auto-recovery' | 'source-timeout',
  nowMs: number
): { state: PlaybackSessionState; effect: PlaybackSessionEffect } | null {
  const selected = selectRecoveryCandidate({
    sources: state.sources,
    currentSourceKey: state.currentSourceKey,
    currentEpisodeIndex: state.currentEpisodeIndex,
    statuses: state.sourceStatuses,
    measured: state.measuredVideoInfo,
    sourceSelectionScores: toSelectionScores(state.sources, state.sourceScores),
    attemptedSourceKeys: state.recoveredSourceKeys,
  });

  if (!selected) {
    return null;
  }

  const candidate = selected.source;
  const sourceKey = selected.sourceKey;
  const seedTime = state.recoveryResumeTime ?? snapshot.currentTime;
  const escape = getAutoRecoveryResumePlan({
    currentPlayTime: seedTime,
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

  const withBadPoints = {
    ...state,
    badPoints,
    badPointsByScope: persistBadPointsForScope(
      state.badPointsByScope,
      state.contentKey,
      state.currentEpisodeIndex,
      badPoints
    ),
    recoveredSourceKeys: nextRecoveredSourceKeys,
  };

  return {
    state: {
      ...setRecoveryResumeTime(withBadPoints, resumeTime),
      recoveryStage: 'R3',
      stallEpisodeActive: false,
      recoveryInFlight: 'R3',
      r0EnteredAtMs: null,
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

function tryEmitR3(
  state: PlaybackSessionState,
  snapshot: VideoSnapshot,
  nowMs: number,
  reason: 'auto-recovery' | 'source-timeout'
): PlaybackSessionResult {
  if (!allowsAutomaticEffect(state, 'auto-source-switch', nowMs)) {
    return { state, effects: [] };
  }

  const recovery = createRecoverySwitchEffect(state, snapshot, reason, nowMs);
  if (!recovery) {
    return {
      state: {
        ...state,
        recoveryStage: 'exhausted',
        stallEpisodeActive: false,
        recoveryInFlight: null,
      },
      effects: [
        {
          type: 'emitDebugEvent',
          eventType: 'recovery-exhausted',
          message: 'Automatic recovery candidates exhausted',
          details: { reason },
        },
      ],
    };
  }

  const cancelled = cancelInFlightAdSkip(recovery.state, 'recovery-in-flight');
  return {
    state: {
      ...recovery.state,
      adSkipInFlightWindowKey: cancelled.state.adSkipInFlightWindowKey,
    },
    effects: [...cancelled.effects, recovery.effect],
  };
}

function handleStallCandidate(
  state: PlaybackSessionState,
  snapshot: VideoSnapshot,
  nowMs: number,
  options: {
    evidence?: RecoveryRuntimeEvidence | null;
    hardFailure?: boolean;
    forceR3Evaluation?: boolean;
    r3Reason?: 'auto-recovery' | 'source-timeout';
  } = {}
): PlaybackSessionResult {
  const sameSourceGate = allowsAutomaticEffect(
    state,
    'same-source-recovery',
    nowMs
  );
  const autoSwitchGate = allowsAutomaticEffect(
    state,
    'auto-source-switch',
    nowMs
  );

  if (!sameSourceGate && !autoSwitchGate) {
    return { state, effects: [] };
  }

  if (
    options.forceR3Evaluation ||
    (options.hardFailure && !sameSourceGate && autoSwitchGate)
  ) {
    if (!autoSwitchGate) {
      return { state, effects: [] };
    }
    return tryEmitR3(
      state,
      snapshot,
      nowMs,
      options.r3Reason || 'auto-recovery'
    );
  }

  if (!sameSourceGate) {
    // Seek-settled long guard may still allow auto-switch later; soft path blocked.
    return { state, effects: [] };
  }

  const ladder = advanceRecoveryLadder(state, {
    snapshot,
    nowMs,
    evidence: options.evidence,
    hardFailure: options.hardFailure,
    forceR3Evaluation: options.forceR3Evaluation,
  });

  if (
    shouldEvaluateR3AfterLadder(ladder, {
      hardFailure: options.hardFailure,
      forceR3Evaluation: options.forceR3Evaluation,
    }) ||
    options.forceR3Evaluation ||
    options.hardFailure
  ) {
    // Same-source effects already emitted (if any) take precedence this tick
    // unless we are on a hard/forced R3 path with no same-source effect.
    const hasSameSourceEffect = ladder.effects.some(
      (effect) => effect.type === 'sameSourceRecover'
    );
    if (hasSameSourceEffect && !options.forceR3Evaluation) {
      const cancelled = cancelInFlightAdSkip(
        ladder.state,
        'recovery-in-flight'
      );
      return {
        state: {
          ...ladder.state,
          adSkipInFlightWindowKey: cancelled.state.adSkipInFlightWindowKey,
        },
        effects: [...cancelled.effects, ...ladder.effects],
      };
    }

    if (autoSwitchGate) {
      const r3 = tryEmitR3(
        ladder.state,
        snapshot,
        nowMs,
        options.r3Reason || 'auto-recovery'
      );
      return {
        state: r3.state,
        effects: [
          ...ladder.effects.filter((e) => e.type === 'emitDebugEvent'),
          ...r3.effects,
        ],
      };
    }
  }

  if (ladder.effects.some((effect) => effect.type === 'sameSourceRecover')) {
    const cancelled = cancelInFlightAdSkip(ladder.state, 'recovery-in-flight');
    return {
      state: {
        ...ladder.state,
        adSkipInFlightWindowKey: cancelled.state.adSkipInFlightWindowKey,
      },
      effects: [...cancelled.effects, ...ladder.effects],
    };
  }

  return ladder;
}

function cancelInFlightAdSkip(
  state: PlaybackSessionState,
  reason:
    | 'user-paused'
    | 'seeking'
    | 'user-switch'
    | 'recovery-in-flight'
    | 'resume-pending'
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
  const recoveryCancelled =
    cancelReason === 'user-paused' || cancelReason === 'seeking'
      ? cancelRecoveryEpisode(cancelled.state)
      : cancelled.state;

  // Pause/seek cancel must not erase bad points. Episode/source switch already
  // applied scope rules on nextState — do not overwrite those.
  const preserveBadPoints =
    cancelReason === 'user-paused' || cancelReason === 'seeking';

  return {
    state: {
      ...nextState,
      ...pickRecoveryCancelFields(recoveryCancelled, nextState),
      adSkipInFlightWindowKey: cancelled.state.adSkipInFlightWindowKey,
      ...(preserveBadPoints
        ? {
            badPoints: state.badPoints,
            badPointsByScope: state.badPointsByScope,
          }
        : {}),
    },
    effects: cancelled.effects,
  };
}

function pickRecoveryCancelFields(
  cancelled: PlaybackSessionState,
  nextState: PlaybackSessionState
): Pick<
  PlaybackSessionState,
  | 'recoveryStage'
  | 'stallEpisodeActive'
  | 'r0EnteredAtMs'
  | 'r1AttemptCount'
  | 'r2AttemptCount'
  | 'recoveryInFlight'
  | 'recoveryResumeTime'
  | 'pendingResumeTime'
> {
  return {
    recoveryStage: cancelled.recoveryStage,
    stallEpisodeActive: cancelled.stallEpisodeActive,
    r0EnteredAtMs: cancelled.r0EnteredAtMs,
    r1AttemptCount: cancelled.r1AttemptCount,
    r2AttemptCount: cancelled.r2AttemptCount,
    recoveryInFlight: cancelled.recoveryInFlight,
    recoveryResumeTime:
      cancelled.recoveryResumeTime ?? nextState.recoveryResumeTime,
    pendingResumeTime:
      cancelled.pendingResumeTime ?? nextState.pendingResumeTime,
  };
}

function switchEpisodeScope(
  state: PlaybackSessionState,
  episodeIndex: number
): PlaybackSessionState {
  const persisted = persistBadPointsForScope(
    state.badPointsByScope,
    state.contentKey,
    state.currentEpisodeIndex,
    state.badPoints
  );
  const nextBadPoints = loadBadPointsForScope(
    persisted,
    state.contentKey,
    episodeIndex
  );
  return {
    ...clearStallEpisode(state),
    currentEpisodeIndex: episodeIndex,
    badPointsByScope: persisted,
    badPoints: nextBadPoints,
    recoveredSourceKeys: new Set(),
    recoveryResumeTime: null,
    pendingResumeTime: null,
  };
}

function switchTitleScope(
  state: PlaybackSessionState,
  contentKey: string | null,
  episodeIndex: number
): PlaybackSessionState {
  return {
    ...clearStallEpisode(state),
    contentKey,
    currentEpisodeIndex: episodeIndex,
    badPoints: [],
    badPointsByScope: new Map(),
    recoveredSourceKeys: new Set(),
    recoveryResumeTime: null,
    pendingResumeTime: null,
  };
}

export function reducePlaybackSession(
  state: PlaybackSessionState,
  event: PlaybackSessionEvent
): PlaybackSessionResult {
  switch (event.type) {
    case 'sources.loaded': {
      const contentKey =
        event.contentKey !== undefined ? event.contentKey : state.contentKey;
      const titleChanged =
        contentKey != null &&
        state.contentKey != null &&
        contentKey !== state.contentKey;
      const episodeChanged =
        event.currentEpisodeIndex !== state.currentEpisodeIndex;

      let scoped = state;
      if (titleChanged) {
        scoped = switchTitleScope(state, contentKey, event.currentEpisodeIndex);
      } else if (episodeChanged) {
        scoped = switchEpisodeScope(state, event.currentEpisodeIndex);
      } else if (contentKey !== state.contentKey) {
        scoped = {
          ...state,
          contentKey,
          badPoints: loadBadPointsForScope(
            state.badPointsByScope,
            contentKey,
            event.currentEpisodeIndex
          ),
        };
      }

      return {
        state: {
          ...scoped,
          sources: event.sources,
          currentSourceKey: event.currentSourceKey,
          currentEpisodeIndex: event.currentEpisodeIndex,
          contentKey,
          sourceStatuses: event.sourceStatuses || new Map(),
          sourceScores: event.sourceScores || new Map(),
          measuredVideoInfo: event.measuredVideoInfo || new Map(),
          recoveredSourceKeys:
            event.recoveredSourceKeys || scoped.recoveredSourceKeys,
        },
        effects: [],
      };
    }

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
          seekSettledAtMs: resumeIntent === 'seek-settled' ? event.nowMs : null,
        },
        effects: [],
      };
    }

    case 'user.switchSource':
      return withIntentTransition(
        state,
        {
          ...clearStallEpisode(state),
          playbackIntent: 'playing',
          resumeIntentAfterSeek: null,
          currentSourceKey: event.sourceKey,
          seekSettledAtMs: null,
          sourceSwitchSettledUntilMs:
            event.nowMs + DEFAULT_SOURCE_SWITCH_SETTLE_MS,
          recoveryInFlight: state.recoveryResumeTime != null ? 'resume' : null,
        },
        'user-switch'
      );

    case 'user.switchEpisode': {
      if (event.episodeIndex === state.currentEpisodeIndex) {
        return withIntentTransition(
          state,
          {
            ...state,
            playbackIntent: 'playing',
            resumeIntentAfterSeek: null,
            seekSettledAtMs: null,
            sourceSwitchSettledUntilMs:
              event.nowMs + DEFAULT_SOURCE_SWITCH_SETTLE_MS,
          },
          'user-switch'
        );
      }

      const previousEpisodeIndex = state.currentEpisodeIndex;
      const switched = withIntentTransition(
        state,
        {
          ...switchEpisodeScope(state, event.episodeIndex),
          playbackIntent: 'playing',
          resumeIntentAfterSeek: null,
          seekSettledAtMs: null,
          sourceSwitchSettledUntilMs:
            event.nowMs + DEFAULT_SOURCE_SWITCH_SETTLE_MS,
        },
        'user-switch'
      );

      return {
        state: switched.state,
        effects: [
          {
            type: 'saveProgress',
            reason: 'episode-change',
            episodeIndex: previousEpisodeIndex,
          },
          ...switched.effects,
        ],
      };
    }

    case 'video.ended': {
      if (event.nextEpisodeIndex === state.currentEpisodeIndex) {
        return { state, effects: [] };
      }

      const previousEpisodeIndex = state.currentEpisodeIndex;
      const switched = withIntentTransition(
        state,
        {
          ...switchEpisodeScope(state, event.nextEpisodeIndex),
          playbackIntent: 'playing',
          resumeIntentAfterSeek: null,
          seekSettledAtMs: null,
          sourceSwitchSettledUntilMs:
            event.nowMs + DEFAULT_SOURCE_SWITCH_SETTLE_MS,
        },
        'user-switch'
      );

      return {
        state: switched.state,
        effects: [
          {
            type: 'saveProgress',
            reason: 'episode-ended',
            episodeIndex: previousEpisodeIndex,
            completed: true,
          },
          ...switched.effects,
        ],
      };
    }

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
          recoveryInFlight:
            state.recoveryResumeTime != null
              ? 'resume'
              : state.recoveryInFlight,
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
          recoveryInFlight:
            state.recoveryInFlight === 'R3' ? 'resume' : state.recoveryInFlight,
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
          recoveryInFlight: null,
          recoveryStage:
            state.recoveryStage === 'R3' ? 'idle' : state.recoveryStage,
        },
        effects: [],
      };
    }

    case 'recovery.cancel': {
      const cancelled = cancelInFlightAdSkip(
        cancelRecoveryEpisode(state),
        'recovery-in-flight'
      );
      return {
        state: {
          ...cancelled.state,
          // Explicit: bad points survive cancel.
          badPoints: state.badPoints,
          badPointsByScope: state.badPointsByScope,
        },
        effects: cancelled.effects,
      };
    }

    case 'recovery.progressHealthy': {
      if (!state.stallEpisodeActive && state.recoveryStage === 'idle') {
        return { state, effects: [] };
      }
      return {
        state: clearStallEpisode(
          setRecoveryResumeTime(
            {
              ...state,
              recoveryInFlight:
                state.recoveryInFlight === 'resume'
                  ? state.recoveryInFlight
                  : null,
            },
            state.recoveryInFlight === 'resume'
              ? state.recoveryResumeTime
              : null
          )
        ),
        effects: [
          {
            type: 'emitDebugEvent',
            eventType: 'recovery.stall-episode.ended',
            message: 'Healthy progress ended stall episode',
            details: { previousStage: state.recoveryStage },
          },
        ],
      };
    }

    case 'recovery.effectSettled': {
      if (event.kind === 'resume') {
        return {
          state: {
            ...setRecoveryResumeTime(state, null),
            recoveryInFlight: null,
          },
          effects: [],
        };
      }

      if (
        state.recoveryInFlight !== event.kind &&
        state.recoveryInFlight !== null
      ) {
        return { state, effects: [] };
      }

      return {
        state: {
          ...state,
          // After R2 escape seek, treat resume as pending until settle.
          recoveryInFlight:
            event.kind === 'R2' && state.recoveryResumeTime != null
              ? 'resume'
              : null,
        },
        effects: [],
      };
    }

    case 'recovery.runtimeEvidence':
      return handleStallCandidate(state, event.snapshot, event.nowMs, {
        evidence: event.evidence,
        hardFailure: Boolean(
          event.evidence.hardFailure ||
            event.evidence.native?.severity === 'source-failed' ||
            event.evidence.hls?.fatal
        ),
        r3Reason: 'auto-recovery',
      });

    case 'video.timeupdate': {
      if (!allowsAutomaticEffect(state, 'ad-skip', event.nowMs)) {
        return { state, effects: [] };
      }

      if (isRecoveryInFlightBlockingAdSkip(state)) {
        return { state, effects: [] };
      }

      if (isResumePendingBlockingAdSkip(state)) {
        return { state, effects: [] };
      }

      // Resume planned but not yet settled (pending apply).
      if (
        state.recoveryResumeTime != null &&
        (state.recoveryInFlight === 'resume' ||
          state.recoveryInFlight === 'R3' ||
          state.recoveryStage === 'R3')
      ) {
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
      return handleStallCandidate(state, event.snapshot, event.nowMs, {
        hardFailure: false,
        r3Reason: 'auto-recovery',
      });

    case 'video.error':
      return handleStallCandidate(state, event.snapshot, event.nowMs, {
        hardFailure: true,
        evidence: {
          platform: 'hlsjs',
          hardFailure: true,
          stallCandidate: true,
        },
        r3Reason: 'auto-recovery',
      });

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

      return handleStallCandidate(
        {
          ...state,
          sourceChangeInFlight: false,
          sourceChangeSourceKey: null,
        },
        event.snapshot,
        event.nowMs,
        {
          hardFailure: true,
          forceR3Evaluation: true,
          r3Reason: 'source-timeout',
        }
      );
  }
}
