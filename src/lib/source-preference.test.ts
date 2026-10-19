import {
  getBrowserProbeBudget,
  probeSourcePlaybackWithCache,
  sortSourcePreferenceResults,
} from '@/lib/source-preference';
import { SourcePreferenceResult } from '@/lib/types';

describe('cloudflare-first source preference', () => {
  const originalFetch = global.fetch;
  const originalCaches = (global as { caches?: unknown }).caches;
  const originalResponse = (global as { Response?: unknown }).Response;
  const originalRequest = (global as { Request?: unknown }).Request;

  class MockResponse {
    status: number;
    ok: boolean;
    headers: { get: (key: string) => string | null };
    private readonly bodyText: string;

    constructor(
      bodyText = '',
      init?: { status?: number; headers?: Record<string, string> }
    ) {
      this.status = init?.status ?? 200;
      this.ok = this.status >= 200 && this.status < 300;
      const normalizedHeaders = Object.fromEntries(
        Object.entries(init?.headers || {}).map(([key, value]) => [
          key.toLowerCase(),
          value,
        ])
      );
      this.headers = {
        get: (key: string) => normalizedHeaders[key.toLowerCase()] || null,
      };
      this.bodyText = bodyText;
    }

    async json(): Promise<unknown> {
      return JSON.parse(this.bodyText || 'null');
    }

    async text(): Promise<string> {
      return this.bodyText;
    }

    clone(): MockResponse {
      return new MockResponse(this.bodyText, {
        status: this.status,
        headers: Object.fromEntries(
          ['access-control-allow-origin', 'content-type', 'cache-control']
            .map((key) => [key, this.headers.get(key)])
            .filter((entry): entry is [string, string] => Boolean(entry[1]))
        ),
      });
    }
  }

  class MockRequest {
    url: string;
    method: string;

    constructor(url: string, init?: { method?: string }) {
      this.url = url;
      this.method = init?.method || 'GET';
    }
  }

  function hlsResponse(
    body: string,
    options: { status?: number; cors?: boolean } = {}
  ) {
    return new MockResponse(body, {
      status: options.status,
      headers: {
        'content-type': 'application/vnd.apple.mpegurl',
        ...(options.cors === false
          ? {}
          : { 'access-control-allow-origin': '*' }),
      },
    });
  }

  beforeEach(() => {
    (global as unknown as { Response?: typeof MockResponse }).Response =
      MockResponse;
    (global as unknown as { Request?: typeof MockRequest }).Request =
      MockRequest;
  });

  afterEach(() => {
    global.fetch = originalFetch;

    if (originalCaches === undefined) {
      delete (global as { caches?: unknown }).caches;
    } else {
      (global as { caches?: unknown }).caches = originalCaches;
    }

    if (originalResponse === undefined) {
      delete (global as { Response?: unknown }).Response;
    } else {
      (global as { Response?: unknown }).Response = originalResponse;
    }

    if (originalRequest === undefined) {
      delete (global as { Request?: unknown }).Request;
    } else {
      (global as { Request?: unknown }).Request = originalRequest;
    }

    jest.restoreAllMocks();
  });

  it('uses dynamic browser probe budgets for larger source sets', () => {
    expect(getBrowserProbeBudget(0)).toBe(0);
    expect(getBrowserProbeBudget(2)).toBe(2);
    expect(getBrowserProbeBudget(6)).toBe(3);
    expect(getBrowserProbeBudget(12)).toBe(4);
    expect(getBrowserProbeBudget(30)).toBe(5);
  });

  it('sorts direct sources ahead of proxy and unavailable results', () => {
    const sorted = sortSourcePreferenceResults<SourcePreferenceResult>([
      {
        sourceKey: 'c',
        kind: 'proxy',
        probeTimeMs: 90,
      },
      {
        sourceKey: 'b',
        kind: 'direct',
        probeTimeMs: 180,
      },
      {
        sourceKey: 'a',
        kind: 'direct',
        probeTimeMs: 80,
      },
      {
        sourceKey: 'd',
        kind: 'unavailable',
        probeTimeMs: 10,
      },
    ]);

    expect(sorted.map((item) => item.sourceKey)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('reuses cloudflare cache results before hitting upstream again', async () => {
    const cacheStore = new Map<string, Response>();
    const cache = {
      match: jest.fn(async (request: Request) => {
        const cached = cacheStore.get(request.url);
        return cached ? cached.clone() : undefined;
      }),
      put: jest.fn(async (request: Request, response: Response) => {
        cacheStore.set(request.url, response.clone());
      }),
    };

    (global as { caches?: unknown }).caches = {
      default: cache,
    };

    global.fetch = jest.fn().mockResolvedValue(
      new MockResponse('', {
        status: 200,
        headers: {
          'access-control-allow-origin': '*',
          'content-type': 'video/mp4',
        },
      })
    );

    const targetUrl = 'https://media.example.com/video.mp4';
    const origin = 'https://app.example.com';

    const first = await probeSourcePlaybackWithCache(targetUrl, origin);
    const second = await probeSourcePlaybackWithCache(targetUrl, origin);

    expect(first.kind).toBe('direct');
    expect(first.cacheState).toBe('miss');
    expect(second.kind).toBe('direct');
    expect(second.cacheState).toBe('hit');
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(cache.put).toHaveBeenCalledTimes(1);
  });

  it('marks upstream probes unavailable when fetch exceeds the probe timeout', async () => {
    jest.useFakeTimers();
    try {
      global.fetch = jest.fn((_url, init?: RequestInit) => {
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(
              new DOMException('This operation was aborted', 'AbortError')
            );
          });
        });
      }) as jest.MockedFunction<typeof fetch>;

      const resultPromise = probeSourcePlaybackWithCache(
        'https://media.example.com/video.mp4',
        'https://app.example.com',
        { timeoutMs: 1000 }
      );

      jest.advanceTimersByTime(1000);

      await expect(resultPromise).resolves.toEqual(
        expect.objectContaining({
          kind: 'unavailable',
          cacheState: 'miss',
        })
      );
    } finally {
      jest.useRealTimers();
    }
  });

  describe('probe target validation', () => {
    it('rejects localhost without fetching upstream', async () => {
      global.fetch = jest.fn();

      const result = await probeSourcePlaybackWithCache(
        'http://localhost/video.mp4',
        'https://app.example.com'
      );

      expect(result).toEqual(
        expect.objectContaining({
          kind: 'unavailable',
          reason: 'Blocked host',
          cacheState: 'miss',
        })
      );
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('rejects RFC1918 private IPv4 without fetching upstream', async () => {
      global.fetch = jest.fn();

      const result = await probeSourcePlaybackWithCache(
        'http://10.0.0.5/video.mp4',
        'https://app.example.com'
      );

      expect(result).toEqual(
        expect.objectContaining({
          kind: 'unavailable',
          reason: 'Blocked host',
        })
      );
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('rejects cloud metadata hosts without fetching upstream', async () => {
      global.fetch = jest.fn();

      const result = await probeSourcePlaybackWithCache(
        'http://metadata.google.internal/computeMetadata/v1/',
        'https://app.example.com'
      );

      expect(result).toEqual(
        expect.objectContaining({
          kind: 'unavailable',
          reason: 'Blocked host',
        })
      );
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('rejects non-http URLs without fetching upstream', async () => {
      global.fetch = jest.fn();

      const result = await probeSourcePlaybackWithCache(
        'ftp://files.example.com/video.mp4',
        'https://app.example.com'
      );

      expect(result).toEqual(
        expect.objectContaining({
          kind: 'unavailable',
          reason: 'URL must use http or https',
        })
      );
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('rejects redirects to private hosts', async () => {
      global.fetch = jest.fn().mockResolvedValue(
        new MockResponse('', {
          status: 302,
          headers: {
            Location: 'http://127.0.0.1/internal',
          },
        })
      );

      const result = await probeSourcePlaybackWithCache(
        'https://media.example.com/video.mp4',
        'https://app.example.com'
      );

      expect(result).toEqual(
        expect.objectContaining({
          kind: 'unavailable',
          reason: 'Blocked redirect target: Blocked host',
        })
      );
      expect(global.fetch).toHaveBeenCalledTimes(1);
      expect(global.fetch).toHaveBeenCalledWith(
        'https://media.example.com/video.mp4',
        expect.objectContaining({ redirect: 'manual' })
      );
    });

    it('rejects private nested playlist targets without fetching them', async () => {
      global.fetch = jest.fn().mockResolvedValue(
        new MockResponse('#EXTM3U\nhttp://127.0.0.1/segment.ts', {
          status: 200,
          headers: {
            'access-control-allow-origin': '*',
            'content-type': 'application/vnd.apple.mpegurl',
          },
        })
      );

      const result = await probeSourcePlaybackWithCache(
        'https://media.example.com/playlist.m3u8',
        'https://app.example.com'
      );

      expect(result).toEqual(
        expect.objectContaining({
          kind: 'unavailable',
          reason: 'Blocked host',
        })
      );
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it('keeps successful public HLS and range probes', async () => {
      global.fetch = jest
        .fn()
        .mockResolvedValueOnce(
          new MockResponse('#EXTM3U\nhttps://media.example.com/segment.ts', {
            status: 200,
            headers: {
              'access-control-allow-origin': '*',
              'content-type': 'application/vnd.apple.mpegurl',
            },
          })
        )
        .mockResolvedValueOnce(
          new MockResponse('', {
            status: 206,
            headers: {
              'access-control-allow-origin': '*',
            },
          })
        );

      const result = await probeSourcePlaybackWithCache(
        'https://media.example.com/playlist.m3u8',
        'https://app.example.com'
      );

      expect(result).toEqual(
        expect.objectContaining({
          kind: 'direct',
          upstreamStatus: 200,
        })
      );
      expect(global.fetch).toHaveBeenCalledTimes(2);
      expect(global.fetch).toHaveBeenNthCalledWith(
        1,
        'https://media.example.com/playlist.m3u8',
        expect.objectContaining({ redirect: 'manual' })
      );
      expect(global.fetch).toHaveBeenNthCalledWith(
        2,
        'https://media.example.com/segment.ts',
        expect.objectContaining({ redirect: 'manual' })
      );
    });

    it('follows a master playlist through its variant to the first media segment', async () => {
      global.fetch = jest
        .fn()
        .mockResolvedValueOnce(
          hlsResponse(
            '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=800000\nvariant.m3u8'
          )
        )
        .mockResolvedValueOnce(hlsResponse('#EXTM3U\n#EXTINF:6,\nsegment.ts'))
        .mockResolvedValueOnce(
          new MockResponse('', {
            status: 206,
            headers: { 'access-control-allow-origin': '*' },
          })
        );

      const result = await probeSourcePlaybackWithCache(
        'https://media.example.com/master.m3u8',
        'https://app.example.com'
      );

      expect(result.kind).toBe('direct');
      expect(global.fetch).toHaveBeenCalledTimes(3);
      expect(global.fetch).toHaveBeenLastCalledWith(
        'https://media.example.com/segment.ts',
        expect.objectContaining({ redirect: 'manual' })
      );
    });

    it('marks a source unavailable when its variant loads but its segment fails', async () => {
      global.fetch = jest
        .fn()
        .mockResolvedValueOnce(hlsResponse('#EXTM3U\nvariant.m3u8'))
        .mockResolvedValueOnce(hlsResponse('#EXTM3U\nsegment.ts'))
        .mockResolvedValueOnce(new MockResponse('', { status: 404 }));

      const result = await probeSourcePlaybackWithCache(
        'https://media.example.com/master-failing.m3u8',
        'https://app.example.com'
      );

      expect(result).toEqual(
        expect.objectContaining({
          kind: 'unavailable',
          reason: 'HLS 播放目标不可达: 404',
          upstreamStatus: 404,
        })
      );
    });

    it('does not mark an empty media playlist as playable', async () => {
      global.fetch = jest
        .fn()
        .mockResolvedValue(hlsResponse('#EXTM3U\n#EXT-X-ENDLIST'));

      const result = await probeSourcePlaybackWithCache(
        'https://media.example.com/empty.m3u8',
        'https://app.example.com'
      );

      expect(result).toEqual(
        expect.objectContaining({
          kind: 'unavailable',
          reason: '播放列表未包含可探测的媒体对象',
        })
      );
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it('requires CORS on every playlist and media layer for direct playback', async () => {
      global.fetch = jest
        .fn()
        .mockResolvedValueOnce(hlsResponse('#EXTM3U\nvariant.m3u8'))
        .mockResolvedValueOnce(
          hlsResponse('#EXTM3U\nsegment.ts', { cors: false })
        )
        .mockResolvedValueOnce(
          new MockResponse('', {
            status: 206,
            headers: { 'access-control-allow-origin': '*' },
          })
        );

      const result = await probeSourcePlaybackWithCache(
        'https://media.example.com/master-cors.m3u8',
        'https://app.example.com'
      );

      expect(result.kind).toBe('proxy');
    });

    it('stops cyclic playlists without refetching the same target', async () => {
      global.fetch = jest
        .fn()
        .mockResolvedValueOnce(hlsResponse('#EXTM3U\nloop.m3u8'))
        .mockResolvedValueOnce(hlsResponse('#EXTM3U\nloop.m3u8'));

      const result = await probeSourcePlaybackWithCache(
        'https://media.example.com/master-loop.m3u8',
        'https://app.example.com'
      );

      expect(result).toEqual(
        expect.objectContaining({
          kind: 'unavailable',
          reason: '播放列表存在循环引用',
        })
      );
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    it('stops playlist nesting at the fixed request budget', async () => {
      global.fetch = jest
        .fn()
        .mockResolvedValueOnce(hlsResponse('#EXTM3U\nlevel-1.m3u8'))
        .mockResolvedValueOnce(hlsResponse('#EXTM3U\nlevel-2.m3u8'))
        .mockResolvedValueOnce(hlsResponse('#EXTM3U\nlevel-3.m3u8'))
        .mockResolvedValueOnce(hlsResponse('#EXTM3U\nsegment.ts'));

      const result = await probeSourcePlaybackWithCache(
        'https://media.example.com/master-deep.m3u8',
        'https://app.example.com'
      );

      expect(result).toEqual(
        expect.objectContaining({
          kind: 'unavailable',
          reason: '播放列表嵌套超过探测上限',
        })
      );
      expect(global.fetch).toHaveBeenCalledTimes(4);
    });
  });
});
