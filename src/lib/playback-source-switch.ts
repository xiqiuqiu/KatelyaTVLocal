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
