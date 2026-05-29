import {
  createPlayableSourceStatus,
  getRememberedSourceStatus,
  getSourceStatusLabel,
  isSourceStatusClickable,
  probeSourcePlayback,
  processImageUrl,
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

  it('marks browser speed-test failures as playable instead of unavailable', () => {
    const status = createPlayableSourceStatus({
      reason: '测速失败，可尝试播放',
      playbackMode: 'direct',
    });

    expect(status.kind).toBe('playable');
    expect(getSourceStatusLabel(status)).toBe('可播');
    expect(isSourceStatusClickable(status)).toBe(true);
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
