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

export function getSourceSwitchTargetEpisodeIndex({
  currentEpisodeIndex,
  episodeCount,
  requireCurrentEpisode = false,
}: SourceSwitchTargetEpisodeInput): number | null {
  if (episodeCount <= 0) {
    return null;
  }

  if (currentEpisodeIndex < episodeCount) {
    return currentEpisodeIndex;
  }

  return requireCurrentEpisode ? null : 0;
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
