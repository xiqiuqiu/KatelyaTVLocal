import {
  getNativeJitterDecision,
  getNativePlaybackNudgeTime,
  getNativeVideoRecoveryPlan,
  NATIVE_JITTER_WINDOW_MS,
  NATIVE_FALSE_PLAYING_CHECK_DELAY_MS,
  NATIVE_PLAY_RESUME_GRACE_MS,
  NATIVE_STALL_RECOVERY_THRESHOLD_MS,
  shouldIgnoreNativeStall,
  shouldResetNativeRecoveryOnPause,
  shouldRecoverNativePausedStall,
  shouldRecoverNativeWatchdogStall,
  shouldSwitchSourceForRepeatedNativeFailure,
} from './native-video-recovery';

describe('getNativeVideoRecoveryPlan', () => {
  it('tries to resume native playback before changing the source', () => {
    expect(
      getNativeVideoRecoveryPlan({
        stallCount: 1,
        sourceReloadAttempts: 0,
        fullProxyAttempted: false,
        hasAlternativeSource: true,
      })
    ).toEqual({
      action: 'resume-playback',
      reason: '原生播放器停滞，尝试继续播放',
    });
  });

  it('nudges playback before reloading the native source', () => {
    expect(
      getNativeVideoRecoveryPlan({
        stallCount: 2,
        sourceReloadAttempts: 0,
        fullProxyAttempted: false,
        hasAlternativeSource: true,
      })
    ).toEqual({
      action: 'nudge-playback',
      reason: '原生播放器持续停滞，尝试微调播放位置',
    });
  });

  it('reloads the current native source before escalating to full proxy', () => {
    expect(
      getNativeVideoRecoveryPlan({
        stallCount: 3,
        sourceReloadAttempts: 0,
        fullProxyAttempted: false,
        hasAlternativeSource: true,
      })
    ).toEqual({
      action: 'reload-source',
      reason: '原生播放器仍未恢复，重新设置当前播放地址',
    });
  });

  it('switches to full proxy before trying another source', () => {
    expect(
      getNativeVideoRecoveryPlan({
        stallCount: 4,
        sourceReloadAttempts: 1,
        fullProxyAttempted: false,
        hasAlternativeSource: true,
      })
    ).toEqual({
      action: 'switch-full-proxy',
      reason: '原生播放器持续卡死，升级到完整代理线路',
    });
  });

  it('switches source after full proxy has already been attempted', () => {
    expect(
      getNativeVideoRecoveryPlan({
        stallCount: 5,
        sourceReloadAttempts: 1,
        fullProxyAttempted: true,
        hasAlternativeSource: true,
      })
    ).toEqual({
      action: 'switch-source',
      reason: '完整代理仍无法恢复，切换到其他播放源',
    });
  });

  it('escalates media source unavailable errors directly to full proxy', () => {
    expect(
      getNativeVideoRecoveryPlan({
        stallCount: 1,
        sourceReloadAttempts: 0,
        fullProxyAttempted: false,
        hasAlternativeSource: true,
        mediaSourceUnavailable: true,
        repeatedFailureAtSamePosition: false,
      })
    ).toEqual({
      action: 'switch-full-proxy',
      reason: '原生播放器判定当前媒体源不可用，升级到完整代理线路',
    });
  });

  it('switches source when full proxy still fails at the same position', () => {
    expect(
      getNativeVideoRecoveryPlan({
        stallCount: 2,
        sourceReloadAttempts: 0,
        fullProxyAttempted: true,
        hasAlternativeSource: true,
        mediaSourceUnavailable: true,
        repeatedFailureAtSamePosition: true,
      })
    ).toEqual({
      action: 'switch-source',
      reason: '同一播放位置重复失败，切换到其他播放源',
    });
  });
});

describe('getNativePlaybackNudgeTime', () => {
  it('nudges forward inside the current buffered range', () => {
    expect(
      getNativePlaybackNudgeTime({
        currentTime: 10,
        bufferedRanges: [{ start: 9, end: 12 }],
      })
    ).toBe(10.35);
  });

  it('jumps just inside the next buffered range when current time is near it', () => {
    expect(
      getNativePlaybackNudgeTime({
        currentTime: 10,
        bufferedRanges: [{ start: 11, end: 13 }],
      })
    ).toBe(11.05);
  });

  it('does not return an out-of-range target for tiny buffered ranges', () => {
    expect(
      getNativePlaybackNudgeTime({
        currentTime: 10,
        bufferedRanges: [{ start: 11, end: 11.04 }],
      })
    ).toBeNull();
  });
});

describe('shouldSwitchSourceForRepeatedNativeFailure', () => {
  it('does not switch source after only two same-position failures', () => {
    expect(
      shouldSwitchSourceForRepeatedNativeFailure({
        failureCount: 2,
        mediaSourceUnavailable: true,
        fullProxyAttempted: false,
        segmentMode: 'direct',
      })
    ).toBe(false);
  });

  it('switches source after three same-position failures with a strong failure signal', () => {
    expect(
      shouldSwitchSourceForRepeatedNativeFailure({
        failureCount: 3,
        mediaSourceUnavailable: true,
        fullProxyAttempted: false,
        segmentMode: 'direct',
      })
    ).toBe(true);
  });

  it('does not switch source without a media-source or proxy failure signal', () => {
    expect(
      shouldSwitchSourceForRepeatedNativeFailure({
        failureCount: 3,
        mediaSourceUnavailable: false,
        fullProxyAttempted: false,
        segmentMode: 'direct',
      })
    ).toBe(false);
  });
});

