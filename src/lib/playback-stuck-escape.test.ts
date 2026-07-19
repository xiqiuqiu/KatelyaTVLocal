import {
  PLAYBACK_BAD_POINT_SKIP_FORWARD_SECONDS,
  PLAYBACK_RESUME_REWIND_SECONDS,
  findNearbyPlaybackBadPoint,
  planStallEscapeResume,
  purgeBadPointsOverlappingAdSkipWindow,
  rememberPlaybackBadPoint,
} from '@/lib/playback-stuck-escape';
import {
  getAutoRecoveryResumeTime,
  getRewoundPlaybackResumeTime,
  getSourceSwitchResumePlan,
} from '@/lib/playback-source-switch';

const STUCK_AT_SECONDS = 438.6;

describe('playback stuck-point escape', () => {
  it('first stall rewinds and asks the caller to record the bad point', () => {
    const plan = planStallEscapeResume({
      currentPlayTime: STUCK_AT_SECONDS,
      sourceKey: 'source-a',
      mode: 'same-source',
    });

    expect(plan).toEqual({
      resumeTime: Number(
        (STUCK_AT_SECONDS - PLAYBACK_RESUME_REWIND_SECONDS).toFixed(2)
      ),
      action: 'rewind',
      recordBadPointAt: STUCK_AT_SECONDS,
    });
  });

  it('later stalls near a recorded bad point skip forward past the freeze', () => {
    const badPoints = rememberPlaybackBadPoint([], {
      sourceKey: 'source-a',
      timeSeconds: STUCK_AT_SECONDS,
      nowMs: 1_000,
    });

    const plan = planStallEscapeResume({
      currentPlayTime: STUCK_AT_SECONDS - 2,
      sourceKey: 'source-a',
      mode: 'same-source',
      badPoints,
    });

    expect(plan.action).toBe('skip-forward');
    expect(plan.resumeTime).toBe(
      Number(
        (STUCK_AT_SECONDS + PLAYBACK_BAD_POINT_SKIP_FORWARD_SECONDS).toFixed(2)
      )
    );
  });

  it('cross-source recovery skips a session stuck clock time instead of rewinding into it', () => {
    const badPoints = rememberPlaybackBadPoint([], {
      sourceKey: 'source-a',
      timeSeconds: STUCK_AT_SECONDS,
      nowMs: 1_000,
    });

    const plan = planStallEscapeResume({
      currentPlayTime: STUCK_AT_SECONDS,
      sourceKey: 'source-b',
      mode: 'cross-source',
      badPoints,
    });

    expect(plan.action).toBe('skip-forward');
    expect(plan.resumeTime as number).toBeGreaterThan(STUCK_AT_SECONDS);
  });

  it('does not treat another source bad point as same-source match', () => {
    const badPoints = rememberPlaybackBadPoint([], {
      sourceKey: 'source-a',
      timeSeconds: STUCK_AT_SECONDS,
      nowMs: 1_000,
    });

    expect(
      findNearbyPlaybackBadPoint(badPoints, {
        timeSeconds: STUCK_AT_SECONDS,
        sourceKey: 'source-b',
        mode: 'same-source',
      })
    ).toBeNull();
  });
});

describe('ad-skip then double bad-point skip-forward (iOS Pad ~40s jump)', () => {
  it('two skip-forwards after an ad-skip landing accumulate ~40s (user symptom)', () => {
    // Ad ends at 100; seek lands at 100.35. A stall bad-point was recorded
    // inside the ad (or at landing). Each escape adds +20s.
    const adSkipLanding = 100.35;
    let badPoints = rememberPlaybackBadPoint([], {
      sourceKey: 'ruyi-1',
      timeSeconds: 95,
      nowMs: 1_000,
    });

    const first = planStallEscapeResume({
      currentPlayTime: adSkipLanding,
      sourceKey: 'ruyi-1',
      mode: 'same-source',
      badPoints,
    });
    expect(first.action).toBe('skip-forward');
    expect(first.resumeTime).toBe(
      Number((adSkipLanding + PLAYBACK_BAD_POINT_SKIP_FORWARD_SECONDS).toFixed(2))
    );

    badPoints = rememberPlaybackBadPoint(badPoints, {
      sourceKey: 'ruyi-1',
      timeSeconds: first.resumeTime!,
      nowMs: 2_000,
    });
    const second = planStallEscapeResume({
      currentPlayTime: first.resumeTime!,
      sourceKey: 'ruyi-1',
      mode: 'same-source',
      badPoints,
    });
    expect(second.action).toBe('skip-forward');
    expect(
      Number(((second.resumeTime ?? 0) - adSkipLanding).toFixed(2))
    ).toBe(PLAYBACK_BAD_POINT_SKIP_FORWARD_SECONDS * 2);
  });

  it('suppressSkipForward blocks +20 escape during post-ad-skip grace', () => {
    const badPoints = rememberPlaybackBadPoint([], {
      sourceKey: 'ruyi-1',
      timeSeconds: 95,
      nowMs: 1_000,
    });
    const plan = planStallEscapeResume({
      currentPlayTime: 100.35,
      sourceKey: 'ruyi-1',
      mode: 'same-source',
      badPoints,
      suppressSkipForward: true,
    });
    expect(plan.action).toBe('none');
    expect(plan.resumeTime).toBe(100.35);
  });

  it('purging ad-window bad points stops the post-skip +20 escape', () => {
    const adStart = 80;
    const adEnd = 100;
    const adSkipLanding = 100.35;
    const badPoints = rememberPlaybackBadPoint([], {
      sourceKey: 'ruyi-1',
      timeSeconds: 95,
      nowMs: 1_000,
    });

    const purged = purgeBadPointsOverlappingAdSkipWindow(badPoints, {
      startTimeSeconds: adStart,
      endTimeSeconds: adEnd,
      sourceKey: 'ruyi-1',
    });
    expect(purged).toEqual([]);

    const plan = planStallEscapeResume({
      currentPlayTime: adSkipLanding,
      sourceKey: 'ruyi-1',
      mode: 'same-source',
      badPoints: purged,
    });
    // No nearby bad point → rewind, not +20 skip-forward.
    expect(plan.action).toBe('rewind');
    expect(plan.resumeTime as number).toBeLessThan(adSkipLanding);
  });
});

