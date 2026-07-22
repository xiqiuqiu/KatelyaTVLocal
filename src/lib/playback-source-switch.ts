import {
  type PlaybackBadPoint,
  type StallEscapeAction,
  planStallEscapeResume,
  PLAYBACK_RESUME_REWIND_SECONDS as DEFAULT_RESUME_REWIND_SECONDS,
} from '@/lib/playback-stuck-escape';
import { resolveRecoveryCandidateSource } from '@/lib/source-availability/authority';
import { selectRecoveryCandidate } from '@/lib/source-availability/index';
import type { SourceSelectionScore } from '@/lib/source-selection';
import type { SearchResult, SourceStatus } from '@/lib/types';

interface SourceSwitchResumeInput {
  currentEpisodeIndex: number;
  targetEpisodeIndex: number;
  currentPlayTime: number;
  existingResumeTime: number | null;
  badPoints?: readonly PlaybackBadPoint[];
  currentSourceKey?: string | null;
  targetSourceKey?: string | null;
}

interface SourceSwitchResumePlan {
  resumeTime: number | null;
  saveAfterCanPlay: boolean;
  action?: StallEscapeAction;
  recordBadPointAt?: number | null;
}

interface SourceSwitchTargetEpisodeInput {
  currentEpisodeIndex: number;
  episodeCount: number;
  requireCurrentEpisode?: boolean;
}

type RecoverySourceStatusKind =
  | 'idle'
  | 'probing'
  | 'direct'
  | 'proxy'
  | 'playable'
  | 'unavailable';

interface RecoverySourceCandidate {
  source: string;
  id: string;
  episodes?: string[] | null;
  statusKind?: RecoverySourceStatusKind | null;
}

interface RecoverySourceCandidateInput<T extends RecoverySourceCandidate> {
  candidates: T[];
  currentSourceKey: string | null | undefined;
  recoveredSourceKeys: Set<string>;
  currentEpisodeIndex: number;
  getSourceKey?: (candidate: T) => string;
  getEpisodeCount?: (candidate: T) => number;
  getStatusKind?: (candidate: T) => RecoverySourceStatusKind | null | undefined;
  getCandidateScore?: (candidate: T) => number | null | undefined;
}

interface AutoRecoveryResumeInput {
  currentPlayTime: number;
  rewindSeconds?: number;
  badPoints?: readonly PlaybackBadPoint[];
  sourceKey?: string | null;
  mode?: 'same-source' | 'cross-source';
  skipForwardSeconds?: number;
  matchWindowSeconds?: number;
}

interface ClampSourceSwitchResumeTimeInput {
  resumeTime: number;
  duration: number;
  endGuardSeconds?: number;
  endFallbackSeconds?: number;
}

interface SourceChangeTimeoutInput {
  attemptId: number;
  currentAttemptId: number;
  isVideoLoading: boolean;
  timeoutSourceKey: string;
  currentSourceKey: string | null | undefined;
}

export const PLAYBACK_RESUME_REWIND_SECONDS = DEFAULT_RESUME_REWIND_SECONDS;

function getRecoverySourcePriority(
  statusKind?: RecoverySourceStatusKind | null
) {
  if (statusKind === 'direct') return 0;
  if (statusKind === 'playable') {
    return 1;
  }
  if (statusKind === 'proxy') return 2;
  if (!statusKind || statusKind === 'idle') {
    return 3;
  }
  if (statusKind === 'probing') {
    return 4;
  }
  return 9;
}

function isAutoRecoveryStatusUsable(
  statusKind?: RecoverySourceStatusKind | null
) {
  return statusKind === 'direct' || statusKind === 'playable';
}

export function getSourceSwitchTargetEpisodeIndex({
  currentEpisodeIndex,
  episodeCount,
  requireCurrentEpisode = false,
}: SourceSwitchTargetEpisodeInput): number | null {
  if (episodeCount <= 0) {
    return null;
  }

  const safeCurrentEpisodeIndex = Math.max(0, currentEpisodeIndex);

  if (safeCurrentEpisodeIndex < episodeCount) {
    return safeCurrentEpisodeIndex;
  }

  return requireCurrentEpisode ? null : 0;
}

export function getAutoRecoveryResumePlan(
  input: number | AutoRecoveryResumeInput
) {
  if (typeof input === 'number') {
    return planStallEscapeResume({
      currentPlayTime: input,
      mode: 'cross-source',
    });
  }

  return planStallEscapeResume({
    currentPlayTime: input.currentPlayTime,
    rewindSeconds: input.rewindSeconds,
    badPoints: input.badPoints,
    sourceKey: input.sourceKey,
    mode: input.mode ?? 'cross-source',
    skipForwardSeconds: input.skipForwardSeconds,
    matchWindowSeconds: input.matchWindowSeconds,
  });
}

