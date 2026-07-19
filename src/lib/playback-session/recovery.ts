import { HLS_SUSTAINED_STALL_SWITCH_THRESHOLD } from '@/lib/hls-recovery';
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

/**
 * A Stall Episode ends (and R1/R2 counters reset) only once healthy playback
 * has been *sustained* for this many seconds. A stuttering source that plays
 * for less than this between stalls keeps one Stall Episode alive, so the
 * ladder can escalate to R3 instead of looping same-source recovery forever.
 */
export const HEALTHY_SUSTAINED_SECONDS = 1.5;
/**
 * A short healthy beat (HEALTHY_SUSTAINED_SECONDS) ends the Stall Episode but
 * must NOT clear the carried escape budget: a stuttering source that recovers
 * for ~1.5s between stalls would otherwise reset the ratchet guard every cycle
 * and skip forward to the end. Only a genuinely long, continuous healthy run
 * clears the budget (the playhead is really progressing again on this source).
 */
export const ESCAPE_BUDGET_RESET_HEALTHY_SECONDS = 30;
/**
 * Playhead progress may legitimately exceed wall-clock slightly (timeupdate
 * batching). Anything beyond this is treated as an instant seek/escape jump,
 * not real playback, and does not count toward sustained recovery.
 */
export const HEALTHY_PROGRESS_JUMP_TOLERANCE_SECONDS = 2;
/** Hard cap on cumulative forward skip-forward distance before escalating. */
export const MAX_ESCAPE_FORWARD_SPAN_SECONDS = 60;
/** Hard cap on skip-forward escapes before escalating (belt-and-suspenders). */
export const MAX_ESCAPE_COUNT = 3;

export function resetEscapeBudget(
  state: PlaybackSessionState
): PlaybackSessionState {
  if (
    state.escapeForwardSpanSeconds === 0 &&
    state.escapeCount === 0 &&
    state.healthyProgressAnchorMs === null &&
    state.healthyProgressAnchorTime === null
  ) {
    return state;
  }
  return {
    ...state,
    escapeForwardSpanSeconds: 0,
    escapeCount: 0,
    healthyProgressAnchorMs: null,
    healthyProgressAnchorTime: null,
  };
}

export function breakHealthyProgressContinuity(
  state: PlaybackSessionState
): PlaybackSessionState {
  if (
    state.healthyProgressAnchorMs === null &&
    state.healthyProgressAnchorTime === null
  ) {
    return state;
  }
  return {
    ...state,
    healthyProgressAnchorMs: null,
    healthyProgressAnchorTime: null,
  };
}

export interface HealthyProgressResult {
  state: PlaybackSessionState;
  /** True when healthy playback has been sustained enough to end the episode. */
  episodeEnded: boolean;
}

/**
 * Fold a healthy-progress tick into the continuous healthy run.
 * - A long continuous run (ESCAPE_BUDGET_RESET_HEALTHY_SECONDS) ends the episode
 *   AND clears the escape budget (the source is truly progressing again).
 * - A short beat (HEALTHY_SUSTAINED_SECONDS) ends the episode but PRESERVES the
 *   escape budget + healthy anchor, so a stuttering source cannot reset the
 *   cross-episode ratchet guard every cycle and skip forward forever.
 * - A brief post-escape blip only records the anchor.
 */
export function applyHealthyProgress(
  state: PlaybackSessionState,
  currentTime: number,
  nowMs: number
): HealthyProgressResult {
  const anchorMs = state.healthyProgressAnchorMs;
  const anchorTime = state.healthyProgressAnchorTime;

  const wallElapsedSeconds =
    anchorMs != null ? (nowMs - anchorMs) / 1000 : 0;
  const advanced = anchorTime != null ? currentTime - anchorTime : 0;
  const continuous =
    anchorMs != null &&
    anchorTime != null &&
    advanced >= 0 &&
    advanced <= wallElapsedSeconds + HEALTHY_PROGRESS_JUMP_TOLERANCE_SECONDS;

  if (!continuous) {
    // Start (or restart) a fresh healthy run from here.
    return {
      state: {
        ...state,
        healthyProgressAnchorMs: nowMs,
        healthyProgressAnchorTime: currentTime,
      },
      episodeEnded: false,
    };
  }

  if (advanced >= ESCAPE_BUDGET_RESET_HEALTHY_SECONDS) {
    return {
      state: resetEscapeBudget(state),
      episodeEnded: true,
    };
  }

  if (advanced >= HEALTHY_SUSTAINED_SECONDS) {
    // End the episode, but keep the escape budget + anchor: the anchor lets a
    // longer uninterrupted run eventually clear the budget above.
    return { state, episodeEnded: true };
  }

  return { state, episodeEnded: false };
}

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
    escapeForwardSpanSeconds: 0,
    escapeCount: 0,
    healthyProgressAnchorMs: null,
    healthyProgressAnchorTime: null,
  };
}

