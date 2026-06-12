import {
  getEffectivePlaybackLoadingElapsedMs,
  getPlaybackFailureViewModel,
  normalizePlaybackFailureReason,
  shouldAutoSwitchOnLoadingStall,
  shouldEscalatePlaybackLoadingStall,
  shouldShowPlaybackStallActions,
  shouldSuppressPlaybackStallEscalation,
} from './playback-failure-ui';

describe('playback failure UI', () => {
  it('hides technical playback errors behind user-facing copy', () => {
    expect(
      getPlaybackFailureViewModel({
        error: 'HLS播放失败: fragLoadError status=403',
        hasSearchTitle: true,
        hasAlternativeSource: true,
      })
    ).toEqual({
      title: '当前线路播放失败',
      message: '可以先切换到其他可用线路，或稍后重新尝试当前线路。',
      primaryAction: 'switch-source',
      secondaryAction: 'retry',
    });
  });

  it('falls back to retry when there is no alternative source', () => {
    expect(
      getPlaybackFailureViewModel({
        error: '播放器初始化失败',
        hasSearchTitle: false,
        hasAlternativeSource: false,
      })
    ).toEqual({
      title: '视频暂时无法播放',
      message: '当前影片暂时没有可用线路，请稍后重试。',
      primaryAction: 'retry',
      secondaryAction: 'back',
    });
  });

  it('uses search-specific copy for missing content results', () => {
    expect(
      getPlaybackFailureViewModel({
        error: 'no-results',
        hasSearchTitle: true,
        hasAlternativeSource: false,
        reason: 'no-results',
      })
    ).toEqual({
      title: '暂时找不到可播放内容',
      message: '没有找到匹配的播放源，可以返回搜索页换个关键词试试。',
      primaryAction: 'retry',
      secondaryAction: 'back',
    });
  });

  it('shows stall actions after the player has been loading for too long', () => {
    expect(
      shouldShowPlaybackStallActions({
        isVideoLoading: true,
        loadingStartedAt: 1_000,
        now: 13_000,
      })
    ).toBe(true);
  });

  it('normalizes technical HTTP and HLS errors to internal reason codes', () => {
    expect(normalizePlaybackFailureReason('fragLoadError status=403')).toBe(
      'source-unavailable'
    );
    expect(normalizePlaybackFailureReason('networkError aborted')).toBe(
      'source-unavailable'
    );
    expect(normalizePlaybackFailureReason('')).toBe('generic');
    expect(normalizePlaybackFailureReason('playback-unavailable')).toBe(
      'playback-unavailable'
    );
  });

  it('decides whether loading stall should auto switch once', () => {
    expect(
      shouldAutoSwitchOnLoadingStall({
        hasAlternativeSource: true,
        autoSwitchAttempted: false,
      })
    ).toBe(true);

    expect(
      shouldAutoSwitchOnLoadingStall({
        hasAlternativeSource: true,
        autoSwitchAttempted: true,
      })
    ).toBe(false);

    expect(
      shouldAutoSwitchOnLoadingStall({
        hasAlternativeSource: false,
        autoSwitchAttempted: false,
      })
    ).toBe(false);
  });

  it('suppresses loading escalation during user pause or seek', () => {
    expect(
      shouldSuppressPlaybackStallEscalation({
        isUserPaused: true,
        isUserSeeking: false,
        lastUserSeekAt: null,
        now: 20_000,
      })
    ).toBe(true);

    expect(
      shouldSuppressPlaybackStallEscalation({
        isUserPaused: false,
        isUserSeeking: true,
        lastUserSeekAt: null,
        now: 20_000,
      })
    ).toBe(true);

    expect(
      shouldSuppressPlaybackStallEscalation({
        isUserPaused: false,
        isUserSeeking: false,
        lastUserSeekAt: 12_000,
        now: 20_000,
        seekGraceMs: 15_000,
      })
    ).toBe(true);
  });

  it('excludes paused or seek time from loading stall threshold', () => {
    expect(
      getEffectivePlaybackLoadingElapsedMs({
        loadingStartedAt: 0,
        now: 20_000,
        excludedMs: 12_000,
      })
    ).toBe(8_000);

    expect(
      shouldEscalatePlaybackLoadingStall({
        loadingStartedAt: 0,
        now: 20_000,
        thresholdMs: 10_000,
        excludedMs: 12_000,
        isUserPaused: false,
        isUserSeeking: false,
        lastUserSeekAt: null,
      })
    ).toBe(false);

    expect(
      shouldEscalatePlaybackLoadingStall({
        loadingStartedAt: 0,
        now: 25_000,
        thresholdMs: 10_000,
        excludedMs: 12_000,
        isUserPaused: true,
        isUserSeeking: false,
        lastUserSeekAt: null,
      })
    ).toBe(false);
  });
});
