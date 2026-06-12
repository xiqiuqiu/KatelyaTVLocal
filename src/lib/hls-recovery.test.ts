import {
  getHlsRecoveryGuardPlaybackUrl,
  getHlsRecoveryPlan,
  getHlsRecoveryProgressUpdate,
  shouldTriggerHlsWaitingRecovery,
} from '@/lib/hls-recovery';

describe('getHlsRecoveryPlan', () => {
  it('nudges playback first when a non-fatal stall happens', () => {
    expect(
      getHlsRecoveryPlan({
        fatal: false,
        errorType: 'mediaError',
        errorDetails: 'bufferStalledError',
        playbackMode: 'direct',
        stallCount: 1,
        networkRecoveryAttempts: 0,
        mediaRecoveryAttempts: 0,
        hasAlternativeSource: true,
      })
    ).toEqual({
      action: 'nudge-playback',
      reason: '缓冲停滞，尝试微调播放位置恢复',
    });
  });

  it('escalates repeated direct stalls to source switching without proxy playback', () => {
    expect(
      getHlsRecoveryPlan({
        fatal: false,
        errorType: 'mediaError',
        errorDetails: 'bufferStalledError',
        playbackMode: 'direct',
        stallCount: 2,
        stallWindowCount: 5,
        networkRecoveryAttempts: 1,
        mediaRecoveryAttempts: 1,
        hasAlternativeSource: true,
      })
    ).toEqual({
      action: 'switch-source',
      reason: '当前线路持续卡顿，切换到其他播放源',
    });
  });

  it('destroys hls when repeated stalls have no alternative source', () => {
    expect(
      getHlsRecoveryPlan({
        fatal: false,
        errorType: 'mediaError',
        errorDetails: 'waitingTimeout',
        playbackMode: 'direct',
        stallCount: 2,
        stallWindowCount: 5,
        networkRecoveryAttempts: 1,
        mediaRecoveryAttempts: 1,
        hasAlternativeSource: false,
      })
    ).toEqual({
      action: 'destroy',
      reason: '当前线路持续卡顿且无可用候选源，停止当前 HLS 实例',
    });
  });

  it('restarts load before giving up on repeated network errors in proxy mode', () => {
    expect(
      getHlsRecoveryPlan({
        fatal: true,
        errorType: 'networkError',
        errorDetails: 'fragLoadError',
        playbackMode: 'proxy',
        stallCount: 0,
        stallWindowCount: 0,
        networkRecoveryAttempts: 0,
        mediaRecoveryAttempts: 0,
        hasAlternativeSource: false,
      })
    ).toEqual({
      action: 'restart-load',
      reason: '致命网络错误，重新拉取分片',
    });
  });

  it('escalates repeated network errors to source switching instead of proxy playback', () => {
    expect(
      getHlsRecoveryPlan({
        fatal: false,
        errorType: 'networkError',
        errorDetails: 'fragLoadTimeOut',
        playbackMode: 'direct',
        stallCount: 0,
        stallWindowCount: 0,
        networkRecoveryAttempts: 2,
        mediaRecoveryAttempts: 0,
        hasAlternativeSource: true,
      })
    ).toEqual({
      action: 'switch-source',
      reason: '网络错误重复发生，切换到其他播放源',
    });
  });
});

describe('getHlsRecoveryProgressUpdate', () => {
  it('does not mark playback healthy on tiny progress after a stall', () => {
    expect(
      getHlsRecoveryProgressUpdate({
        currentTime: 100.2,
        now: 10_000,
        lastProgressTime: 100,
        lastProgressAt: 9_500,
        healthyWindowStartedAt: 9_500,
        healthyWindowStartedTime: 100,
        hasActiveStallWindow: true,
      })
    ).toEqual({
      healthy: false,
      lastProgressTime: 100.2,
      lastProgressAt: 10_000,
      healthyWindowStartedAt: 9_500,
      healthyWindowStartedTime: 100,
    });
  });

  it('marks playback healthy only after sustained time progression', () => {
    expect(
      getHlsRecoveryProgressUpdate({
        currentTime: 101.7,
        now: 17_500,
        lastProgressTime: 100.8,
        lastProgressAt: 14_000,
        healthyWindowStartedAt: 10_000,
        healthyWindowStartedTime: 100,
        hasActiveStallWindow: true,
      })
    ).toEqual({
      healthy: true,
      lastProgressTime: 101.7,
      lastProgressAt: 17_500,
      healthyWindowStartedAt: 17_500,
      healthyWindowStartedTime: 101.7,
    });
  });

  it('marks playback healthy when playback clearly advances after an expired window', () => {
    expect(
      getHlsRecoveryProgressUpdate({
        currentTime: 120.6,
        now: 30_000,
        lastProgressTime: 120,
        lastProgressAt: 12_000,
        healthyWindowStartedAt: 10_000,
        healthyWindowStartedTime: 119.8,
        hasActiveStallWindow: true,
      }).healthy
    ).toBe(true);
  });
});

