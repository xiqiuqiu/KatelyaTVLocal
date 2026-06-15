interface SourceSwitchResumeInput {
  currentEpisodeIndex: number;
  targetEpisodeIndex: number;
  currentPlayTime: number;
  existingResumeTime: number | null;
}

interface SourceSwitchResumePlan {
  resumeTime: number | null;
  saveAfterCanPlay: boolean;
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

export const PLAYBACK_RESUME_REWIND_SECONDS = 5;

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

export function getAutoRecoveryResumeTime(
  input: number | AutoRecoveryResumeInput
): number | null {
  const currentPlayTime =
    typeof input === 'number' ? input : input.currentPlayTime;
  const rewindSeconds =
    typeof input === 'number'
      ? PLAYBACK_RESUME_REWIND_SECONDS
      : input.rewindSeconds ?? PLAYBACK_RESUME_REWIND_SECONDS;

  return getRewoundPlaybackResumeTime(currentPlayTime, rewindSeconds);
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

      return getStatusKind(candidate) !== 'unavailable';
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

export function getSourceSwitchResumePlan({
  currentEpisodeIndex,
  targetEpisodeIndex,
  currentPlayTime,
  existingResumeTime,
}: SourceSwitchResumeInput): SourceSwitchResumePlan {
  if (targetEpisodeIndex !== currentEpisodeIndex) {
    return {
      resumeTime: 0,
      saveAfterCanPlay: false,
    };
  }

  if (existingResumeTime && existingResumeTime > 0) {
    return {
      resumeTime: getRewoundPlaybackResumeTime(existingResumeTime) ?? 0,
      saveAfterCanPlay: true,
    };
  }

  if (currentPlayTime > 1) {
    return {
      resumeTime: getRewoundPlaybackResumeTime(currentPlayTime) ?? 0,
      saveAfterCanPlay: true,
    };
  }

  return {
    resumeTime: existingResumeTime,
    saveAfterCanPlay: false,
  };
}
