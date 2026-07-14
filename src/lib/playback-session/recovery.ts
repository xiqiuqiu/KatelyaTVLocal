import {
  findNearbyPlaybackBadPoint,
  planStallEscapeResume,
  rememberPlaybackBadPoint,
} from '@/lib/playback-stuck-escape';

import type {
  PlaybackRecoveryStage,
  PlaybackSessionEffect,
  PlaybackSessionState,
  RecoveryInFlightKind,
  RecoveryRuntimeEvidence,
  SameSourceRecoverAction,
  VideoSnapshot,
} from './types';

/** R0 soft observe window (~2–3s per #18). */
export const RECOVERY_R0_SOFT_OBSERVE_MS = 2500;
/** R1 attempts per Stall Episode / episode. */
export const RECOVERY_R1_MAX_ATTEMPTS = 3;
/** R2 escape attempts before evaluating R3. */
export const RECOVERY_R2_MAX_ATTEMPTS = 3;

export function badPointScopeKey(
  contentKey: string | null,
  episodeIndex: number
): string | null {
  if (!contentKey) {
    return null;
  }
  return `${contentKey}::${episodeIndex}`;
}

export function loadBadPointsForScope(
  badPointsByScope: Map<string, PlaybackSessionState['badPoints']>,
  contentKey: string | null,
  episodeIndex: number
): PlaybackSessionState['badPoints'] {
  const key = badPointScopeKey(contentKey, episodeIndex);
  if (!key) {
    return [];
  }
  return badPointsByScope.get(key) || [];
}

export function persistBadPointsForScope(
  badPointsByScope: Map<string, PlaybackSessionState['badPoints']>,
  contentKey: string | null,
  episodeIndex: number,
  badPoints: PlaybackSessionState['badPoints']
): Map<string, PlaybackSessionState['badPoints']> {
  const key = badPointScopeKey(contentKey, episodeIndex);
  if (!key) {
    return badPointsByScope;
  }
  const next = new Map(badPointsByScope);
  next.set(key, badPoints);
  return next;
}

export function isRecoveryInFlightBlockingAdSkip(
  state: PlaybackSessionState
): boolean {
  return (
    state.recoveryInFlight === 'R1' ||
    state.recoveryInFlight === 'R2' ||
    state.recoveryInFlight === 'R3' ||
    state.recoveryInFlight === 'resume'
  );
}

export function isResumePendingBlockingAdSkip(
  state: PlaybackSessionState
): boolean {
  return (
    state.recoveryResumeTime != null && state.recoveryInFlight === 'resume'
  );
}

export function clearStallEpisode(
  state: PlaybackSessionState
): PlaybackSessionState {
  return {
    ...state,
    recoveryStage: 'idle',
    stallEpisodeActive: false,
    r0EnteredAtMs: null,
    r1AttemptCount: 0,
    r2AttemptCount: 0,
    recoveryInFlight: null,
  };
}

export function cancelRecoveryEpisode(
  state: PlaybackSessionState
): PlaybackSessionState {
  // Cancel clears R counters / in-flight / stall episode — never erases bad points.
  return {
    ...clearStallEpisode(state),
    // Keep recoveryResumeTime if already planned? Spec: cancel aborts in-flight
    // S2/S3; planned resume for a cancelled switch should clear.
    recoveryResumeTime:
      state.recoveryInFlight === 'R3' ? null : state.recoveryResumeTime,
    pendingResumeTime:
      state.recoveryInFlight === 'R3' ? null : state.pendingResumeTime,
  };
}

function setResumeTime(
  state: PlaybackSessionState,
  resumeTime: number | null
): PlaybackSessionState {
  return {
    ...state,
    recoveryResumeTime: resumeTime,
    pendingResumeTime: resumeTime,
  };
}

function withStage(
  state: PlaybackSessionState,
  stage: PlaybackRecoveryStage,
  inFlight: RecoveryInFlightKind = state.recoveryInFlight
): PlaybackSessionState {
  return {
    ...state,
    recoveryStage: stage,
    stallEpisodeActive: stage !== 'idle' && stage !== 'exhausted',
    recoveryInFlight: inFlight,
  };
}

