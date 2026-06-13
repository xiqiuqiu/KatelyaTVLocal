import { SearchResult, SourceStatus } from '@/lib/types';

export interface ProgressiveSourceProbeStartInput {
  now: number;
  stablePlaybackStartedAt: number;
  stablePlaybackDelayMs: number;
  isPaused: boolean;
  isEnded: boolean;
  isSeeking: boolean;
  isVideoLoading: boolean;
  isRecoveryActive: boolean;
  inFlight: boolean;
}

export interface ProgressiveSourceProbeCandidateInput {
  sources: SearchResult[];
  currentSourceKey: string | null;
  attemptedSourceKeys: Set<string>;
  statuses: Map<string, SourceStatus>;
  scores: Map<string, { score: number }>;
  currentEpisodeIndex: number;
  limit: number;
  getSourceKey?: (source: SearchResult) => string;
}

export interface ProgressiveSourceProbeFailureStatusInput {
  domain?: string | null;
  reason?: string;
}

export function shouldStartProgressiveSourceProbe(
  input: ProgressiveSourceProbeStartInput
): boolean {
  if (input.inFlight || input.isPaused || input.isEnded || input.isSeeking) {
    return false;
  }

  if (input.isVideoLoading || input.isRecoveryActive) {
    return false;
  }

  if (input.stablePlaybackStartedAt <= 0) {
    return false;
  }

  return (
    input.now - input.stablePlaybackStartedAt >= input.stablePlaybackDelayMs
  );
}

function getStatusPriority(status?: SourceStatus): number {
  switch (status?.kind) {
    case 'direct':
      return 0;
    case 'playable':
    case 'idle':
    case undefined:
      return 1;
    case 'proxy':
      return 2;
    case 'probing':
      return 3;
    case 'unavailable':
    default:
      return 9;
  }
}

export function selectProgressiveSourceProbeCandidates({
  sources,
  currentSourceKey,
  attemptedSourceKeys,
  statuses,
  scores,
  currentEpisodeIndex,
  limit,
  getSourceKey = (source) => `${source.source}-${source.id}`,
}: ProgressiveSourceProbeCandidateInput): SearchResult[] {
  if (limit <= 0) return [];

  return [...sources]
    .filter((source) => {
      const sourceKey = getSourceKey(source);
      const status = statuses.get(sourceKey);

      return (
        sourceKey !== currentSourceKey &&
        !attemptedSourceKeys.has(sourceKey) &&
        Boolean(source.episodes?.[currentEpisodeIndex]) &&
        status?.kind !== 'unavailable' &&
        status?.kind !== 'proxy'
      );
    })
    .sort((left, right) => {
      const leftKey = getSourceKey(left);
      const rightKey = getSourceKey(right);
      const priorityGap =
        getStatusPriority(statuses.get(leftKey)) -
        getStatusPriority(statuses.get(rightKey));

      if (priorityGap !== 0) {
        return priorityGap;
      }

      const leftScore = scores.get(leftKey)?.score ?? Number.NEGATIVE_INFINITY;
      const rightScore =
        scores.get(rightKey)?.score ?? Number.NEGATIVE_INFINITY;

      if (leftScore !== rightScore) {
        return rightScore - leftScore;
      }

      return sources.indexOf(left) - sources.indexOf(right);
    })
    .slice(0, limit);
}

export function createProgressiveSourceProbeFailureStatus({
  domain,
}: ProgressiveSourceProbeFailureStatusInput): SourceStatus {
  return {
    kind: 'playable',
    reason: '后台测速失败，可尝试播放',
    playbackMode: 'direct',
    domain,
    updatedAt: Date.now(),
    fromMemory: true,
    localConfidence: 'low',
  };
}
