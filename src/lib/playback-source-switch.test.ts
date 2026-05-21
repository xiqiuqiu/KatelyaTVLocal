import { getSourceSwitchResumePlan } from '@/lib/playback-source-switch';

describe('getSourceSwitchResumePlan', () => {
  it('keeps the current time for same-episode source switches and saves once after playback is ready', () => {
    expect(
      getSourceSwitchResumePlan({
        currentEpisodeIndex: 2,
        targetEpisodeIndex: 2,
        currentPlayTime: 438.6,
        existingResumeTime: null,
      })
    ).toEqual({
      resumeTime: 438.6,
      saveAfterCanPlay: true,
    });
  });

  it('does not save a replacement record when switching to a different episode', () => {
    expect(
      getSourceSwitchResumePlan({
        currentEpisodeIndex: 2,
        targetEpisodeIndex: 0,
        currentPlayTime: 438.6,
        existingResumeTime: null,
      })
    ).toEqual({
      resumeTime: 0,
      saveAfterCanPlay: false,
    });
  });

  it('does not overwrite an existing resume target when one is already queued', () => {
    expect(
      getSourceSwitchResumePlan({
        currentEpisodeIndex: 2,
        targetEpisodeIndex: 2,
        currentPlayTime: 438.6,
        existingResumeTime: 120,
      })
    ).toEqual({
      resumeTime: 120,
      saveAfterCanPlay: true,
    });
  });
});