export interface RecoveryLadderResult {
  state: PlaybackSessionState;
  effects: PlaybackSessionEffect[];
}

function pickR1Action(
  evidence: RecoveryRuntimeEvidence | null,
  attempt: number
): SameSourceRecoverAction {
  if (evidence?.platform === 'apple-native') {
    return 'resume-playback';
  }
  if (attempt <= 1) {
    return 'nudge-playback';
  }
  if (attempt === 2) {
    return 'restart-load';
  }
  return 'recover-media';
}

function shouldAccelerateToR3(
  evidence: RecoveryRuntimeEvidence | null,
  hardFailure: boolean
): boolean {
  if (hardFailure) {
    return true;
  }
  if (!evidence) {
    return false;
  }
  if (evidence.hardFailure) {
    return true;
  }
  if (evidence.native?.severity === 'source-failed') {
    return true;
  }
  if (evidence.native?.severity === 'hard-stall') {
    return true;
  }
  if (evidence.hls?.fatal) {
    return true;
  }
  return false;
}

function shouldPreferR2FromJitter(
  evidence: RecoveryRuntimeEvidence | null
): boolean {
  return Boolean(
    evidence?.native?.isJitter && (evidence.native.jitterWindowCount ?? 0) >= 2
  );
}

function planR2Escape(
  state: PlaybackSessionState,
  snapshot: VideoSnapshot,
  nowMs: number
): {
  state: PlaybackSessionState;
  targetTime: number;
  badPoints: PlaybackSessionState['badPoints'];
} | null {
  const escape = planStallEscapeResume({
    currentPlayTime: snapshot.currentTime,
    badPoints: state.badPoints,
    sourceKey: state.currentSourceKey,
    mode: 'same-source',
  });
  if (escape.resumeTime == null || escape.action === 'none') {
    return null;
  }

  const badPoints =
    escape.recordBadPointAt != null
      ? rememberPlaybackBadPoint(state.badPoints, {
          sourceKey: state.currentSourceKey,
          timeSeconds: escape.recordBadPointAt,
          nowMs,
        })
      : state.badPoints;

  return {
    state: setResumeTime(
      {
        ...state,
        badPoints,
        badPointsByScope: persistBadPointsForScope(
          state.badPointsByScope,
          state.contentKey,
          state.currentEpisodeIndex,
          badPoints
        ),
      },
      escape.resumeTime
    ),
    targetTime: escape.resumeTime,
    badPoints,
  };
}

function isPlayheadInKnownFault(
  state: PlaybackSessionState,
  snapshot: VideoSnapshot
): boolean {
  return Boolean(
    findNearbyPlaybackBadPoint(state.badPoints, {
      timeSeconds: snapshot.currentTime,
      sourceKey: state.currentSourceKey,
      mode: 'same-source',
    })
  );
}

/**
 * Advance the shared R0–R3 ladder from a stall candidate / runtime evidence.
 * Adapters feed summaries only; this owns escalation.
 */
