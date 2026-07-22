import {
  getEffectiveAdWindowTrustTier,
  getHlsAdSkipDecision,
  getHlsAdSkipWindowKey,
} from '@/lib/hls-ad-skip';
import {
  getAutoRecoveryResumePlan,
  shouldIgnoreSourceChangeTimeout,
} from '@/lib/playback-source-switch';
import { rememberPlaybackBadPoint } from '@/lib/playback-stuck-escape';
import { selectRecoveryCandidate } from '@/lib/source-availability/index';
import type { SourceSelectionScore } from '@/lib/source-selection';
import type { SearchResult } from '@/lib/types';

import { allowsAutomaticEffect, getAutomaticEffectGate } from './intent';
import {
  advanceRecoveryLadder,
  applyHealthyProgress,
  breakHealthyProgressContinuity,
  cancelRecoveryEpisode,
  clearStallEpisode,
  endStallEpisodePreservingBudget,
  isHlsSustainedSoftStall,
  isRecoveryInFlightBlockingAdSkip,
  isResumePendingBlockingAdSkip,
  loadBadPointsForScope,
  persistBadPointsForScope,
  resetEscapeBudget,
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
const AD_SKIP_UNDO_DISMISS_MS = 5000;

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
    suppressedAdSkipWindowKeys: new Set(),
    recoverableAdSkip: null,
    recoveryStage: 'idle',
    stallEpisodeActive: false,
    r0EnteredAtMs: null,
    r1AttemptCount: 0,
    r2AttemptCount: 0,
    recoveryInFlight: null,
    healthyProgressAnchorMs: null,
    healthyProgressAnchorTime: null,
    escapeForwardSpanSeconds: 0,
    escapeCount: 0,
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

function shouldAllowUnverifiedRecoveryFallback(
  reason: 'auto-recovery' | 'source-timeout',
  snapshot: VideoSnapshot
): boolean {
  // Startup hang: progressive probe never starts without stable playback, so
  // requiring direct/playable evidence leaves the user stuck on a dead source.
  if (reason === 'source-timeout') {
    return true;
  }
  return (snapshot.currentTime || 0) < 1;
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
    allowUnverifiedFallback: shouldAllowUnverifiedRecoveryFallback(
      reason,
      snapshot
    ),
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
  // A stall breaks any continuous healthy run.
  state = breakHealthyProgressContinuity(state);

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
    const denied =
      getAutomaticEffectGate(state, 'same-source-recovery', nowMs).deniedBy ||
      getAutomaticEffectGate(state, 'auto-source-switch', nowMs).deniedBy ||
      'user-paused';
    return {
      state,
      effects: [
        {
          type: 'emitDebugEvent',
          eventType: 'intent.gate.denied',
          message: 'Automatic effect gated by Playback Intent',
          details: {
            deniedBy: denied,
            kind: 'same-source-recovery',
          },
        },
      ],
    };
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

  // Post-seek grace: the user just chose this position, so do not immediately
  // skip forward off a pre-existing Bad Point — buffer + reload in place first.
  const suppressSkipForward =
    state.playbackIntent === 'seek-settled' &&
    state.seekSettledAtMs != null &&
    nowMs - state.seekSettledAtMs >= 0 &&
    nowMs - state.seekSettledAtMs < state.seekSettledLongGuardMs;

  const ladder = advanceRecoveryLadder(state, {
    snapshot,
    nowMs,
    evidence: options.evidence,
    hardFailure: options.hardFailure,
    forceR3Evaluation: options.forceR3Evaluation,
    suppressSkipForward,
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
      {
        type: 'emitDebugEvent',
        eventType: 'adSkip.cancelled',
        message: 'Ad skip cancelled',
        details: { windowKey, reason },
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

      // A new source (e.g. an auto-recovery switch, which does not dispatch
      // user.switchSource) starts on a fresh timeline: forget the carried
      // escape budget so the new source is not immediately R3-capped.
      const sourceChanged =
        event.currentSourceKey !== state.currentSourceKey;
      const rebased =
        sourceChanged && !titleChanged && !episodeChanged
          ? resetEscapeBudget(scoped)
          : scoped;

      return {
        state: {
          ...rebased,
          sources: event.sources,
          currentSourceKey: event.currentSourceKey,
          currentEpisodeIndex: event.currentEpisodeIndex,
          contentKey,
          sourceStatuses: event.sourceStatuses || new Map(),
          sourceScores: event.sourceScores || new Map(),
          measuredVideoInfo: event.measuredVideoInfo || new Map(),
          recoveredSourceKeys:
            event.recoveredSourceKeys || rebased.recoveredSourceKeys,
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

    case 'user.seekStarted': {
      // Ambiguous browser seeking (iOS buffer gaps) must not stamp Intent or
      // wipe the escape budget — that re-opened +20s ratchet windows in prod.
      if (event.confirmedUserGesture === false) {
        return {
          state,
          effects: [
            {
              type: 'emitDebugEvent',
              eventType: 'intent.seek.ignored',
              message: 'Ignored unconfirmed seeking (ambiguous browser event)',
              details: {
                escapeCount: state.escapeCount,
                stallEpisodeActive: state.stallEpisodeActive,
                recoveryInFlight: state.recoveryInFlight,
              },
            },
          ],
        };
      }

      // Race: automatic R1/R2/resume seeks can emit browser seeking before the
      // adapter marks systemSeekInFlight. Never treat that as a user scrub.
      if (
        state.recoveryInFlight === 'R1' ||
        state.recoveryInFlight === 'R2' ||
        state.recoveryInFlight === 'R3' ||
        state.recoveryInFlight === 'resume'
      ) {
        return {
          state,
          effects: [
            {
              type: 'emitDebugEvent',
              eventType: 'intent.seek.ignored',
              message: 'Ignored seeking during automatic recovery',
              details: { recoveryInFlight: state.recoveryInFlight },
            },
          ],
        };
      }

      // The user took control: forget the escape budget so their chosen
      // position starts fresh (no carried-over ratchet).
      return withIntentTransition(
        state,
        {
          ...resetEscapeBudget(state),
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
    }

    case 'user.seekSettled': {
      // Only a confirmed user seek (Intent === seeking) may settle into the
      // seek-settled guard. iOS ambiguous seeking is ignored on seekStarted but
      // still fires seeked — stamping seek-settled there blocked same-source
      // recovery in prod 209f363a while playIntent stayed "playing".
      if (state.playbackIntent !== 'seeking') {
        return {
          state,
          effects: [
            {
              type: 'emitDebugEvent',
              eventType: 'intent.seek.ignored',
              message: 'Ignored seekSettled without an active user seek',
              details: {
                playbackIntent: state.playbackIntent,
                escapeCount: state.escapeCount,
              },
            },
          ],
        };
      }

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

    case 'adSkipWindows.loaded': {
      const loadedWindows = event.windows.map((window) => {
        const origin = window.origin ?? ('analyzer' as const);
        // Prefer explicit tier; else resolve from persisted confirmation counts.
        const trustTier = getEffectiveAdWindowTrustTier(window);
        return { ...window, origin, trustTier };
      });
      // Timeline range identity — not ruleId — so persisted/user-mark
      // windows do not duplicate analyzer seeds for the same interval.
      const loadedRangeKeys = new Set(
        loadedWindows.map(
          (window) =>
            `${window.startTimeSeconds.toFixed(3)}-${window.endTimeSeconds.toFixed(3)}`
        )
      );
      const preservedSessionWindows = state.adSkipWindows.filter(
        (window) =>
          (window.origin === 'user-mark' || window.origin === 'persisted') &&
          !loadedRangeKeys.has(
            `${window.startTimeSeconds.toFixed(3)}-${window.endTimeSeconds.toFixed(3)}`
          )
      );
      const mergedWindows = [...loadedWindows, ...preservedSessionWindows];

      return {
        state: {
          ...state,
          adSkipWindows: mergedWindows,
          lastAdSkipWindowKey: null,
          adSkipInFlightWindowKey: null,
          suppressedAdSkipWindowKeys: new Set(),
          recoverableAdSkip: null,
        },
        effects: [
          {
            type: 'emitDebugEvent',
            eventType: 'adSkip.loaded',
            message: 'Ad skip windows loaded',
            details: {
              windowCount: mergedWindows.length,
              loadedWindowCount: loadedWindows.length,
              preservedSessionWindowCount: preservedSessionWindows.length,
              observeCount: mergedWindows.filter(
                (window) => getEffectiveAdWindowTrustTier(window) === 'observe'
              ).length,
              recoverableCount: mergedWindows.filter(
                (window) =>
                  getEffectiveAdWindowTrustTier(window) === 'recoverable'
              ).length,
              silentCount: mergedWindows.filter(
                (window) => getEffectiveAdWindowTrustTier(window) === 'silent'
              ).length,
            },
          },
        ],
      };
    }

    case 'user.markAdSkip': {
      const markedWindow = {
        ...event.window,
        origin: event.window.origin ?? ('user-mark' as const),
      };
      const windowKey = getHlsAdSkipWindowKey(markedWindow);
      const existingIndex = state.adSkipWindows.findIndex(
        (window) => getHlsAdSkipWindowKey(window) === windowKey
      );
      const adSkipWindows =
        existingIndex >= 0
          ? state.adSkipWindows.map((window, index) =>
              index === existingIndex ? markedWindow : window
            )
          : [...state.adSkipWindows, markedWindow];

      const decision = getHlsAdSkipDecision({
        currentTimeSeconds: markedWindow.startTimeSeconds,
        windows: [markedWindow],
        nowMs: event.nowMs,
      });
      const targetTime =
        decision.targetTimeSeconds ?? markedWindow.endTimeSeconds + 0.35;
      const restoreTimeSeconds = markedWindow.startTimeSeconds;
      const suppressedAdSkipWindowKeys = new Set(
        state.suppressedAdSkipWindowKeys
      );
      suppressedAdSkipWindowKeys.delete(windowKey);

      return {
        state: {
          ...state,
          adSkipWindows,
          lastAdSkipWindowKey: windowKey,
          adSkipInFlightWindowKey: windowKey,
          recoverableAdSkip: {
            windowKey,
            restoreTimeSeconds,
            skippedAtMs: event.nowMs,
          },
          suppressedAdSkipWindowKeys,
        },
        effects: [
          {
            type: 'skipAdWindow',
            targetTime,
            windowKey,
            reason: 'hls-ad-window',
            platform: event.platform || 'hlsjs',
          },
          {
            type: 'showAdSkipUndo',
            windowKey,
            restoreTimeSeconds,
            dismissAfterMs: AD_SKIP_UNDO_DISMISS_MS,
          },
          {
            type: 'emitDebugEvent',
            eventType: 'adSkip.marked',
            message: 'User marked ad skip window',
            details: {
              windowKey,
              startTimeSeconds: markedWindow.startTimeSeconds,
              endTimeSeconds: markedWindow.endTimeSeconds,
              targetTime,
              confirmation: 'mark',
            },
          },
        ],
      };
    }

    case 'user.undoAdSkip': {
      const pending = state.recoverableAdSkip;
      if (!pending || pending.windowKey !== event.windowKey) {
        return { state, effects: [] };
      }

      const suppressedAdSkipWindowKeys = new Set(
        state.suppressedAdSkipWindowKeys
      );
      suppressedAdSkipWindowKeys.add(event.windowKey);

      return {
        state: {
          ...state,
          recoverableAdSkip: null,
          adSkipInFlightWindowKey: null,
          // Keep already-skipped distinct: clear so suppress owns re-entry.
          lastAdSkipWindowKey:
            state.lastAdSkipWindowKey === event.windowKey
              ? null
              : state.lastAdSkipWindowKey,
          suppressedAdSkipWindowKeys,
          lastUserSeekAtMs: event.nowMs,
        },
        effects: [
          {
            type: 'restoreAdSkipWindow',
            targetTime: pending.restoreTimeSeconds,
            windowKey: event.windowKey,
          },
          {
            type: 'emitDebugEvent',
            eventType: 'adSkip.undone',
            message: 'Ad skip undone (wrong window)',
            details: {
              windowKey: event.windowKey,
              restoreTimeSeconds: pending.restoreTimeSeconds,
              confirmation: 'wrong',
            },
          },
        ],
      };
    }

    case 'adSkipUndo.dismissed': {
      if (state.recoverableAdSkip?.windowKey !== event.windowKey) {
        return { state, effects: [] };
      }
      return {
        state: {
          ...state,
          recoverableAdSkip: null,
        },
        effects: [],
      };
    }

    case 'progressSave.requested':
      return {
        state,
        effects: [
          { type: 'saveProgress', reason: event.reason },
          {
            type: 'emitDebugEvent',
            eventType: 'progressSave.requested',
            message: 'Progress save requested',
            details: { reason: event.reason },
          },
        ],
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
        effects: [
          {
            type: 'emitDebugEvent',
            eventType: 'sourceChange.completed',
            message: 'Source change completed',
            details: { attemptId: event.attemptId },
          },
        ],
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
      // Keep folding healthy ticks while a Stall Episode is active OR while an
      // escape budget is still charged — the latter lets a genuinely long
      // healthy run clear the carried budget after the episode already ended.
      if (
        !state.stallEpisodeActive &&
        state.recoveryStage === 'idle' &&
        state.escapeCount === 0 &&
        state.escapeForwardSpanSeconds === 0
      ) {
        return { state, effects: [] };
      }

      // A Stall Episode ends only on *sustained* healthy progress. A brief
      // post-escape blip merely records the healthy anchor and keeps the
      // R1/R2 escalation budget, so a stuttering source cannot loop
      // same-source recovery forever (and skip-forward to the end).
      const healthy = applyHealthyProgress(
        state,
        event.snapshot.currentTime,
        event.nowMs
      );

      if (!healthy.episodeEnded) {
        return { state: healthy.state, effects: [] };
      }

      // Episode was already idle (only kept alive to decay the escape budget):
      // just return the budget-adjusted state, no episode-ended effect.
      if (!state.stallEpisodeActive && state.recoveryStage === 'idle') {
        return { state: healthy.state, effects: [] };
      }

      // A short healthy beat ends the episode but PRESERVES the escape budget
      // (cross-episode ratchet guard); a long run already cleared it above via
      // applyHealthyProgress → resetEscapeBudget.
      return {
        state: endStallEpisodePreservingBudget(
          setRecoveryResumeTime(
            {
              ...healthy.state,
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
            message: 'Sustained healthy progress ended stall episode',
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

      // R2 escape seek is already applied by the adapter before settle.
      // Parking on 'resume' required a second seeked that never comes and
      // blocked the soft-stall ladder from reaching R3.
      if (event.kind === 'R2') {
        return {
          state: {
            ...setRecoveryResumeTime(state, null),
            recoveryInFlight: null,
          },
          effects: [],
        };
      }

      return {
        state: {
          ...state,
          recoveryInFlight: null,
        },
        effects: [],
      };
    }

    case 'recovery.runtimeEvidence': {
      const sustainedSoftStall = isHlsSustainedSoftStall(event.evidence);
      return handleStallCandidate(state, event.snapshot, event.nowMs, {
        evidence: event.evidence,
        hardFailure: Boolean(
          event.evidence.hardFailure ||
            event.evidence.native?.severity === 'source-failed' ||
            event.evidence.hls?.fatal ||
            sustainedSoftStall
        ),
        r3Reason: 'auto-recovery',
      });
    }
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

      const matchedWindow = decision.window;
      if (!matchedWindow) {
        return { state, effects: [] };
      }

      const windowKey = getHlsAdSkipWindowKey(matchedWindow);
      if (state.suppressedAdSkipWindowKeys.has(windowKey)) {
        return { state, effects: [] };
      }

      const restoreTimeSeconds = matchedWindow.startTimeSeconds;
      const trustTier = getEffectiveAdWindowTrustTier(matchedWindow);
      const isSilent = trustTier === 'silent';

      return {
        state: {
          ...state,
          lastAdSkipWindowKey: windowKey,
          adSkipInFlightWindowKey: windowKey,
          // Silent: no toast for this skip; keep any other window's undo state.
          recoverableAdSkip: isSilent
            ? state.recoverableAdSkip
            : {
                windowKey,
                restoreTimeSeconds,
                skippedAtMs: event.nowMs,
              },
        },
        effects: [
          {
            type: 'skipAdWindow',
            targetTime: decision.targetTimeSeconds,
            windowKey,
            reason: 'hls-ad-window',
            platform: event.platform || 'hlsjs',
          },
          ...(isSilent
            ? []
            : [
                {
                  type: 'showAdSkipUndo' as const,
                  windowKey,
                  restoreTimeSeconds,
                  dismissAfterMs: AD_SKIP_UNDO_DISMISS_MS,
                },
              ]),
          {
            type: 'emitDebugEvent',
            eventType: 'adSkip.emitted',
            message: 'Ad skip window emitted',
            details: {
              windowKey,
              targetTime: decision.targetTimeSeconds,
              restoreTimeSeconds,
              platform: event.platform || 'hlsjs',
              trustTier,
            },
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
