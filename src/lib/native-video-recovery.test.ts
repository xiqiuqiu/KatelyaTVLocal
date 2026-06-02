import {
  getNativeVideoRecoveryPlan,
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