export function getAutoRecoveryResumeTime(
  input: number | AutoRecoveryResumeInput
): number | null {
  return getAutoRecoveryResumePlan(input).resumeTime;
}

export function getRewoundPlaybackResumeTime(
  currentPlayTime: number,
  rewindSeconds = PLAYBACK_RESUME_REWIND_SECONDS
): number | null {
  if (!Number.isFinite(currentPlayTime) || currentPlayTime <= 1) {
    return null;
  }

  return Number(Math.max(0, currentPlayTime - rewindSeconds).toFixed(2));
}

export function clampSourceSwitchResumeTime({
  resumeTime,
  duration,
  endGuardSeconds = 2,
  endFallbackSeconds = 5,
}: ClampSourceSwitchResumeTimeInput): number {
  if (duration > 0 && resumeTime >= duration - endGuardSeconds) {
    return Math.max(0, duration - endFallbackSeconds);
  }

  return resumeTime;
}

/**
 * Guard against applying a stale Recovery Resume Time that would yank the
 * playhead backward. Prod 8bd17d7d: canplay reapplied 2241 while already at 2287
 * after escape-budget exhaustion / same-source remount churn.
 */
export function shouldApplyQueuedResumeTime({
  queuedResumeTime,
  currentPlayTime,
  maxBehindSeconds = DEFAULT_RESUME_REWIND_SECONDS,
}: {
  queuedResumeTime: number;
  currentPlayTime: number;
  maxBehindSeconds?: number;
}): boolean {
  if (!Number.isFinite(queuedResumeTime) || queuedResumeTime <= 0) {
    return false;
  }
  if (!Number.isFinite(currentPlayTime) || currentPlayTime < 0) {
    return true;
  }
  return currentPlayTime <= queuedResumeTime + maxBehindSeconds;
}

export function shouldIgnoreSourceChangeTimeout({
  attemptId,
  currentAttemptId,
  isVideoLoading,
  timeoutSourceKey,
  currentSourceKey,
}: SourceChangeTimeoutInput): boolean {
  return (
    attemptId !== currentAttemptId ||
    !isVideoLoading ||
    currentSourceKey !== timeoutSourceKey
  );
}

export function getNextRecoverySourceCandidate<
  T extends RecoverySourceCandidate
>(input: RecoverySourceCandidateInput<T>): T | undefined {
  return (
    resolveRecoveryCandidateSource({
      availabilitySelect: () => selectAvailabilityRecoverySource(input),
      legacySelect: () => selectLegacyRecoverySourceCandidate(input),
    }) ?? undefined
  );
}

/**
 * Legacy eligibility/ranking furnace. Kept only for instant rollback when
 * NEXT_PUBLIC_SOURCE_AVAILABILITY_CANDIDATE_AUTHORITY=false.
 */
export function selectLegacyRecoverySourceCandidate<
  T extends RecoverySourceCandidate
>({
  candidates,
  currentSourceKey,
  recoveredSourceKeys,
  currentEpisodeIndex,
  getSourceKey = (candidate) => `${candidate.source}-${candidate.id}`,
  getEpisodeCount = (candidate) => candidate.episodes?.length || 0,
  getStatusKind = (candidate) => candidate.statusKind,
  getCandidateScore,
}: RecoverySourceCandidateInput<T>): T | undefined {
  const targetEpisodeIndex = Math.max(0, currentEpisodeIndex);

  return [...candidates]
    .filter((candidate) => {
      const sourceKey = getSourceKey(candidate);
      if (sourceKey === currentSourceKey) {
        return false;
      }

      if (recoveredSourceKeys.has(sourceKey)) {
        return false;
      }

      if (getEpisodeCount(candidate) <= targetEpisodeIndex) {
        return false;
      }

      return isAutoRecoveryStatusUsable(getStatusKind(candidate));
    })
    .sort((a, b) => {
      const scoreA = getCandidateScore?.(a);
      const scoreB = getCandidateScore?.(b);
      if (typeof scoreA === 'number' && typeof scoreB === 'number') {
        if (scoreA !== scoreB) {
          return scoreB - scoreA;
        }
      } else if (typeof scoreA === 'number') {
        return -1;
      } else if (typeof scoreB === 'number') {
        return 1;
      }

      return (
        getRecoverySourcePriority(getStatusKind(a)) -
        getRecoverySourcePriority(getStatusKind(b))
      );
    })[0];
}