describe('native recovery timing guards', () => {
  it('keeps false-playing detection above short iOS startup jitter', () => {
    expect(NATIVE_FALSE_PLAYING_CHECK_DELAY_MS).toBeGreaterThanOrEqual(9000);
  });

  it('keeps the post-resume grace window above false-playing detection', () => {
    expect(NATIVE_PLAY_RESUME_GRACE_MS).toBeGreaterThanOrEqual(
      NATIVE_FALSE_PLAYING_CHECK_DELAY_MS
    );
  });

  it('does not treat seven seconds without progress as a watchdog stall', () => {
    expect(
      shouldRecoverNativeWatchdogStall({
        ended: false,
        paused: false,
        mediaSourceUnavailable: false,
        readyState: 3,
        stalledForMs: 7000,
      })
    ).toBe(false);
  });

  it('recovers active native playback only after the conservative stall threshold', () => {
    expect(
      shouldRecoverNativeWatchdogStall({
        ended: false,
        paused: false,
        mediaSourceUnavailable: false,
        readyState: 3,
        stalledForMs: NATIVE_STALL_RECOVERY_THRESHOLD_MS,
      })
    ).toBe(true);
  });

  it('does not recover a normal user pause outside loading state', () => {
    expect(
      shouldRecoverNativePausedStall({
        paused: true,
        ended: false,
        mediaSourceUnavailable: false,
        readyState: 3,
        stalledForMs: NATIVE_STALL_RECOVERY_THRESHOLD_MS,
        isVideoLoading: false,
        recentlyHadBufferIssue: false,
      })
    ).toBe(false);
  });

  it('does not recover a user pause just because the loading indicator is still visible', () => {
    expect(
      shouldRecoverNativePausedStall({
        paused: true,
        ended: false,
        mediaSourceUnavailable: false,
        readyState: 3,
        stalledForMs: NATIVE_STALL_RECOVERY_THRESHOLD_MS,
        isVideoLoading: true,
        recentlyHadBufferIssue: false,
      })
    ).toBe(false);
  });

  it('does not auto-resume paused native playback after a recent buffer issue', () => {
    expect(
      shouldRecoverNativePausedStall({
        paused: true,
        ended: false,
        mediaSourceUnavailable: false,
        readyState: 2,
        stalledForMs: NATIVE_STALL_RECOVERY_THRESHOLD_MS,
        isVideoLoading: false,
        recentlyHadBufferIssue: true,
      })
    ).toBe(false);
  });

  it('does not recover a recent paused buffer issue before the stall threshold', () => {
    expect(
      shouldRecoverNativePausedStall({
        paused: true,
        ended: false,
        mediaSourceUnavailable: false,
        readyState: 2,
        stalledForMs: NATIVE_STALL_RECOVERY_THRESHOLD_MS - 1,
        isVideoLoading: false,
        recentlyHadBufferIssue: true,
      })
    ).toBe(false);
  });

  it('recovers paused media-source-unavailable failures after the threshold', () => {
    expect(
      shouldRecoverNativePausedStall({
        paused: true,
        ended: false,
        mediaSourceUnavailable: true,
        readyState: 0,
        stalledForMs: NATIVE_STALL_RECOVERY_THRESHOLD_MS,
        isVideoLoading: false,
        recentlyHadBufferIssue: false,
      })
    ).toBe(true);
  });

  it('does not recover ended videos even when no progress is observed', () => {
    expect(
      shouldRecoverNativeWatchdogStall({
        ended: true,
        paused: false,
        mediaSourceUnavailable: false,
        readyState: 3,
        stalledForMs: NATIVE_STALL_RECOVERY_THRESHOLD_MS,
      })
    ).toBe(false);
  });

  it('keeps readyState zero without a media-source error from triggering recovery', () => {
    expect(
      shouldRecoverNativeWatchdogStall({
        ended: false,
        paused: false,
        mediaSourceUnavailable: false,
        readyState: 0,
        stalledForMs: NATIVE_STALL_RECOVERY_THRESHOLD_MS,
      })
    ).toBe(false);
  });

  it('allows media-source-unavailable failures to recover after the threshold', () => {
    expect(
      shouldRecoverNativeWatchdogStall({
        ended: false,
        paused: true,
        mediaSourceUnavailable: true,
        readyState: 0,
        stalledForMs: NATIVE_STALL_RECOVERY_THRESHOLD_MS,
      })
    ).toBe(true);
  });
});

