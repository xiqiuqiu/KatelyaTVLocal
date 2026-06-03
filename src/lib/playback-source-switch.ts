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
}

interface AutoRecoveryResumeInput {
  currentPlayTime: number;
  offsetSeconds?: number;
}

interface ClampSourceSwitchResumeTimeInput {
  resumeTime: number;
  duration: number;
  endGuardSeconds?: number;
  endFallbackSeconds?: number;
}

function getRecoverySourcePriority(statusKind?: RecoverySourceStatusKind | null) {
  if (statusKind === 'direct') return 0;
  if (!statusKind || statusKind === 'idle' || statusKind === 'probing') {
    return 1;
  }
  if (statusKind === 'proxy') return 2;
  return 3;
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
  const offsetSeconds =
    typeof input === 'number' ? 3 : input.offsetSeconds ?? 3;

  if (currentPlayTime <= 1) {
    return null;
  }

  return Number((currentPlayTime + offsetSeconds).toFixed(2));
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

export function getNextRecoverySourceCandidate<T extends RecoverySourceCandidate>({
  candidates,
  currentSourceKey,
  recoveredSourceKeys,
  currentEpisodeIndex,
  getSourceKey = (candidate) => `${candidate.source}-${candidate.id}`,
  getEpisodeCount = (candidate) => candidate.episodes?.length || 0,
  getStatusKind = (candidate) => candidate.statusKind,
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
    .sort(
      (a, b) =>
        getRecoverySourcePriority(getStatusKind(a)) -
        getRecoverySourcePriority(getStatusKind(b))
    )[0];
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
      resumeTime: existingResumeTime,
      saveAfterCanPlay: true,
    };
  }

  if (currentPlayTime > 1) {
    return {
      resumeTime: currentPlayTime,
      saveAfterCanPlay: true,
    };
  }

  return {
    resumeTime: existingResumeTime,
    saveAfterCanPlay: false,
  };
}