function selectAvailabilityRecoverySource<T extends RecoverySourceCandidate>(
  input: RecoverySourceCandidateInput<T>
): T | null {
  const {
    candidates,
    currentSourceKey,
    recoveredSourceKeys,
    currentEpisodeIndex,
    getSourceKey = (candidate) => `${candidate.source}-${candidate.id}`,
    getStatusKind = (candidate) => candidate.statusKind,
    getCandidateScore,
  } = input;

  const statuses = new Map<string, SourceStatus>();
  const sourceSelectionScores = new Map<string, SourceSelectionScore>();

  candidates.forEach((candidate, originalIndex) => {
    const sourceKey = getSourceKey(candidate);
    const statusKind = getStatusKind(candidate);
    if (statusKind) {
      statuses.set(sourceKey, { kind: statusKind });
    }

    const score = getCandidateScore?.(candidate);
    if (typeof score === 'number') {
      sourceSelectionScores.set(sourceKey, {
        sourceKey,
        score,
        reason: '',
        source: candidate as unknown as SearchResult,
        originalIndex,
      });
    }
  });

  const selected = selectRecoveryCandidate({
    sources: candidates as unknown as SearchResult[],
    currentSourceKey,
    currentEpisodeIndex,
    statuses,
    sourceSelectionScores,
    attemptedSourceKeys: recoveredSourceKeys,
    // Legacy getNextRecoverySourceCandidate callers may lack playback clock;
    // keep verified-only here. Startup hang uses Session selectRecoveryCandidate
    // with allowUnverifiedFallback instead.
  });

  if (!selected) {
    return null;
  }

  return (
    candidates.find(
      (candidate) => getSourceKey(candidate) === selected.sourceKey
    ) || null
  );
}

export function getSourceSwitchResumePlan({
  currentEpisodeIndex,
  targetEpisodeIndex,
  currentPlayTime,
  existingResumeTime,
  badPoints,
  currentSourceKey = null,
  targetSourceKey = null,
}: SourceSwitchResumeInput): SourceSwitchResumePlan {
  if (targetEpisodeIndex !== currentEpisodeIndex) {
    return {
      resumeTime: 0,
      saveAfterCanPlay: false,
    };
  }

  const isCrossSource = Boolean(
    currentSourceKey &&
      targetSourceKey &&
      currentSourceKey !== targetSourceKey
  );
  const escapeMode = isCrossSource ? 'cross-source' : 'same-source';

  if (existingResumeTime && existingResumeTime > 0 && existingResumeTime <= 1) {
    return {
      resumeTime: 0,
      saveAfterCanPlay: true,
      action: 'none',
      recordBadPointAt: null,
    };
  }

  // User scrubbed past a stale queued resume — prefer the later playhead.
  if (
    existingResumeTime &&
    existingResumeTime > 0 &&
    currentPlayTime >
      existingResumeTime + PLAYBACK_RESUME_REWIND_SECONDS
  ) {
    const escape = planStallEscapeResume({
      currentPlayTime,
      badPoints,
      sourceKey: currentSourceKey,
      mode: escapeMode,
    });
    return {
      resumeTime: escape.resumeTime ?? 0,
      saveAfterCanPlay: true,
      action: escape.action,
      recordBadPointAt: escape.recordBadPointAt,
    };
  }

  // Already-planned resume targets must not be rewound a second time.
  if (existingResumeTime && existingResumeTime > 0) {
    const escape = planStallEscapeResume({
      currentPlayTime: existingResumeTime,
      badPoints,
      sourceKey: currentSourceKey,
      mode: escapeMode,
      preferExistingWithoutRewind: true,
    });
    return {
      resumeTime: escape.resumeTime ?? existingResumeTime,
      saveAfterCanPlay: true,
      action: escape.action,
      recordBadPointAt: escape.recordBadPointAt,
    };
  }

  if (currentPlayTime > 1) {
    const escape = planStallEscapeResume({
      currentPlayTime,
      badPoints,
      sourceKey: currentSourceKey,
      mode: escapeMode,
    });
    return {
      resumeTime: escape.resumeTime ?? 0,
      saveAfterCanPlay: true,
      action: escape.action,
      recordBadPointAt: escape.recordBadPointAt,
    };
  }

  return {
    resumeTime: existingResumeTime,
    saveAfterCanPlay: false,
  };
}