describe('shouldResetNativeRecoveryOnPause', () => {
  it('resets recovery state for a normal user pause', () => {
    expect(
      shouldResetNativeRecoveryOnPause({
        isVideoLoading: false,
        mediaSourceUnavailable: false,
        recentlyHadBufferIssue: false,
      })
    ).toBe(true);
  });

  it('does not reset recovery state when pause follows a recent buffer issue', () => {
    expect(
      shouldResetNativeRecoveryOnPause({
        isVideoLoading: false,
        mediaSourceUnavailable: false,
        recentlyHadBufferIssue: true,
      })
    ).toBe(false);
  });

  it('does not reset recovery state when the media source is unavailable', () => {
    expect(
      shouldResetNativeRecoveryOnPause({
        isVideoLoading: false,
        mediaSourceUnavailable: true,
        recentlyHadBufferIssue: false,
      })
    ).toBe(false);
  });
});

describe('shouldIgnoreNativeStall', () => {
  it('ignores stalls while the user intends playback to stay paused', () => {
    expect(
      shouldIgnoreNativeStall({
        playIntent: 'paused',
        mediaSourceUnavailable: false,
        nowMs: 20_000,
        ignoreStallUntilMs: 0,
      })
    ).toBe(true);
  });

  it('does not ignore media-source-unavailable failures while paused', () => {
    expect(
      shouldIgnoreNativeStall({
        playIntent: 'paused',
        mediaSourceUnavailable: true,
        nowMs: 20_000,
        ignoreStallUntilMs: 0,
      })
    ).toBe(false);
  });

  it('ignores stalls during the post-resume grace window', () => {
    expect(
      shouldIgnoreNativeStall({
        playIntent: 'playing',
        mediaSourceUnavailable: false,
        nowMs: 12_000,
        ignoreStallUntilMs: 15_000,
      })
    ).toBe(true);
  });

  it('allows stall detection after the post-resume grace window', () => {
    expect(
      shouldIgnoreNativeStall({
        playIntent: 'playing',
        mediaSourceUnavailable: false,
        nowMs: 16_000,
        ignoreStallUntilMs: 15_000,
      })
    ).toBe(false);
  });
});

describe('getNativeJitterDecision', () => {
  it('does not flag a single stalled event as jitter', () => {
    expect(
      getNativeJitterDecision({
        events: [
          {
            type: 'stalled',
            atMs: 1_000,
            currentTime: 10,
            readyState: 4,
          },
        ],
        nowMs: 1_000,
        previousJitterWindows: 0,
      })
    ).toMatchObject({
      isJitter: false,
      shouldSwitchSource: false,
      eventCount: 1,
      rollbackCount: 0,
    });
  });

  it('flags frequent waiting and stalled events inside the jitter window', () => {
    expect(
      getNativeJitterDecision({
        events: [
          { type: 'waiting', atMs: 1_000, currentTime: 10, readyState: 2 },
          { type: 'stalled', atMs: 2_000, currentTime: 11, readyState: 4 },
          { type: 'suspend', atMs: 3_000, currentTime: 12, readyState: 4 },
          { type: 'waiting', atMs: 4_000, currentTime: 13, readyState: 2 },
        ],
        nowMs: 4_000,
        previousJitterWindows: 0,
      })
    ).toMatchObject({
      isJitter: true,
      shouldSwitchSource: false,
      eventCount: 4,
      rollbackCount: 0,
    });
  });

  it('flags repeated currentTime rollback as jitter', () => {
    expect(
      getNativeJitterDecision({
        events: [
          { type: 'waiting', atMs: 1_000, currentTime: 324.59, readyState: 2 },
          { type: 'waiting', atMs: 2_000, currentTime: 334.74, readyState: 2 },
          { type: 'waiting', atMs: 3_000, currentTime: 328.32, readyState: 2 },
          { type: 'stalled', atMs: 4_000, currentTime: 318.32, readyState: 4 },
        ],
        nowMs: 4_000,
        previousJitterWindows: 0,
      })
    ).toMatchObject({
      isJitter: true,
      rollbackCount: 2,
      maxRollbackSeconds: 10,
    });
  });

  it('switches source after two consecutive jitter windows', () => {
    expect(
      getNativeJitterDecision({
        events: [
          { type: 'waiting', atMs: 1_000, currentTime: 10, readyState: 2 },
          { type: 'stalled', atMs: 2_000, currentTime: 11, readyState: 4 },
          { type: 'suspend', atMs: 3_000, currentTime: 12, readyState: 4 },
          { type: 'waiting', atMs: 4_000, currentTime: 13, readyState: 2 },
        ],
        nowMs: 4_000,
        previousJitterWindows: 1,
      })
    ).toMatchObject({
      isJitter: true,
      shouldSwitchSource: true,
    });
  });

  it('drops events outside the rolling jitter window', () => {
    expect(
      getNativeJitterDecision({
        events: [
          {
            type: 'waiting',
            atMs: 1_000,
            currentTime: 10,
            readyState: 2,
          },
          {
            type: 'stalled',
            atMs: NATIVE_JITTER_WINDOW_MS + 2_000,
            currentTime: 20,
            readyState: 4,
          },
        ],
        nowMs: NATIVE_JITTER_WINDOW_MS + 2_000,
        previousJitterWindows: 0,
      })
    ).toMatchObject({
      isJitter: false,
      eventCount: 1,
    });
  });
});
