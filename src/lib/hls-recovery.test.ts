import { getHlsRecoveryPlan } from '@/lib/hls-recovery';

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

  it('escalates repeated direct stalls to proxy playback', () => {
    expect(
      getHlsRecoveryPlan({
        fatal: false,
        errorType: 'mediaError',
        errorDetails: 'bufferStalledError',
        playbackMode: 'direct',
        stallCount: 5,
        networkRecoveryAttempts: 1,
        mediaRecoveryAttempts: 1,
        hasAlternativeSource: true,
      })
    ).toEqual({
      action: 'switch-proxy',
      reason: '直连线路持续卡顿，切换到代理线路',
    });
  });

  it('switches source when proxy playback keeps stalling', () => {
    expect(
      getHlsRecoveryPlan({
        fatal: false,
        errorType: 'mediaError',
        errorDetails: 'waitingTimeout',
        playbackMode: 'proxy',
        stallCount: 5,
        networkRecoveryAttempts: 1,
        mediaRecoveryAttempts: 1,
        hasAlternativeSource: true,
      })
    ).toEqual({
      action: 'switch-source',
      reason: '代理线路仍持续卡顿，切换到其他播放源',
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
        networkRecoveryAttempts: 0,
        mediaRecoveryAttempts: 0,
        hasAlternativeSource: false,
      })
    ).toEqual({
      action: 'restart-load',
      reason: '致命网络错误，重新拉取分片',
    });
  });
});