describe('shouldTriggerHlsWaitingRecovery', () => {
  const baseInput = {
    timerSessionId: 3,
    currentSessionId: 3,
    timerPlaybackUrl: 'https://media.example.com/show/index.m3u8',
    currentPlaybackUrl: 'https://media.example.com/show/index.m3u8',
    isSameVideoElement: true,
    isEnded: false,
    isUserPaused: false,
    isSeeking: false,
    nowMs: 20_000,
    manualInteractionUntilMs: 0,
    seekBufferGraceUntilMs: 0,
  };

  it('allows recovery for a current stalled session without user interaction guards', () => {
    expect(shouldTriggerHlsWaitingRecovery(baseInput)).toEqual({
      shouldTrigger: true,
    });
  });

  it('ignores waiting timers from an expired playback session', () => {
    expect(
      shouldTriggerHlsWaitingRecovery({
        ...baseInput,
        timerSessionId: 2,
      })
    ).toEqual({
      shouldTrigger: false,
      reason: 'stale-session',
    });
  });

  it('ignores waiting timers after the playback url has changed', () => {
    expect(
      shouldTriggerHlsWaitingRecovery({
        ...baseInput,
        currentPlaybackUrl: 'https://media.example.com/show/next.m3u8',
      })
    ).toEqual({
      shouldTrigger: false,
      reason: 'stale-url',
    });
  });

  it('ignores waiting recovery while the user has paused playback', () => {
    expect(
      shouldTriggerHlsWaitingRecovery({
        ...baseInput,
        isUserPaused: true,
      })
    ).toEqual({
      shouldTrigger: false,
      reason: 'user-paused',
    });
  });

  it('ignores waiting recovery while the user is seeking', () => {
    expect(
      shouldTriggerHlsWaitingRecovery({
        ...baseInput,
        isSeeking: true,
      })
    ).toEqual({
      shouldTrigger: false,
      reason: 'user-seeking',
    });
  });

  it('ignores waiting recovery during the manual interaction grace window', () => {
    expect(
      shouldTriggerHlsWaitingRecovery({
        ...baseInput,
        manualInteractionUntilMs: 25_000,
      })
    ).toEqual({
      shouldTrigger: false,
      reason: 'manual-interaction-grace',
    });
  });

  it('ignores waiting recovery during the post-seek buffering grace window', () => {
    expect(
      shouldTriggerHlsWaitingRecovery({
        ...baseInput,
        seekBufferGraceUntilMs: 25_000,
      })
    ).toEqual({
      shouldTrigger: false,
      reason: 'seek-buffer-grace',
    });
  });
});

describe('getHlsRecoveryGuardPlaybackUrl', () => {
  it('prefers the logical HLS playback url over a MediaSource blob url', () => {
    expect(
      getHlsRecoveryGuardPlaybackUrl({
        videoCurrentSrc: 'blob:https://app.example.com/session-id',
        playbackUrl: 'https://media.example.com/show/index.m3u8',
        fallbackUrl: 'https://media.example.com/show/fallback.m3u8',
      })
    ).toBe('https://media.example.com/show/index.m3u8');
  });

  it('uses fallback url before the video currentSrc', () => {
    expect(
      getHlsRecoveryGuardPlaybackUrl({
        videoCurrentSrc: 'blob:https://app.example.com/session-id',
        playbackUrl: '',
        fallbackUrl: 'https://media.example.com/show/index.m3u8',
      })
    ).toBe('https://media.example.com/show/index.m3u8');
  });

  it('falls back to currentSrc when no logical playback url is available', () => {
    expect(
      getHlsRecoveryGuardPlaybackUrl({
        videoCurrentSrc: 'https://media.example.com/video.mp4',
        playbackUrl: '',
        fallbackUrl: '',
      })
    ).toBe('https://media.example.com/video.mp4');
  });
});
