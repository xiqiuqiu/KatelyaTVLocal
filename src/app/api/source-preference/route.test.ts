import { getOptionalRequestContext } from '@cloudflare/next-on-pages';

import { probeSourcePlaybackWithCache } from '@/lib/source-preference';
import { readLatestSourceRanks } from '@/lib/source-ranking/read';
import { getSourceRankingRuntime } from '@/lib/source-ranking/runtime';

type IncomingRequestCfProperties = Record<string, unknown>;
type ExecutionContext = Record<string, unknown>;

class MockHeaders {
  private readonly values = new Map<string, string>();

  constructor(init?: Record<string, string>) {
    Object.entries(init || {}).forEach(([key, value]) => {
      this.values.set(key.toLowerCase(), value);
    });
  }

  get(key: string) {
    return this.values.get(key.toLowerCase()) || null;
  }

  set(key: string, value: string) {
    this.values.set(key.toLowerCase(), value);
  }

  forEach(callback: (value: string, key: string) => void) {
    this.values.forEach((value, key) => callback(value, key));
  }
}

class MockRequest {
  url: string;
  method: string;
  headers: MockHeaders;
  private readonly bodyText: string;

  constructor(
    input: string,
    init?: { method?: string; headers?: Record<string, string>; body?: string }
  ) {
    this.url = input;
    this.method = init?.method || 'GET';
    this.headers = new MockHeaders(init?.headers);
    this.bodyText = init?.body || '';
  }

  async json(): Promise<unknown> {
    return JSON.parse(this.bodyText || 'null');
  }
}

class MockResponse {
  status: number;
  headers: MockHeaders;

  constructor(private readonly payload: unknown, init?: { status?: number }) {
    this.status = init?.status ?? 200;
    this.headers = new MockHeaders();
  }

  async json(): Promise<unknown> {
    return this.payload;
  }

  static json(payload: unknown, init?: { status?: number }) {
    return new MockResponse(payload, init);
  }
}

(global as unknown as { Request?: typeof MockRequest }).Request = MockRequest;
(global as unknown as { Headers?: typeof MockHeaders }).Headers = MockHeaders;
(global as unknown as { Response?: typeof MockResponse }).Response =
  MockResponse;

let POST: (request: Request) => Promise<MockResponse>;

jest.mock(
  '@cloudflare/next-on-pages',
  () => ({
    getOptionalRequestContext: jest.fn(),
  }),
  { virtual: true }
);

jest.mock('next/server', () => ({
  NextResponse: {
    json: (payload: unknown, init?: { status?: number }) =>
      new MockResponse(payload, init),
  },
}));

jest.mock('@/lib/source-ranking/read', () => ({
  readLatestSourceRanks: jest.fn(),
}));

jest.mock('@/lib/source-ranking/runtime', () => ({
  getSourceRankingRuntime: jest.fn(),
}));

jest.mock('@/lib/source-preference', () => {
  const actual = jest.requireActual('@/lib/source-preference');

  return {
    ...actual,
    probeSourcePlaybackWithCache: jest.fn(),
  };
});