/**
 * End the Stall Episode on a short healthy beat WITHOUT wiping the escape
 * budget or the healthy anchor. The budget must survive rapidly recurring
 * episodes (the cross-episode ratchet guard); only a genuinely long healthy run
 * (applyHealthyProgress) or a fresh start (user seek / source or episode change)
 * clears it.
 */
export function endStallEpisodePreservingBudget(
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

/** Effective HLS soft-stall intensity (matches legacy getHlsRecoveryPlan). */
export function getHlsEffectiveStallCount(
  evidence: RecoveryRuntimeEvidence | null
): number {
  if (!evidence?.hls) {
    return 0;
  }
  return Math.max(
    evidence.hls.stallCount || 0,
    evidence.hls.stallWindowCount || 0
  );
}

/**
 * Sustained non-fatal HLS stalls should escalate like legacy switch-source,
 * not sit forever in same-source R1/R2.
 */
export function isHlsSustainedSoftStall(
  evidence: RecoveryRuntimeEvidence | null
): boolean {
  return (
    getHlsEffectiveStallCount(evidence) >= HLS_SUSTAINED_STALL_SWITCH_THRESHOLD
  );
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
  if (isHlsSustainedSoftStall(evidence)) {
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
    /**
     * True during the post-seek grace: the user just chose this position, so
     * do not yank the playhead forward off a *pre-existing* Bad Point. Give
     * in-place buffering (R0 observe + R1 reload) a real chance first.
     */
    suppressSkipForward?: boolean;
  }
): RecoveryLadderResult {
  const evidence = input.evidence || null;
  const hardFailure = Boolean(input.hardFailure || evidence?.hardFailure);
  const accelerate = shouldAccelerateToR3(evidence, hardFailure);
  const preferR2 = shouldPreferR2FromJitter(evidence);
  const suppressSkipForward = Boolean(input.suppressSkipForward) && !hardFailure;

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
      input.forceR3Evaluation,
      suppressSkipForward
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
      input.forceR3Evaluation,
      suppressSkipForward
    );
  }

  if (state.recoveryStage === 'R1') {
    return advanceFromR1(
      state,
      input.snapshot,
      input.nowMs,
      evidence,
      accelerate,
      preferR2,
      suppressSkipForward
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
  forceR3?: boolean,
  suppressSkipForward?: boolean
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

  // Post-seek grace: do not jump to a forward escape off a pre-existing Bad
  // Point at the user's freshly chosen position — buffer + reload in place.
  const faultShortcut =
    !suppressSkipForward && isPlayheadInKnownFault(state, snapshot);

  // Prefer R2 when jitter strengthens escape, or playhead already in fault band.
  if (preferR2 || faultShortcut || (accelerate && !forceR3)) {
    // Hard failure shortens R0/R1: try R2 once then let caller escalate R3.
    if (accelerate && !preferR2 && !faultShortcut) {
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

  return emitR1(
    state,
    snapshot,
    evidence,
    'r0-observe-elapsed',
    nowMs,
    suppressSkipForward
  );
}

function advanceFromR1(
  state: PlaybackSessionState,
  snapshot: VideoSnapshot,
  nowMs: number,
  evidence: RecoveryRuntimeEvidence | null,
  accelerate: boolean,
  preferR2: boolean,
  suppressSkipForward?: boolean
): RecoveryLadderResult {
  const faultShortcut =
    !suppressSkipForward && isPlayheadInKnownFault(state, snapshot);

  if (
    preferR2 ||
    faultShortcut ||
    state.r1AttemptCount >= RECOVERY_R1_MAX_ATTEMPTS ||
    accelerate
  ) {
    return emitR2(state, snapshot, nowMs, 'r1-exhausted-or-fault');
  }

  return emitR1(
    state,
    snapshot,
    evidence,
    'r1-retry',
    nowMs,
    suppressSkipForward
  );
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
  reason: string,
  nowMs: number,
  suppressSkipForward?: boolean
): RecoveryLadderResult {
  const attempt = state.r1AttemptCount + 1;

  // Post-seek grace: reload the buffer in place instead of nudging the playhead
  // (a nudge near a Bad Point would skip forward off the user's chosen spot).
  if (suppressSkipForward) {
    return {
      state: withStage({ ...state, r1AttemptCount: attempt }, 'R1', 'R1'),
      effects: [
        {
          type: 'sameSourceRecover',
          stage: 'R1',
          action: 'restart-load',
          targetTime: null,
          reason: `${reason}-in-place`,
        },
      ],
    };
  }

  const action = pickR1Action(evidence, attempt);
  const escape = planStallEscapeResume({
    currentPlayTime: snapshot.currentTime,
    badPoints: state.badPoints,
    sourceKey: state.currentSourceKey,
    mode: 'same-source',
    preferExistingWithoutRewind: action !== 'nudge-playback',
  });

  // A forward skip off a Bad Point can also happen at R1 — HLS.js via the
  // nudge target, iOS native via `resume-playback` (the adapter seeks to this
  // target). Charge it against the SAME escape budget as R2 so it cannot
  // ratchet the playhead to the end across recurring Stall Episodes.
  if (escape.action === 'skip-forward' && escape.resumeTime != null) {
    if (
      state.escapeCount >= MAX_ESCAPE_COUNT ||
      state.escapeForwardSpanSeconds >= MAX_ESCAPE_FORWARD_SPAN_SECONDS
    ) {
      // Budget exhausted — stop skipping forward; let the caller evaluate R3.
      return {
        state: withStage(
          { ...state, r1AttemptCount: attempt },
          'R2',
          null
        ),
        effects: [
          {
            type: 'emitDebugEvent',
            eventType: 'recovery.stage.exhausted-same-source',
            message: 'Escape budget exhausted at R1; evaluate R3',
            details: {
              reason,
              stage: 'R1',
              escapeCount: state.escapeCount,
              escapeForwardSpanSeconds: Number(
                state.escapeForwardSpanSeconds.toFixed(2)
              ),
            },
          },
        ],
      };
    }

    const badPoints =
      escape.recordBadPointAt != null
        ? rememberPlaybackBadPoint(state.badPoints, {
            sourceKey: state.currentSourceKey,
            timeSeconds: escape.recordBadPointAt,
            nowMs,
          })
        : state.badPoints;
    const forwardSpan = Math.max(0, escape.resumeTime - snapshot.currentTime);

    return {
      state: withStage(
        {
          ...state,
          r1AttemptCount: attempt,
          badPoints,
          badPointsByScope: persistBadPointsForScope(
            state.badPointsByScope,
            state.contentKey,
            state.currentEpisodeIndex,
            badPoints
          ),
          escapeCount: state.escapeCount + 1,
          escapeForwardSpanSeconds: state.escapeForwardSpanSeconds + forwardSpan,
          // Break the healthy run so a post-escape blip cannot look sustained.
          healthyProgressAnchorMs: null,
          healthyProgressAnchorTime: null,
        },
        'R1',
        'R1'
      ),
      effects: [
        {
          type: 'sameSourceRecover',
          stage: 'R1',
          action,
          targetTime: escape.resumeTime,
          reason,
        },
      ],
    };
  }

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
        // nudge-playback may still rewind in place (targetTime < currentTime);
        // resume/restart/recover do not move the playhead forward here.
        targetTime: action === 'nudge-playback' ? escape.resumeTime : null,
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
  // Escape budget: never ratchet the playhead to the end of the video. Once
  // we have skipped forward too many times / too far since the last user
  // action or sustained recovery, stop escaping and let the caller evaluate R3.
  if (
    state.escapeCount >= MAX_ESCAPE_COUNT ||
    state.escapeForwardSpanSeconds >= MAX_ESCAPE_FORWARD_SPAN_SECONDS
  ) {
    return {
      state: withStage({ ...state, r2AttemptCount: state.r2AttemptCount + 1 }, 'R2', null),
      effects: [
        {
          type: 'emitDebugEvent',
          eventType: 'recovery.stage.exhausted-same-source',
          message: 'Escape budget exhausted; evaluate R3',
          details: {
            reason,
            escapeCount: state.escapeCount,
            escapeForwardSpanSeconds: Number(
              state.escapeForwardSpanSeconds.toFixed(2)
            ),
          },
        },
      ],
    };
  }

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
  const rememberedBadPoint =
    planned.badPoints !== state.badPoints && planned.badPoints.length > 0
      ? planned.badPoints[planned.badPoints.length - 1]
      : null;

  // Charge only forward skips against the escape budget, and break the healthy
  // run so a post-escape blip cannot immediately look like sustained recovery.
  const forwardSpan = Math.max(0, planned.targetTime - snapshot.currentTime);

  return {
    state: withStage(
      {
        ...planned.state,
        r2AttemptCount: attempt,
        escapeCount: planned.state.escapeCount + 1,
        escapeForwardSpanSeconds:
          planned.state.escapeForwardSpanSeconds + forwardSpan,
        healthyProgressAnchorMs: null,
        healthyProgressAnchorTime: null,
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
      ...(rememberedBadPoint
        ? [
            {
              type: 'emitDebugEvent' as const,
              eventType: 'badPoint.remembered',
              message: 'Bad point remembered during R2 escape',
              details: {
                sourceKey: rememberedBadPoint.sourceKey,
                anchorTimeSeconds: rememberedBadPoint.timeSeconds,
              },
            },
          ]
        : []),
      ...(planned.targetTime != null
        ? [
            {
              type: 'emitDebugEvent' as const,
              eventType: 'resume.planned',
              message: 'Recovery resume time planned',
              details: { resumeTime: planned.targetTime, stage: 'R2' },
            },
          ]
        : []),
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