describe('playback stuck-point escape (user symptom feedback loop)', () => {
  it('refresh + source switch + auto recovery can skip past a recorded stuck time', () => {
    const badPoints = rememberPlaybackBadPoint([], {
      sourceKey: 'current-1',
      timeSeconds: STUCK_AT_SECONDS,
      nowMs: 1_000,
    });

    const refreshResume = getRewoundPlaybackResumeTime(STUCK_AT_SECONDS);
    const switchResume = getSourceSwitchResumePlan({
      currentEpisodeIndex: 2,
      targetEpisodeIndex: 2,
      currentPlayTime: STUCK_AT_SECONDS,
      existingResumeTime: null,
      badPoints,
      currentSourceKey: 'current-1',
      targetSourceKey: 'direct-5',
    }).resumeTime;
    const recoveryResume = getAutoRecoveryResumeTime({
      currentPlayTime: STUCK_AT_SECONDS,
      badPoints,
      sourceKey: 'current-1',
      mode: 'cross-source',
    });

    const planned = [refreshResume, switchResume, recoveryResume].filter(
      (value): value is number => typeof value === 'number'
    );

    expect(Math.max(...planned)).toBeGreaterThan(STUCK_AT_SECONDS);
  });

  it('same-episode source switch after a recorded freeze seeks past the stuck boundary', () => {
    const badPoints = rememberPlaybackBadPoint([], {
      sourceKey: 'current-1',
      timeSeconds: STUCK_AT_SECONDS,
      nowMs: 1_000,
    });

    const resumeTime = getSourceSwitchResumePlan({
      currentEpisodeIndex: 2,
      targetEpisodeIndex: 2,
      currentPlayTime: STUCK_AT_SECONDS,
      existingResumeTime: null,
      badPoints,
      currentSourceKey: 'current-1',
      targetSourceKey: 'direct-5',
    }).resumeTime;

    expect(resumeTime as number).toBeGreaterThan(STUCK_AT_SECONDS);
  });

  it('auto recovery after a recorded freeze seeks past the stuck boundary', () => {
    const badPoints = rememberPlaybackBadPoint([], {
      sourceKey: 'current-1',
      timeSeconds: STUCK_AT_SECONDS,
      nowMs: 1_000,
    });

    const resumeTime = getAutoRecoveryResumeTime({
      currentPlayTime: STUCK_AT_SECONDS,
      badPoints,
      sourceKey: 'current-1',
      mode: 'cross-source',
    });

    expect(resumeTime as number).toBeGreaterThan(STUCK_AT_SECONDS);
  });

  it('a queued stale resume must not override a later playhead past the stuck point', () => {
    const scrubbedPastStuck = STUCK_AT_SECONDS + 90;
    const staleQueuedResume = STUCK_AT_SECONDS - 5;

    const plan = getSourceSwitchResumePlan({
      currentEpisodeIndex: 2,
      targetEpisodeIndex: 2,
      currentPlayTime: scrubbedPastStuck,
      existingResumeTime: staleQueuedResume,
    });

    expect(plan.resumeTime as number).toBeGreaterThan(STUCK_AT_SECONDS);
    expect(plan.resumeTime as number).toBeGreaterThanOrEqual(
      scrubbedPastStuck - PLAYBACK_RESUME_REWIND_SECONDS - 0.01
    );
  });

  it('does not double-rewind an already planned resume target', () => {
    const alreadyRewound = STUCK_AT_SECONDS - PLAYBACK_RESUME_REWIND_SECONDS;

    const plan = getSourceSwitchResumePlan({
      currentEpisodeIndex: 2,
      targetEpisodeIndex: 2,
      currentPlayTime: 12,
      existingResumeTime: alreadyRewound,
    });

    expect(plan.resumeTime).toBe(alreadyRewound);
  });
});