describe('source preference route', () => {
  const mockedGetOptionalRequestContext =
    getOptionalRequestContext as jest.MockedFunction<
      typeof getOptionalRequestContext
    >;
  const mockedReadLatestSourceRanks =
    readLatestSourceRanks as jest.MockedFunction<typeof readLatestSourceRanks>;
  const mockedGetSourceRankingRuntime =
    getSourceRankingRuntime as jest.MockedFunction<
      typeof getSourceRankingRuntime
    >;
  const mockedProbeSourcePlaybackWithCache =
    probeSourcePlaybackWithCache as jest.MockedFunction<
      typeof probeSourcePlaybackWithCache
    >;

  beforeAll(() => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    ({ POST } = require('@/app/api/source-preference/route'));
  });

  beforeEach(() => {
    mockedGetOptionalRequestContext.mockReturnValue({
      env: {
        DB: { prepare: jest.fn() },
      },
      cf: {} as IncomingRequestCfProperties,
      ctx: {} as ExecutionContext,
    });
    mockedGetSourceRankingRuntime.mockReturnValue({
      enabled: true,
      hasD1: true,
      fallbackToLive: true,
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('keeps d1-ranked sources and probes only uncovered live sources when fallback is allowed', async () => {
    mockedReadLatestSourceRanks.mockResolvedValue([
      {
        sourceKey: 'alpha',
        kind: 'direct',
        reason: '24h 快照优先直连',
        domain: 'alpha.example',
        rankScore: 93,
        updatedAt: 1710000000000,
        rankingSource: 'd1',
      },
    ]);
    mockedProbeSourcePlaybackWithCache.mockResolvedValue({
      kind: 'proxy',
      reason: '需要代理',
      domain: 'beta.example',
      probeTimeMs: 260,
      cacheState: 'miss',
    });

    const response = await POST(
      new Request('https://app.example.com/api/source-preference', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: 'https://app.example.com',
        },
        body: JSON.stringify({
          allowLiveProbeFallback: true,
          sources: [
            {
              sourceKey: 'alpha',
              episodeUrl: 'https://alpha.example/1.m3u8',
            },
            {
              sourceKey: 'beta',
              episodeUrl: 'https://beta.example/1.m3u8',
            },
            {
              sourceKey: 'gamma',
              episodeUrl: null,
            },
          ],
        }),
      })
    );

    expect(mockedReadLatestSourceRanks).toHaveBeenCalledWith(
      expect.any(Object),
      ['alpha', 'beta', 'gamma']
    );
    expect(mockedProbeSourcePlaybackWithCache).toHaveBeenCalledTimes(1);
    expect(mockedProbeSourcePlaybackWithCache).toHaveBeenCalledWith(
      'https://beta.example/1.m3u8',
      'https://app.example.com'
    );

    const payload = (await response.json()) as {
      rankingSource: string;
      confidence: string;
      orderedSourceKeys: string[];
      results: Array<Record<string, unknown>>;
    };

    expect(payload.rankingSource).toBe('mixed');
    expect(payload.confidence).toBe('medium');
    expect(payload.orderedSourceKeys).toEqual(['alpha', 'beta', 'gamma']);
    expect(payload.results).toEqual([
      expect.objectContaining({
        sourceKey: 'alpha',
        kind: 'direct',
        rankingSource: 'd1',
        rankScore: 93,
      }),
      expect.objectContaining({
        sourceKey: 'beta',
        kind: 'proxy',
        rankingSource: 'live',
        probeTimeMs: 260,
      }),
      expect.objectContaining({
        sourceKey: 'gamma',
        kind: 'unavailable',
        rankingSource: 'live',
        reason: '该播放源没有可用剧集',
      }),
    ]);
  });

  it('does not live probe when fallback is disabled and d1 has no matching rank', async () => {
    mockedReadLatestSourceRanks.mockResolvedValue([]);

    const response = await POST(
      new Request('https://app.example.com/api/source-preference', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: 'https://app.example.com',
        },
        body: JSON.stringify({
          allowLiveProbeFallback: false,
          sources: [
            {
              sourceKey: 'maotaizy-132249',
              episodeUrl: 'https://media.example/1.m3u8',
            },
          ],
        }),
      })
    );

    expect(mockedReadLatestSourceRanks).toHaveBeenCalledWith(
      expect.any(Object),
      ['maotaizy-132249']
    );
    expect(mockedProbeSourcePlaybackWithCache).not.toHaveBeenCalled();

    const payload = (await response.json()) as {
      rankingSource: string;
      confidence: string;
      orderedSourceKeys: string[];
      results: Array<Record<string, unknown>>;
    };

    expect(payload.rankingSource).toBe('d1');
    expect(payload.confidence).toBe('low');
    expect(payload.orderedSourceKeys).toEqual([]);
    expect(payload.results).toEqual([]);
  });

  it('keeps partial d1 ranks without probing missing sources when fallback is disabled', async () => {
    mockedReadLatestSourceRanks.mockResolvedValue([
      {
        sourceKey: 'alpha',
        kind: 'direct',
        reason: '7 天快照优先直连',
        domain: 'alpha.example',
        rankScore: 88,
        updatedAt: 1710000000000,
        rankingSource: 'd1',
      },
    ]);

    const response = await POST(
      new Request('https://app.example.com/api/source-preference', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: 'https://app.example.com',
        },
        body: JSON.stringify({
          allowLiveProbeFallback: false,
          sources: [
            {
              sourceKey: 'alpha',
              episodeUrl: 'https://alpha.example/1.m3u8',
            },
            {
              sourceKey: 'beta',
              episodeUrl: 'https://beta.example/1.m3u8',
            },
          ],
        }),
      })
    );

    expect(mockedProbeSourcePlaybackWithCache).not.toHaveBeenCalled();

    const payload = (await response.json()) as {
      rankingSource: string;
      confidence: string;
      orderedSourceKeys: string[];
      results: Array<Record<string, unknown>>;
    };

    expect(payload.rankingSource).toBe('d1');
    expect(payload.confidence).toBe('medium');
    expect(payload.orderedSourceKeys).toEqual(['alpha']);
    expect(payload.results).toEqual([
      expect.objectContaining({
        sourceKey: 'alpha',
        kind: 'direct',
        rankingSource: 'd1',
        rankScore: 88,
      }),
    ]);
  });
});
