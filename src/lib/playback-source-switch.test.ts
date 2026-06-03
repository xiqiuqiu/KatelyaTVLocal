import {
  clampSourceSwitchResumeTime,
  getAutoRecoveryResumeTime,
  getNextRecoverySourceCandidate,
  getSourceSwitchResumePlan,
  getSourceSwitchTargetEpisodeIndex,
} from '@/lib/playback-source-switch';

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

  it('does not persist a resume point when the current playback time has not meaningfully started', () => {
    expect(
      getSourceSwitchResumePlan({
        currentEpisodeIndex: 1,
        targetEpisodeIndex: 1,
        currentPlayTime: 0.8,
        existingResumeTime: null,
      })
    ).toEqual({
      resumeTime: null,
      saveAfterCanPlay: false,
    });
  });

  it('drops a queued resume target when the user manually changes to a different episode', () => {
    expect(
      getSourceSwitchResumePlan({
        currentEpisodeIndex: 5,
        targetEpisodeIndex: 0,
        currentPlayTime: 300,
        existingResumeTime: 303,
      })
    ).toEqual({
      resumeTime: 0,
      saveAfterCanPlay: false,
    });
  });
});

describe('getSourceSwitchTargetEpisodeIndex', () => {
  it('keeps the current episode when the target source has the same index', () => {
    expect(
      getSourceSwitchTargetEpisodeIndex({
        currentEpisodeIndex: 6,
        episodeCount: 12,
      })
    ).toBe(6);
  });

  it('lets manual source changes fall back to the first episode when the same index is missing', () => {
    expect(
      getSourceSwitchTargetEpisodeIndex({
        currentEpisodeIndex: 6,
        episodeCount: 3,
      })
    ).toBe(0);
  });

  it('does not let automatic recovery source changes fall back to the first episode', () => {
    expect(
      getSourceSwitchTargetEpisodeIndex({
        currentEpisodeIndex: 6,
        episodeCount: 3,
        requireCurrentEpisode: true,
      })
    ).toBeNull();
  });

  it('returns null for empty target sources', () => {
    expect(
      getSourceSwitchTargetEpisodeIndex({
        currentEpisodeIndex: 0,
        episodeCount: 0,
      })
    ).toBeNull();
  });

  it('normalizes invalid negative episode indexes to the first episode', () => {
    expect(
      getSourceSwitchTargetEpisodeIndex({
        currentEpisodeIndex: -1,
        episodeCount: 10,
        requireCurrentEpisode: true,
      })
    ).toBe(0);
  });
});

describe('getAutoRecoveryResumeTime', () => {
  it('adds a small offset so automatic recovery avoids the same bad segment boundary', () => {
    expect(getAutoRecoveryResumeTime(438.123)).toBe(441.12);
  });

  it('does not queue a recovery resume point before playback has meaningfully started', () => {
    expect(getAutoRecoveryResumeTime(0)).toBeNull();
    expect(getAutoRecoveryResumeTime(0.5)).toBeNull();
  });
});

describe('clampSourceSwitchResumeTime', () => {
  it('keeps the planned resume time when the duration is unknown', () => {
    expect(
      clampSourceSwitchResumeTime({
        resumeTime: 180,
        duration: 0,
      })
    ).toBe(180);
  });

  it('moves the resume point back when it is too close to the video end', () => {
    expect(
      clampSourceSwitchResumeTime({
        resumeTime: 598,
        duration: 600,
      })
    ).toBe(595);
  });

  it('never returns a negative resume time for very short videos', () => {
    expect(
      clampSourceSwitchResumeTime({
        resumeTime: 8,
        duration: 4,
      })
    ).toBe(0);
  });
});

describe('getNextRecoverySourceCandidate', () => {
  const candidates = [
    {
      source: 'current',
      id: '1',
      episodes: ['a', 'b', 'c'],
      statusKind: 'direct' as const,
    },
    {
      source: 'short',
      id: '2',
      episodes: ['a'],
      statusKind: 'direct' as const,
    },
    {
      source: 'bad',
      id: '3',
      episodes: ['a', 'b', 'c'],
      statusKind: 'unavailable' as const,
    },
    {
      source: 'proxy',
      id: '4',
      episodes: ['a', 'b', 'c'],
      statusKind: 'proxy' as const,
    },
    {
      source: 'direct',
      id: '5',
      episodes: ['a', 'b', 'c'],
      statusKind: 'direct' as const,
    },
  ];

  it('chooses a same-episode direct source over proxy and unavailable candidates', () => {
    expect(
      getNextRecoverySourceCandidate({
        candidates,
        currentSourceKey: 'current-1',
        recoveredSourceKeys: new Set<string>(),
        currentEpisodeIndex: 2,
      })
    ).toEqual(candidates[4]);
  });

  it('skips candidates that do not contain the current episode', () => {
    expect(
      getNextRecoverySourceCandidate({
        candidates: candidates.slice(0, 2),
        currentSourceKey: 'current-1',
        recoveredSourceKeys: new Set<string>(),
        currentEpisodeIndex: 2,
      })
    ).toBeUndefined();
  });

  it('skips sources already tried during the current recovery chain', () => {
    expect(
      getNextRecoverySourceCandidate({
        candidates,
        currentSourceKey: 'current-1',
        recoveredSourceKeys: new Set<string>(['direct-5']),
        currentEpisodeIndex: 2,
      })
    ).toEqual(candidates[3]);
  });

  it('treats unknown and probing sources as usable fallback before proxy sources', () => {
    const unknownCandidates = [
      {
        source: 'proxy',
        id: '1',
        episodes: ['a', 'b'],
        statusKind: 'proxy' as const,
      },
      {
        source: 'unknown',
        id: '2',
        episodes: ['a', 'b'],
      },
      {
        source: 'probing',
        id: '3',
        episodes: ['a', 'b'],
        statusKind: 'probing' as const,
      },
    ];

    expect(
      getNextRecoverySourceCandidate({
        candidates: unknownCandidates,
        currentSourceKey: 'current-0',
        recoveredSourceKeys: new Set<string>(),
        currentEpisodeIndex: 1,
      })
    ).toEqual(unknownCandidates[1]);
  });
});