export function advanceRecoveryLadder(
  state: PlaybackSessionState,
  input: {
    snapshot: VideoSnapshot;
    nowMs: number;
    evidence?: RecoveryRuntimeEvidence | null;
    hardFailure?: boolean;
    /** When true, evaluate R3 directly after Intent (source timeout path). */
    forceR3Evaluation?: boolean;
  }
): RecoveryLadderResult {
  const evidence = input.evidence || null;
  const hardFailure = Boolean(input.hardFailure || evidence?.hardFailure);
  const accelerate = shouldAccelerateToR3(evidence, hardFailure);
  const preferR2 = shouldPreferR2FromJitter(evidence);

  // Enter / keep Stall Episode at R0 when Intent-eligible stall arrives.
  if (!state.stallEpisodeActive || state.recoveryStage === 'idle') {
    const next: PlaybackSessionState = {
      ...state,
      recoveryStage: 'R0',
      stallEpisodeActive: true,
      r0EnteredAtMs: input.nowMs,
      r1AttemptCount: 0,
      r2AttemptCount: 0,
      recoveryInFlight: null,
    };

    if (!accelerate && !input.forceR3Evaluation && !preferR2) {
      return {
        state: next,
        effects: [
          {
            type: 'emitDebugEvent',
            eventType: 'recovery.stage.entered',
            message: 'Entered R0 observe',
            details: { stage: 'R0' },
          },
        ],
      };
    }

    // Hard failure / jitter preference continues from R0 on same tick.
    return advanceFromR0(
      next,
      input.snapshot,
      input.nowMs,
      evidence,
      accelerate,
      preferR2,
      input.forceR3Evaluation
    );
  }

  if (state.recoveryInFlight === 'R1' || state.recoveryInFlight === 'R2') {
    // Wait for effectSettled before escalating further.
    return { state, effects: [] };
  }

  if (state.recoveryInFlight === 'R3' || state.recoveryInFlight === 'resume') {
    return { state, effects: [] };
  }

  if (state.recoveryStage === 'exhausted') {
    return { state, effects: [] };
  }

  if (state.recoveryStage === 'R0') {
    return advanceFromR0(
      state,
      input.snapshot,
      input.nowMs,
      evidence,
      accelerate,
      preferR2,
      input.forceR3Evaluation
    );
  }

  if (state.recoveryStage === 'R1') {
    return advanceFromR1(
      state,
      input.snapshot,
      input.nowMs,
      evidence,
      accelerate,
      preferR2
    );
  }

  if (state.recoveryStage === 'R2') {
    return advanceFromR2(
      state,
      input.snapshot,
      input.nowMs,
      accelerate || Boolean(input.forceR3Evaluation)
    );
  }

  return { state, effects: [] };
}

function advanceFromR0(
  state: PlaybackSessionState,
  snapshot: VideoSnapshot,
  nowMs: number,
  evidence: RecoveryRuntimeEvidence | null,
  accelerate: boolean,
  preferR2: boolean,
  forceR3?: boolean
): RecoveryLadderResult {
  const elapsed = state.r0EnteredAtMs != null ? nowMs - state.r0EnteredAtMs : 0;
  const observeDone =
    accelerate || forceR3 || preferR2 || elapsed >= RECOVERY_R0_SOFT_OBSERVE_MS;

  if (!observeDone) {
    return { state, effects: [] };
  }

  if (
    forceR3 ||
    (accelerate && state.r1AttemptCount >= RECOVERY_R1_MAX_ATTEMPTS)
  ) {
    return { state, effects: [] }; // caller handles R3 via Intent + Availability
  }

  // Prefer R2 when jitter strengthens escape, or playhead already in fault band.
  if (
    preferR2 ||
    isPlayheadInKnownFault(state, snapshot) ||
    (accelerate && !forceR3)
  ) {
    // Hard failure shortens R0/R1: try R2 once then let caller escalate R3.
    if (accelerate && !preferR2 && !isPlayheadInKnownFault(state, snapshot)) {
      // Skip soft R1 catalog — go evaluate R3 at caller.
      return {
        state: withStage(state, 'R2', null),
        effects: [
          {
            type: 'emitDebugEvent',
            eventType: 'recovery.stage.entered',
            message: 'Hard failure shortened to R2 boundary',
            details: { stage: 'R2', accelerate: true },
          },
        ],
      };
    }
    return emitR2(state, snapshot, nowMs, 'r0-to-r2');
  }

  return emitR1(state, snapshot, evidence, 'r0-observe-elapsed');
}

