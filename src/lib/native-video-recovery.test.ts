import {
  getNativeJitterDecision,
  getNativePlaybackNudgeTime,
  getNativeRecoveryAction,
  getNativeStallSeverity,
  NATIVE_FALSE_PLAYING_CHECK_DELAY_MS,
  NATIVE_HARD_STALL_THRESHOLD_MS,
  NATIVE_JITTER_WINDOW_MS,
  NATIVE_PLAY_RESUME_GRACE_MS,
  shouldIgnoreNativeStall,
  shouldReportNativePlaybackFailureFeedback,
  shouldResetNativeRecoveryOnPause,
} from './native-video-recovery';

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

describe('native recovery timing guards', () => {
  it('keeps false-playing detection above short iOS startup jitter', () => {
    expect(NATIVE_FALSE_PLAYING_CHECK_DELAY_MS).toBeGreaterThanOrEqual(9000);
  });

  it('keeps the post-resume grace window above false-playing detection', () => {
    expect(NATIVE_PLAY_RESUME_GRACE_MS).toBeGreaterThanOrEqual(
      NATIVE_FALSE_PLAYING_CHECK_DELAY_MS
    );
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

  it('tracks consecutive jitter windows without switching source', () => {
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
      jitterWindowCount: 2,
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

describe('getNativeStallSeverity', () => {
  it('keeps ordinary buffering in observe mode', () => {
    expect(
      getNativeStallSeverity({
        ended: false,
        paused: false,
        mediaSourceUnavailable: false,
        readyState: 2,
        networkState: 2,
        stalledForMs: 8_000,
        hasRecentProgress: true,
      })
    ).toBe('observe');
  });

  it('treats false-playing as a soft stall before the hard threshold', () => {
    expect(
      getNativeStallSeverity({
        ended: false,
        paused: false,
        mediaSourceUnavailable: false,
        readyState: 3,
        networkState: 2,
        stalledForMs: NATIVE_HARD_STALL_THRESHOLD_MS - 1,
        hasRecentProgress: false,
      })
    ).toBe('soft-stall');
  });

  it('promotes active playback to hard stall only after the hard threshold', () => {
    expect(
      getNativeStallSeverity({
        ended: false,
        paused: false,
        mediaSourceUnavailable: false,
        readyState: 3,
        networkState: 2,
        stalledForMs: NATIVE_HARD_STALL_THRESHOLD_MS,
        hasRecentProgress: false,
      })
    ).toBe('hard-stall');
  });

  it('treats explicit native media failure as source failed', () => {
    expect(
      getNativeStallSeverity({
        ended: false,
        paused: false,
        mediaSourceUnavailable: true,
        readyState: 0,
        networkState: 3,
        stalledForMs: 1_000,
        hasRecentProgress: false,
      })
    ).toBe('source-failed');
  });

  it('does not recover normal paused playback', () => {
    expect(
      getNativeStallSeverity({
        ended: false,
        paused: true,
        playIntent: 'paused',
        mediaSourceUnavailable: false,
        readyState: 2,
        networkState: 2,
        stalledForMs: NATIVE_HARD_STALL_THRESHOLD_MS,
        hasRecentProgress: false,
      })
    ).toBe('observe');
  });

  // Repro from D1 session ff31a0a3 (仙逆 / iOS native-hls):
  // pauseReason=buffering, playIntent=playing, readyState=4, paused=true —
  // watchdog must not treat this as a user pause (otherwise auto-resume never fires).
  it('recovers buffering pause when play intent is still playing', () => {
    expect(
      getNativeStallSeverity({
        ended: false,
        paused: true,
        playIntent: 'playing',
        mediaSourceUnavailable: false,
        readyState: 4,
        networkState: 2,
        stalledForMs: NATIVE_HARD_STALL_THRESHOLD_MS,
        hasRecentProgress: false,
      })
    ).toBe('hard-stall');
  });
});

describe('getNativeRecoveryAction', () => {
  it('does not recover while browser autoplay is locked', () => {
    expect(
      getNativeRecoveryAction({
        severity: 'hard-stall',
        playIntent: 'playing',
        browserAutoplayLocked: true,
        hasAlternativeSource: true,
        sourceRecoveryAttempts: 0,
      })
    ).toEqual({
      action: 'observe',
      reason: '浏览器阻止自动播放，等待用户手动继续',
    });
  });

  it('observes soft stalls without resuming playback', () => {
    expect(
      getNativeRecoveryAction({
        severity: 'soft-stall',
        playIntent: 'playing',
        browserAutoplayLocked: false,
        hasAlternativeSource: true,
        sourceRecoveryAttempts: 0,
      })
    ).toEqual({
      action: 'observe',
      reason: '原生播放器短暂缓冲，继续观察',
    });
  });

  it('uses one low-frequency resume for a hard stall', () => {
    expect(
      getNativeRecoveryAction({
        severity: 'hard-stall',
        playIntent: 'playing',
        browserAutoplayLocked: false,
        hasAlternativeSource: true,
        sourceRecoveryAttempts: 0,
      })
    ).toEqual({
      action: 'resume-playback',
      reason: '原生播放器长时间未推进，尝试恢复播放',
    });
  });

  it('switches source after a hard stall resume already failed', () => {
    expect(
      getNativeRecoveryAction({
        severity: 'hard-stall',
        playIntent: 'playing',
        browserAutoplayLocked: false,
        hasAlternativeSource: true,
        sourceRecoveryAttempts: 1,
      })
    ).toEqual({
      action: 'switch-source',
      reason: '原生播放器长时间未推进且恢复失败，切换到其他播放源',
    });
  });

  it('switches source immediately for source failed state', () => {
    expect(
      getNativeRecoveryAction({
        severity: 'source-failed',
        playIntent: 'playing',
        browserAutoplayLocked: false,
        hasAlternativeSource: true,
        sourceRecoveryAttempts: 0,
      })
    ).toEqual({
      action: 'switch-source',
      reason: '原生播放器判定当前媒体源不可用，切换到其他播放源',
    });
  });
});

describe('shouldReportNativePlaybackFailureFeedback', () => {
  it('reports native source failures immediately', () => {
    expect(
      shouldReportNativePlaybackFailureFeedback({
        severity: 'source-failed',
        action: 'switch-source',
        sourceRecoveryAttempts: 0,
      })
    ).toBe(true);
  });

  it('reports hard stalls after the first resume attempt fails', () => {
    expect(
      shouldReportNativePlaybackFailureFeedback({
        severity: 'hard-stall',
        action: 'switch-source',
        sourceRecoveryAttempts: 1,
      })
    ).toBe(true);
  });

  it('does not report a soft stall observation as source failure', () => {
    expect(
      shouldReportNativePlaybackFailureFeedback({
        severity: 'soft-stall',
        action: 'observe',
        sourceRecoveryAttempts: 0,
      })
    ).toBe(false);
  });
});

describe('hard-stall recovery decision sequence', () => {
  it('escalates from resume-playback to switch-source after one failed attempt', () => {
    expect(
      getNativeRecoveryAction({
        severity: 'hard-stall',
        playIntent: 'playing',
        browserAutoplayLocked: false,
        hasAlternativeSource: true,
        sourceRecoveryAttempts: 0,
      }).action
    ).toBe('resume-playback');

    expect(
      getNativeRecoveryAction({
        severity: 'hard-stall',
        playIntent: 'playing',
        browserAutoplayLocked: false,
        hasAlternativeSource: true,
        sourceRecoveryAttempts: 1,
      }).action
    ).toBe('switch-source');
  });

  it('keeps stall detection suppressed during post-resume grace window', () => {
    const resumeAt = 10_000;
    const graceUntil = resumeAt + NATIVE_PLAY_RESUME_GRACE_MS;

    expect(
      shouldIgnoreNativeStall({
        playIntent: 'playing',
        mediaSourceUnavailable: false,
        nowMs: graceUntil - 1,
        ignoreStallUntilMs: graceUntil,
      })
    ).toBe(true);

    expect(
      shouldIgnoreNativeStall({
        playIntent: 'playing',
        mediaSourceUnavailable: false,
        nowMs: graceUntil + 1,
        ignoreStallUntilMs: graceUntil,
      })
    ).toBe(false);
  });

  it('still classifies accumulated stalls as hard-stall after grace expires', () => {
    expect(
      getNativeStallSeverity({
        ended: false,
        paused: false,
        mediaSourceUnavailable: false,
        readyState: 3,
        networkState: 2,
        stalledForMs: NATIVE_HARD_STALL_THRESHOLD_MS,
        hasRecentProgress: false,
      })
    ).toBe('hard-stall');
  });
});
