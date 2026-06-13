import {
  buildHlsProxyUrl,
  createPlayableSourceStatus,
  getRememberedSourceStatus,
  getRememberedSourceStatusForSource,
  getSourceStatusDescription,
  getSourceStatusLabel,
  isSourceStatusClickable,
  probeSourcePlayback,
  processImageUrl,
  rememberSourcePlaybackQuality,
} from '@/lib/utils';

describe('source status behavior', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    window.localStorage.clear();
    window.RUNTIME_CONFIG = undefined;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('ignores cached unavailable status caused by browser probe failures', () => {
    window.localStorage.setItem(
      'sourceDomainPreferences',
      JSON.stringify({
        'media.example.com': {
          mode: 'unavailable',
          failCount: 1,
          updatedAt: Date.now(),
          lastError: 'Timeout loading video metadata',
        },
      })
    );

    expect(
      getRememberedSourceStatus([
        'https://media.example.com/20250508/demo/index.m3u8',
      ])
    ).toBeNull();
  });

  it('keeps real upstream unavailable results cached', () => {
    window.localStorage.setItem(
      'sourceDomainPreferences',
      JSON.stringify({
        'media.example.com': {
          mode: 'unavailable',
          failCount: 1,
          updatedAt: Date.now(),
          lastError: '上游响应失败: 503',
        },
      })
    );

    const status = getRememberedSourceStatus([
      'https://media.example.com/20250508/demo/index.m3u8',
    ]);

    expect(status?.kind).toBe('unavailable');
    expect(status?.reason).toBe('上游响应失败: 503');
  });

  it('keeps source-specific playback failures from affecting another source on the same domain', () => {
    rememberSourcePlaybackQuality('slow-1', 'media.example.com', {
      mode: 'unavailable',
      lastError: 'manifestLoadError',
    });

    expect(
      getRememberedSourceStatusForSource('slow-1', [
        'https://media.example.com/20250508/demo/index.m3u8',
      ])?.kind
    ).toBe('unavailable');
    expect(
      getRememberedSourceStatusForSource('fast-2', [
        'https://media.example.com/20250508/demo/index.m3u8',
      ])
    ).toBeNull();
  });

  it('restores source-specific successful playback memory with measured speed', () => {
    rememberSourcePlaybackQuality('fast-2', 'media.example.com', {
      mode: 'direct',
      startupTimeMs: 1200,
      browserSpeedLabel: '2.5 MB/s',
      confidence: 'high',
    });

    const status = getRememberedSourceStatusForSource('fast-2', [
      'https://media.example.com/20250508/demo/index.m3u8',
    ]);

    expect(status?.kind).toBe('direct');
    expect(status?.fromMemory).toBe(true);
    expect(status?.measured?.loadSpeed).toBe('2.5 MB/s');
    expect(status?.reason).toBe('本机近期播放流畅');
  });

  it('clears source-specific unavailable memory for transient browser probe errors', () => {
    rememberSourcePlaybackQuality('slow-1', 'media.example.com', {
      mode: 'unavailable',
      lastError: 'Timeout loading video metadata',
    });

    expect(
      getRememberedSourceStatusForSource('slow-1', [
        'https://media.example.com/20250508/demo/index.m3u8',
      ])
    ).toBeNull();
    expect(
      window.localStorage.getItem('sourcePlaybackQualityPreferences')
    ).toBe('{}');
  });

  it('does not restore low-confidence browser speed-test failures as unavailable', () => {
    rememberSourcePlaybackQuality('slow-1', 'media.example.com', {
      mode: 'unavailable',
      lastError: 'metadata probe failed',
      confidence: 'low',
    });

    expect(
      getRememberedSourceStatusForSource('slow-1', [
        'https://media.example.com/20250508/demo/index.m3u8',
      ])
    ).toBeNull();
    expect(
      window.localStorage.getItem('sourcePlaybackQualityPreferences')
    ).toBe('{}');
  });

  it('marks browser speed-test failures as playable instead of unavailable', () => {
    const status = createPlayableSourceStatus({
      reason: '测速失败，可尝试播放',
      playbackMode: 'direct',
    });

    expect(status.kind).toBe('playable');
    expect(getSourceStatusLabel(status)).toBe('可尝试');
    expect(getSourceStatusDescription(status)).toBe('可尝试播放，失败时可换源');
    expect(isSourceStatusClickable(status)).toBe(true);
  });

  it('prefers probing status over stale video measurements', () => {
    expect(
      getSourceStatusDescription(
        { kind: 'probing' },
        {
          quality: '1080p',
          loadSpeed: '1.2 MB/s',
          pingTime: 120,
        }
      )
    ).toBe('正在检测当前线路');
  });

  it('uses user-facing source status labels and hides raw unavailable reasons', () => {
    expect(
      getSourceStatusLabel({
        kind: 'direct',
      })
    ).toBe('推荐·直连');
    expect(
      getSourceStatusLabel({
        kind: 'proxy',
      })
    ).toBe('备用·需代理');
    expect(
      getSourceStatusDescription({
        kind: 'unavailable',
        reason: '服务端探测失败: 403',
      })
    ).toBe('该线路当前不可用');
  });

  it('falls back to the local probe endpoint when the external probe fails', async () => {
    window.RUNTIME_CONFIG = {
      SOURCE_PROBE: 'https://worker.example.com/api/source-probe?url=',
    };

    global.fetch = jest
      .fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          kind: 'direct',
          reason: '播放列表和首个媒体片段都支持浏览器直连',
          domain: 'media.example.com',
        }),
      } as Response);

    const result = await probeSourcePlayback(
      'https://media.example.com/20250508/demo/index.m3u8'
    );

    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect((global.fetch as jest.Mock).mock.calls[0][0]).toBe(
      'https://worker.example.com/api/source-probe?url=https%3A%2F%2Fmedia.example.com%2F20250508%2Fdemo%2Findex.m3u8'
    );
    expect((global.fetch as jest.Mock).mock.calls[1][0]).toBe(
      '/api/source-probe?url=https%3A%2F%2Fmedia.example.com%2F20250508%2Fdemo%2Findex.m3u8'
    );
    expect(result.kind).toBe('direct');
  });

  it('can build an HLS proxy URL that keeps media segments direct', () => {
    window.RUNTIME_CONFIG = {
      HLS_PROXY: '/api/hls-proxy?url=',
    };

    expect(
      buildHlsProxyUrl('https://media.example.com/show/index.m3u8', {
        mediaSegmentMode: 'direct',
      })
    ).toBe(
      '/api/hls-proxy?url=https%3A%2F%2Fmedia.example.com%2Fshow%2Findex.m3u8&segmentMode=direct'
    );
  });

  it('can build an HLS proxy URL with ad filtering disabled', () => {
    window.RUNTIME_CONFIG = {
      HLS_PROXY: '/api/hls-proxy?url=',
    };

    expect(
      buildHlsProxyUrl('https://media.example.com/show/index.m3u8', {
        filterAds: false,
      })
    ).toBe(
      '/api/hls-proxy?url=https%3A%2F%2Fmedia.example.com%2Fshow%2Findex.m3u8&filterAds=0'
    );
  });

  it('adds bounded card image options to proxied image URLs', () => {
    window.RUNTIME_CONFIG = {
      IMAGE_PROXY: '/api/image-proxy?url=',
    };

    expect(
      processImageUrl('https://images.example.com/poster.jpg', {
        height: 360,
        quality: 76,
        width: 240,
      })
    ).toBe(
      '/api/image-proxy?url=https%3A%2F%2Fimages.example.com%2Fposter.jpg&w=240&h=360&q=76'
    );
  });
});