function advanceFromR1(
  state: PlaybackSessionState,
  snapshot: VideoSnapshot,
  nowMs: number,
  evidence: RecoveryRuntimeEvidence | null,
  accelerate: boolean,
  preferR2: boolean
): RecoveryLadderResult {
  if (
    preferR2 ||
    isPlayheadInKnownFault(state, snapshot) ||
    state.r1AttemptCount >= RECOVERY_R1_MAX_ATTEMPTS ||
    accelerate
  ) {
    return emitR2(state, snapshot, nowMs, 'r1-exhausted-or-fault');
  }

  return emitR1(state, snapshot, evidence, 'r1-retry');
}

function advanceFromR2(
  state: PlaybackSessionState,
  snapshot: VideoSnapshot,
  nowMs: number,
  accelerate: boolean
): RecoveryLadderResult {
  if (state.r2AttemptCount >= RECOVERY_R2_MAX_ATTEMPTS || accelerate) {
    // Signal exhaustion of same-source — caller evaluates R3.
    return {
      state: withStage(state, 'R2', null),
      effects: [
        {
          type: 'emitDebugEvent',
          eventType: 'recovery.stage.exhausted-same-source',
          message: 'Same-source recovery exhausted; evaluate R3',
          details: {
            r1AttemptCount: state.r1AttemptCount,
            r2AttemptCount: state.r2AttemptCount,
          },
        },
      ],
    };
  }

  return emitR2(state, snapshot, nowMs, 'r2-retry');
}

function emitR1(
  state: PlaybackSessionState,
  snapshot: VideoSnapshot,
  evidence: RecoveryRuntimeEvidence | null,
  reason: string
): RecoveryLadderResult {
  const attempt = state.r1AttemptCount + 1;
  const action = pickR1Action(evidence, attempt);
  const nudge = planStallEscapeResume({
    currentPlayTime: snapshot.currentTime,
    badPoints: state.badPoints,
    sourceKey: state.currentSourceKey,
    mode: 'same-source',
    preferExistingWithoutRewind: action !== 'nudge-playback',
  });

  return {
    state: withStage(
      {
        ...state,
        r1AttemptCount: attempt,
      },
      'R1',
      'R1'
    ),
    effects: [
      {
        type: 'sameSourceRecover',
        stage: 'R1',
        action,
        targetTime: action === 'nudge-playback' ? nudge.resumeTime : null,
        reason,
      },
    ],
  };
}

function emitR2(
  state: PlaybackSessionState,
  snapshot: VideoSnapshot,
  nowMs: number,
  reason: string
): RecoveryLadderResult {
  const planned = planR2Escape(state, snapshot, nowMs);
  if (!planned) {
    return {
      state: withStage(
        {
          ...state,
          r2AttemptCount: state.r2AttemptCount + 1,
        },
        'R2',
        null
      ),
      effects: [
        {
          type: 'emitDebugEvent',
          eventType: 'recovery.stage.exhausted-same-source',
          message: 'R2 escape unavailable; evaluate R3',
          details: { reason },
        },
      ],
    };
  }

  const attempt = state.r2AttemptCount + 1;
  return {
    state: withStage(
      {
        ...planned.state,
        r2AttemptCount: attempt,
      },
      'R2',
      'R2'
    ),
    effects: [
      {
        type: 'sameSourceRecover',
        stage: 'R2',
        action: 'escape-bad-point',
        targetTime: planned.targetTime,
        reason,
      },
    ],
  };
}

export function shouldEvaluateR3AfterLadder(
  result: RecoveryLadderResult,
  input: { hardFailure?: boolean; forceR3Evaluation?: boolean }
): boolean {
  if (input.forceR3Evaluation || input.hardFailure) {
    return true;
  }

  const exhaustedSameSource = result.effects.some(
    (effect) =>
      effect.type === 'emitDebugEvent' &&
      effect.eventType === 'recovery.stage.exhausted-same-source'
  );
  if (exhaustedSameSource) {
    return true;
  }

  if (
    result.state.recoveryStage === 'R2' &&
    result.state.recoveryInFlight == null &&
    result.state.r2AttemptCount >= RECOVERY_R2_MAX_ATTEMPTS
  ) {
    return true;
  }

  return false;
}
