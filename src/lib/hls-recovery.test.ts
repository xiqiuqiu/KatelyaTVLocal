import {
  getHlsRecoveryPlan,
  getHlsRecoveryProgressUpdate,
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
